// runtime.ts：运行时数据仓库，负责模板/设备/工程点位元数据、SSE 实时值、报警状态与报警历史。
// SSE 断线由 EventSource 自动重连，组件销毁时由 start() 返回的停止函数负责关闭连接。

import { shallowRef } from 'vue';
import { defineStore } from 'pinia';
import type { Device, ResolvedTag, TagTemplate } from '../types';

// 报警值字典：key 为 '<deviceNo>.<tagTemplateId>'，值为 'high' | 'low'。
export type AlarmMap = Record<string, 'high' | 'low'>;

// 报警历史记录：时间与文案在推入时固化，避免后续每秒重算。
// deviceNo 用于报警栏按当前设备号过滤；无法解析设备号的记录保留为 null。
export interface RecentAlarm {
  id: number;
  time: string;
  tagName: string;
  kind: 'high' | 'low';
  deviceNo: number | null;
}

// SSE tags 事件的负载结构，字段与开发文档 §5.3 对齐。
interface TagsStreamPayload {
  ts: number;
  values: Record<string, number>;
  alarms: AlarmMap;
}

// 报警栏最多保留的历史条数，超出时丢弃最旧记录。
const MAX_RECENT_ALARMS = 5;
// 趋势图每个点位最多保留 60 个采样点；事件每秒到达一次，内存占用有固定上界。
const MAX_HISTORY_POINTS = 60;

// 把时间戳格式化为本地时间 HH:mm:ss。
function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export const useRuntimeStore = defineStore('runtime', () => {
  // 模板、设备与工程点位表由后端提供，前端只读。
  const tagTemplates = shallowRef<TagTemplate[]>([]);
  const devices = shallowRef<Device[]>([]);
  const tags = shallowRef<ResolvedTag[]>([]);
  // 当前画面实例的设备号；绑定图元未显式指定时也用它作为兜底。
  const activeDeviceNo = shallowRef(1);
  // 实时值与报警状态：整对象替换以触发 shallowRef 更新。
  const values = shallowRef<Record<string, number>>({});
  const alarms = shallowRef<AlarmMap>({});
  // 最近报警列表，数组首项为最新记录。
  const recentAlarms = shallowRef<RecentAlarm[]>([]);
  // 点位采样历史；key 与 values 相同，均为 '<deviceNo>.<tagTemplateId>'。
  // 该 Map 只存在于运行时内存，不参与 scene.json 序列化。
  const history = new Map<string, number[]>();
  // 每个 key 写满 60 点后的环形写指针，指向下一条最旧样本的覆盖位置。
  const historyWriteCursor = new Map<string, number>();

  // SSE 连接实例；start() 重复调用时先关闭旧连接，避免重复监听。
  let eventSource: EventSource | null = null;
  // 上一 tick 的报警集合，用于边沿检测：只有新出现的 key/alarm 才记录。
  let previousAlarms: AlarmMap = {};
  // 报警记录自增 id，保证列表 key 稳定唯一。
  let alarmSequence = 0;
  // 跳过重复请求的标记，避免重复挂载时多发无谓请求。
  let metaLoaded = false;

  // 并行拉取模板、设备与解析点位表，填充属性面板下拉数据。
  async function fetchMeta(): Promise<void> {
    if (metaLoaded) {
      return;
    }
    metaLoaded = true;
    try {
      const [templatesResponse, devicesResponse, tagsResponse] = await Promise.all([
        fetch('/api/tag-templates'),
        fetch('/api/devices'),
        fetch('/api/tags')
      ]);
      if (!templatesResponse.ok || !devicesResponse.ok || !tagsResponse.ok) {
        throw new Error('元数据请求失败');
      }
      tagTemplates.value = (await templatesResponse.json()) as TagTemplate[];
      devices.value = (await devicesResponse.json()) as Device[];
      tags.value = (await tagsResponse.json()) as ResolvedTag[];

      // 后端设备号始终从 1 起；若默认值不在返回列表中，回退到第一台设备。
      if (
        devices.value.length > 0 &&
        !devices.value.some((device) => device.deviceNo === activeDeviceNo.value)
      ) {
        activeDeviceNo.value = devices.value[0].deviceNo;
      }
    } catch (error) {
      // ASSUMPTION: 拉取失败仅告警并允许后续重试，不阻塞画布编辑这一核心功能。
      metaLoaded = false;
      console.warn('[runtime] 获取模板/设备/点位元数据失败:', error);
    }
  }

  // 统一生成运行数据 key，避免绘制、报警和后续扩展各自拼接字符串。
  function resolveKey(deviceNo: number, tagTemplateId: string): string {
    return `${deviceNo}.${tagTemplateId}`;
  }

  // 按设备号 + 模板查询解析后的工程点位定义。
  function getResolvedTag(
    deviceNo: number | null,
    tagTemplateId: string | null
  ): ResolvedTag | undefined {
    if (deviceNo === null || tagTemplateId === null) {
      return undefined;
    }
    const key = resolveKey(deviceNo, tagTemplateId);
    return tags.value.find((tag) => tag.key === key);
  }

  // 报警历史需要按 SSE key 反查显示名；解析结果缺失时保留 key 作为兜底。
  function getResolvedTagByKey(key: string): ResolvedTag | undefined {
    return tags.value.find((tag) => tag.key === key);
  }

  // 报警边沿检测：仅把“本 tick 新出现且上一 tick 未报警”的 key 写入历史。
  function collectNewAlarms(nextAlarms: AlarmMap): void {
    const additions: RecentAlarm[] = [];
    const timestamp = Date.now();
    for (const [key, kind] of Object.entries(nextAlarms)) {
      // 同一 key 持续报警期间 kind 不变，因此按 key 判断即可去重。
      if (previousAlarms[key] !== undefined) {
        continue;
      }
      const resolved = getResolvedTagByKey(key);
      alarmSequence += 1;
      additions.push({
        id: alarmSequence,
        time: formatTime(timestamp),
        tagName: resolved?.name ?? key,
        kind,
        deviceNo: resolved?.deviceNo ?? null
      });
    }
    // 报警结束后 key 会从 nextAlarms 消失；再次出现时 previousAlarms 已无该键，自然记为一条新记录。
    previousAlarms = { ...nextAlarms };
    if (additions.length === 0) {
      return;
    }
    // 同一 tick 出现多条新报警时也统一插入到最左，保持“新的在左”，并截断到 5 条。
    recentAlarms.value = [...additions.reverse(), ...recentAlarms.value].slice(0, MAX_RECENT_ALARMS);
  }

  // 记录一次 tags 事件中的全部有效点位值；每个 key 使用固定长度环形缓冲，最多保留 60 点。
  function appendHistory(nextValues: Record<string, number>): void {
    for (const key in nextValues) {
      const value = nextValues[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        continue;
      }
      let samples = history.get(key);
      if (samples === undefined) {
        samples = [];
        history.set(key, samples);
      }
      if (samples.length < MAX_HISTORY_POINTS) {
        samples.push(value);
        continue;
      }
      const cursor = historyWriteCursor.get(key) ?? 0;
      samples[cursor] = value;
      historyWriteCursor.set(key, (cursor + 1) % MAX_HISTORY_POINTS);
    }
  }

  // 返回指定点位按时间正序排列的最近 count 个采样；调用方不持有内部数组引用。
  function getHistory(key: string, count = MAX_HISTORY_POINTS): number[] {
    const samples = history.get(key);
    if (samples === undefined || samples.length === 0) {
      return [];
    }
    const requestedCount = Number.isFinite(count) ? Math.floor(count) : MAX_HISTORY_POINTS;
    const normalizedCount = Math.max(0, Math.min(requestedCount, MAX_HISTORY_POINTS));
    const resultLength = Math.min(normalizedCount, samples.length);
    const cursor = historyWriteCursor.get(key) ?? 0;
    const oldestInWindow = (cursor + samples.length - resultLength) % samples.length;
    const result = new Array<number>(resultLength);
    for (let index = 0; index < resultLength; index += 1) {
      result[index] = samples[(oldestInWindow + index) % samples.length] ?? 0;
    }
    return result;
  }

  // 建立 SSE 连接并监听 tags 事件；返回关闭函数供组件卸载时调用。
  function start(): () => void {
    if (eventSource !== null) {
      eventSource.close();
    }

    const source = new EventSource('/api/stream');
    eventSource = source;

    source.addEventListener('tags', (event) => {
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as TagsStreamPayload;
        values.value = payload.values;
        alarms.value = payload.alarms;
        appendHistory(payload.values);
        collectNewAlarms(payload.alarms);
      } catch (error) {
        // ASSUMPTION: 单条坏数据不应中断常驻重绘，只保留上一帧有效数据。
        console.warn('[runtime] 解析 SSE tags 数据失败:', error);
      }
    });

    source.onerror = (error) => {
      // EventSource 自带重连；此处只告警，不清空实时值，避免页面闪白/白屏。
      console.warn('[runtime] SSE 连接异常，等待自动重连:', error);
    };

    return () => {
      source.close();
      if (eventSource === source) {
        eventSource = null;
      }
    };
  }

  return {
    tagTemplates,
    devices,
    tags,
    activeDeviceNo,
    values,
    alarms,
    recentAlarms,
    history,
    fetchMeta,
    resolveKey,
    getResolvedTag,
    getHistory,
    start
  };
});
