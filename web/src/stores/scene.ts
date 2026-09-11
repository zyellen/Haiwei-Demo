// scene.ts：画面编辑器状态仓库，维护图元/管道、选中态与增删改清空动作。
// 同时提供文档 §6.5 预置画面与保存快照构造，供 App 完成加载/持久化接线。

import { computed, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import type { NewElementInput } from '../core/describe';
import type { Element, Pipe, Scene } from '../types';
import { snapToGrid } from './view';

// 新建图元默认色轮换：蓝 → 绿 → 黄，与文档 §6.1 配色一致。
const DEFAULT_COLORS = ['#5a9ade', '#7ab55c', '#d9b45b'] as const;

// 新建图元默认尺寸，各类型固定；按钮按可写回控件尺寸单独定义。
const DEFAULT_SIZE: Record<Element['type'], { w: number; h: number }> = {
  rect: { w: 120, h: 80 },
  circle: { w: 100, h: 100 },
  label: { w: 140, h: 40 },
  button: { w: 120, h: 48 },
  tank: { w: 120, h: 160 },
  motor: { w: 100, h: 100 },
  lamp: { w: 60, h: 60 },
  trend: { w: 260, h: 140 }
};

// 新建图元默认文字，避免画布上出现空图元难以辨识。
const DEFAULT_TEXT: Record<Element['type'], string> = {
  rect: '矩形',
  circle: '圆形',
  label: '文本',
  button: '按钮',
  tank: '液位',
  motor: '电机',
  lamp: '指示灯',
  trend: '趋势图'
};

// 预置画面固定使用 el_1 至 el_6 与 pipe_1；后续新增从各自序号之后继续。
const PRESET_ELEMENT_COUNT = 6;
const PRESET_PIPE_COUNT = 1;

// 撤销/重做历史快照：elements 与 pipes 必须深拷贝，避免后续变更污染历史。
export interface SceneSnapshot {
  elements: Element[];
  pipes: Pipe[];
}

// 历史栈上限；超出时丢弃最旧的一条，见 commitHistory() 的裁剪逻辑。
export const HISTORY_LIMIT = 50;

// 文档 §6.5 首次打开时的默认画面；预置一条泵管路支线。
export function buildDefaultScene(): Scene {
  return {
    version: 2,
    elements: [
      {
        id: 'el_1',
        type: 'rect',
        x: 80,
        y: 120,
        w: 160,
        h: 100,
        fill: '#5a9ade',
        text: '水箱',
        tagTemplateId: 'tpl.level',
        deviceNo: null
      },
      {
        id: 'el_2',
        type: 'rect',
        x: 320,
        y: 120,
        w: 160,
        h: 100,
        fill: '#7ab55c',
        text: '水箱',
        tagTemplateId: 'tpl.level',
        deviceNo: null
      },
      {
        id: 'el_3',
        type: 'circle',
        x: 80,
        y: 320,
        w: 110,
        h: 110,
        fill: '#d9b45b',
        text: '电机',
        tagTemplateId: 'tpl.speed',
        deviceNo: null
      },
      {
        id: 'el_4',
        type: 'circle',
        x: 280,
        y: 330,
        w: 110,
        h: 110,
        fill: '#5a9ade',
        text: '泵',
        tagTemplateId: 'tpl.temp',
        deviceNo: null
      },
      {
        id: 'el_5',
        type: 'label',
        x: 460,
        y: 340,
        w: 160,
        h: 44,
        fill: '#7ab55c',
        text: '出口压力',
        tagTemplateId: 'tpl.pressure',
        deviceNo: null
      },
      {
        id: 'el_6',
        type: 'label',
        x: 460,
        y: 400,
        w: 160,
        h: 44,
        fill: '#d9b45b',
        text: '阀门开度',
        tagTemplateId: 'tpl.valve',
        deviceNo: null
      }
    ],
    pipes: [{ id: 'pipe_1', fromId: 'el_1', toId: 'el_3' }],
    savedAt: new Date().toISOString()
  };
}

export const useSceneStore = defineStore('scene', () => {
  // 图元/管道数组与选中 id 集：selectedId 是 selectedIds 的兼容派生值。
  const elements = shallowRef<Element[]>([]);
  const pipes = shallowRef<Pipe[]>([]);
  const selectedIds = shallowRef<string[]>([]);
  // 单图元面板与原有绘制接口继续读取 selectedId；多选时该值为 null。
  const selectedId = computed<string | null>(() =>
    selectedIds.value.length === 1 ? selectedIds.value[0] ?? null : null
  );
  // 自增序号用于生成 'el_' + n / 'pipe_' + n 形式的唯一 id。
  let elementAutoIncrement = PRESET_ELEMENT_COUNT;
  let pipeAutoIncrement = PRESET_PIPE_COUNT;
  // 颜色轮换游标，每新建一个图元前进一格。
  let colorCursor = 0;

  // 撤销/重做历史栈：past 保存「变更前」的快照，future 保存已撤销的快照。
  const past = shallowRef<SceneSnapshot[]>([]);
  const future = shallowRef<SceneSnapshot[]>([]);
  // 应用历史快照期间置 true，守卫所有变更入口，避免恢复动作再次压栈。
  let isRestoring = false;
  // DSL 批量应用期间置 true，由 withHistoryBatch 统一提交一次历史。
  let isApplyingBatch = false;

  const canUndo = computed<boolean>(() => past.value.length > 0);
  const canRedo = computed<boolean>(() => future.value.length > 0);

  // 深拷贝当前画面；历史快照必须与 store 内部数组完全隔离。
  function captureSnapshot(): SceneSnapshot {
    return JSON.parse(
      JSON.stringify({ elements: elements.value, pipes: pipes.value })
    ) as SceneSnapshot;
  }

  // 把一份快照压入 past 并清空重做栈；超出上限时丢弃最旧记录。
  function pushPast(snapshot: SceneSnapshot): void {
    past.value = [...past.value, snapshot].slice(-HISTORY_LIMIT);
    future.value = [];
  }

  // 每次变更前登记当前画面；恢复历史或 DSL 批处理期间不得重复压栈。
  function commitHistory(snapshot?: SceneSnapshot): void {
    if (isRestoring || isApplyingBatch) {
      return;
    }
    pushPast(snapshot ?? captureSnapshot());
  }

  // 加载是一份新文档的起点：登记后立刻清空历史，避免撤销回上一份文档。
  function clearHistory(): void {
    past.value = [];
    future.value = [];
  }

  // 用快照覆盖当前画面；恢复期间守卫变更入口，并统一清空选中。
  function restoreSnapshot(snapshot: SceneSnapshot): void {
    isRestoring = true;
    try {
      elements.value = snapshot.elements.map((item) => ({ ...item }));
      pipes.value = snapshot.pipes.map((item) => ({ ...item }));
      selectedIds.value = [];
      colorCursor = elements.value.length;
      syncAutoIncrement(elements.value, pipes.value);
    } finally {
      isRestoring = false;
    }
  }

  // 撤销：当前画面进入 future，past 末条覆盖当前画面并清空选中。
  function undo(): void {
    const snapshot = past.value[past.value.length - 1];
    if (snapshot === undefined) {
      return;
    }
    future.value = [...future.value, captureSnapshot()];
    past.value = past.value.slice(0, -1);
    restoreSnapshot(snapshot);
  }

  // 重做：当前画面回到 past，future 末条覆盖当前画面并清空选中。
  function redo(): void {
    const snapshot = future.value[future.value.length - 1];
    if (snapshot === undefined) {
      return;
    }
    past.value = [...past.value, captureSnapshot()].slice(-HISTORY_LIMIT);
    future.value = future.value.slice(0, -1);
    restoreSnapshot(snapshot);
  }

  // DSL 整批应用：批内原始写接口不再逐条压栈，结束后按是否有实际变更登记一次。
  function withHistoryBatch<T>(mutate: () => T, hasChanges: (result: T) => boolean): T {
    if (isRestoring) {
      return mutate();
    }
    const before = captureSnapshot();
    const previousBatchState = isApplyingBatch;
    isApplyingBatch = true;
    let result: T;
    try {
      result = mutate();
    } finally {
      isApplyingBatch = previousBatchState;
    }
    if (!previousBatchState && hasChanges(result)) {
      // 整批只登记一次；此处 isApplyingBatch 已恢复，commitHistory 会真正压栈。
      commitHistory(before);
    }
    return result;
  }

  // 图层顺序由 elements 数组顺序表达（数组末尾最上层）；与相邻项交换。
  function bringForward(id: string): void {
    const index = elements.value.findIndex((item) => item.id === id);
    if (index === -1 || index === elements.value.length - 1) {
      return;
    }
    commitHistory();
    const next = [...elements.value];
    const moved = next[index];
    next[index] = next[index + 1];
    next[index + 1] = moved;
    elements.value = next;
  }

  // 下移一层同样只交换相邻项；已在最下层时为空操作且不压栈。
  function sendBackward(id: string): void {
    const index = elements.value.findIndex((item) => item.id === id);
    if (index === -1 || index <= 0) {
      return;
    }
    commitHistory();
    const next = [...elements.value];
    const moved = next[index];
    next[index] = next[index - 1];
    next[index - 1] = moved;
    elements.value = next;
  }

  // 拖动开始：记录拖动前快照；拖动过程中的 updateSelected 不再逐帧压栈。
  let dragSnapshot: SceneSnapshot | null = null;

  function beginDragHistory(): void {
    if (isRestoring || isApplyingBatch) {
      return;
    }
    dragSnapshot = captureSnapshot();
  }

  // 拖动结束：只有位置确实变化时才把拖动前快照压栈，整段拖动合并为一条历史。
  function commitDragHistory(): void {
    if (dragSnapshot === null) {
      return;
    }
    const before = dragSnapshot;
    dragSnapshot = null;
    if (isRestoring || isApplyingBatch) {
      return;
    }
    if (JSON.stringify(before) === JSON.stringify(captureSnapshot())) {
      return;
    }
    commitHistory(before);
  }

  // 拖动被取消（如组件卸载）时丢弃快照，不产生历史。
  function cancelDragHistory(): void {
    dragSnapshot = null;
  }

  // 派生当前选中图元，供属性面板与画布绘制直接读取。
  const selectedElement = computed<Element | null>(
    () => elements.value.find((item) => item.id === selectedId.value) ?? null
  );

  // 从现有 id 中恢复最大序号，避免加载存档后新增图元与旧数据冲突。
  function syncAutoIncrement(items: Element[], nextPipes: Pipe[]): void {
    let maxElementId = PRESET_ELEMENT_COUNT;
    for (const item of items) {
      const match = /^el_(\d+)$/.exec(item.id);
      if (match !== null) {
        maxElementId = Math.max(maxElementId, Number(match[1]));
      }
    }
    elementAutoIncrement = maxElementId;

    let maxPipeId = PRESET_PIPE_COUNT;
    for (const pipe of nextPipes) {
      const match = /^pipe_(\d+)$/.exec(pipe.id);
      if (match !== null) {
        maxPipeId = Math.max(maxPipeId, Number(match[1]));
      }
    }
    pipeAutoIncrement = maxPipeId;
  }

  // 生成下一个图元 id，保证与文档 §4 的 "el_" + 自增 规则一致。
  function nextElementId(): string {
    elementAutoIncrement += 1;
    return `el_${elementAutoIncrement}`;
  }

  // 生成下一个管道 id，形如 pipe_1、pipe_2。
  function nextPipeId(): string {
    pipeAutoIncrement += 1;
    return `pipe_${pipeAutoIncrement}`;
  }

  // describe 指令专用的最小写接口：按显式坐标创建图元，沿用既有 id/默认样式规则。
  function addElementRaw(input: NewElementInput): Element {
    commitHistory();
    const size = DEFAULT_SIZE[input.type];
    const element: Element = {
      id: nextElementId(),
      type: input.type,
      x: input.x,
      y: input.y,
      w: input.w ?? size.w,
      h: input.h ?? size.h,
      fill: input.fill ?? DEFAULT_COLORS[colorCursor % DEFAULT_COLORS.length],
      text: input.text ?? DEFAULT_TEXT[input.type],
      tagTemplateId: input.tagTemplateId ?? null,
      deviceNo: input.deviceNo ?? null
    };
    colorCursor += 1;
    elements.value = [...elements.value, element];
    selectedIds.value = [element.id];
    return element;
  }

  // 在给定中心点附近创建图元；坐标带随机偏移，避免多次添加完全重叠。
  // snapEnabled 为 true 时，最终 x/y 吸附到最近的 10 的倍数。
  function addElement(
    type: Element['type'],
    centerX: number,
    centerY: number,
    snapEnabled = false
  ): Element {
    commitHistory();
    const { w, h } = DEFAULT_SIZE[type];
    // 随机偏移范围取图元尺寸的 1/4，保证仍落在画布中央附近。
    const jitterX = (Math.random() - 0.5) * w * 0.5;
    const jitterY = (Math.random() - 0.5) * h * 0.5;
    const element: Element = {
      id: nextElementId(),
      type,
      x: snapEnabled
        ? snapToGrid(centerX - w / 2 + jitterX)
        : Math.round(centerX - w / 2 + jitterX),
      y: snapEnabled
        ? snapToGrid(centerY - h / 2 + jitterY)
        : Math.round(centerY - h / 2 + jitterY),
      w,
      h,
      fill: type === 'button' ? DEFAULT_COLORS[0] : DEFAULT_COLORS[colorCursor % DEFAULT_COLORS.length],
      text: DEFAULT_TEXT[type],
      tagTemplateId: null,
      deviceNo: null
    };
    colorCursor += 1;
    elements.value = [...elements.value, element];
    selectedIds.value = [element.id];
    return element;
  }

  // 新增一条有向管道；自环与同向重复连线直接忽略并返回 null。
  function addPipe(fromId: string, toId: string): Pipe | null {
    if (fromId === toId) {
      return null;
    }
    const duplicated = pipes.value.some((pipe) => pipe.fromId === fromId && pipe.toId === toId);
    if (duplicated) {
      return null;
    }
    commitHistory();
    const pipe: Pipe = { id: nextPipeId(), fromId, toId };
    pipes.value = [...pipes.value, pipe];
    return pipe;
  }

  // 按 id 删除管道；不存在时为空操作且不压栈，供「删线」变更入口统一登记历史。
  function removePipe(id: string): void {
    if (!pipes.value.some((pipe) => pipe.id === id)) {
      return;
    }
    commitHistory();
    pipes.value = pipes.value.filter((pipe) => pipe.id !== id);
  }

  // describe 指令专用的局部更新：只覆盖 patch 字段，未涉及图元保持原对象引用。
  function updateElementRaw(
    id: string,
    patch: Partial<Omit<Element, 'id' | 'type'>>
  ): boolean {
    const current = elements.value.find((item) => item.id === id);
    if (current === undefined) {
      return false;
    }
    // 空 patch / 等价 patch 不产生历史记录，保持撤销栈只包含真实变更。
    if (JSON.stringify(current) === JSON.stringify({ ...current, ...patch })) {
      return true;
    }
    commitHistory();
    elements.value = elements.value.map((item) =>
      item.id === id ? { ...item, ...patch } : item
    );
    return true;
  }

  // 删除与被删图元相关的全部管道，避免存档中出现悬空引用。
  function removePipesByElement(elId: string): void {
    pipes.value = pipes.value.filter((pipe) => pipe.fromId !== elId && pipe.toId !== elId);
  }

  // 按 id 删除图元；若删除的正是当前选中项，则一并取消选中。
  function removeElement(id: string): void {
    if (!elements.value.some((item) => item.id === id)) {
      return;
    }
    commitHistory();
    elements.value = elements.value.filter((item) => item.id !== id);
    removePipesByElement(id);
    selectedIds.value = selectedIds.value.filter((selected) => selected !== id);
  }

  // describe 指令专用的图和管道快照；返回浅拷贝，避免调用方持有 store 内部数组。
  function elementsSnapshot(): Element[] {
    return [...elements.value];
  }

  function pipesSnapshot(): Pipe[] {
    return [...pipes.value];
  }

  // describe 指令专用删除；复用现有删除语义（连同关联管道、清理选中态）。
  function removeElementRaw(id: string): void {
    removeElement(id);
  }

  // describe 指令专用管道新增；复用既有 id 生成与去重/自环保护。
  function addPipeRaw(fromId: string, toId: string): Pipe | null {
    return addPipe(fromId, toId);
  }

  // describe 指令专用清空；复用既有 clear 语义。
  function clearRaw(): void {
    clear();
  }

  // 删除当前选中的全部图元；一次操作只登记一条历史，并清理关联管道。
  function removeSelected(): void {
    const ids = new Set(selectedIds.value);
    if (ids.size === 0) {
      return;
    }
    commitHistory();
    elements.value = elements.value.filter((item) => !ids.has(item.id));
    pipes.value = pipes.value.filter(
      (pipe) => !ids.has(pipe.fromId) && !ids.has(pipe.toId)
    );
    selectedIds.value = [];
  }

  // 局部更新选中图元的属性，仅覆盖传入字段，即时驱动重绘。
  // recordHistory 默认为 true（属性表单每次提交压栈）；画布拖动传 false，
  // 由 mouseup/commitDragHistory() 以拖动前快照合并为一条历史。
  function updateSelected(
    patch: Partial<Omit<Element, 'id' | 'type'>>,
    options: { recordHistory?: boolean } = {}
  ): void {
    const id = selectedId.value;
    if (id === null) {
      return;
    }
    const current = elements.value.find((item) => item.id === id);
    if (current === undefined) {
      return;
    }
    if (JSON.stringify(current) === JSON.stringify({ ...current, ...patch })) {
      return;
    }
    if (options.recordHistory !== false) {
      commitHistory();
    }
    elements.value = elements.value.map((item) =>
      item.id === id ? { ...item, ...patch } : item
    );
  }

  // 整组拖动使用绝对落点写入，调用方按拖动起点计算目标坐标。
  function setElementPositions(
    positions: Array<{ id: string; x: number; y: number }>,
    options: { recordHistory?: boolean } = {}
  ): void {
    if (positions.length === 0) {
      return;
    }
    const nextPositions = new Map(positions.map((item) => [item.id, item]));
    let changed = false;
    const next = elements.value.map((item) => {
      const position = nextPositions.get(item.id);
      if (position === undefined || (item.x === position.x && item.y === position.y)) {
        return item;
      }
      changed = true;
      return { ...item, x: position.x, y: position.y };
    });
    if (!changed) {
      return;
    }
    if (options.recordHistory !== false) {
      commitHistory();
    }
    elements.value = next;
  }

  // 选中指定图元；传入 null 表示点空白处取消选中。
  function selectElement(id: string | null): void {
    selectedIds.value = id === null ? [] : [id];
  }

  // 整批替换选择集，过滤失效 id 并保持数组顺序。
  function selectElements(ids: string[]): void {
    const available = new Set(elements.value.map((item) => item.id));
    selectedIds.value = [...new Set(ids)].filter((id) => available.has(id));
  }

  // Shift 点击：已选则移除，未选则追加。
  function toggleElementSelection(id: string): void {
    if (!elements.value.some((item) => item.id === id)) {
      return;
    }
    selectedIds.value = selectedIds.value.includes(id)
      ? selectedIds.value.filter((selected) => selected !== id)
      : [...selectedIds.value, id];
  }

  // 过滤存档中的脏管道：两端图元必须存在、不得自环、不得同向重复。
  function sanitizePipes(nextPipes: Pipe[], nextElements: Element[]): Pipe[] {
    const elementIds = new Set(nextElements.map((item) => item.id));
    const seen = new Set<string>();
    const result: Pipe[] = [];
    for (const pipe of nextPipes) {
      if (!elementIds.has(pipe.fromId) || !elementIds.has(pipe.toId) || pipe.fromId === pipe.toId) {
        continue;
      }
      const key = `${pipe.fromId}->${pipe.toId}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      result.push({ ...pipe });
    }
    return result;
  }

  // 整体替换画布内容并取消选中，用于启动加载存档或从服务端重新加载。
  function loadScene(nextScene: Scene): void {
    // 加载属于「变更入口」，先按统一约定登记；随后清空历史以满足「新文档不撤销回旧文档」。
    commitHistory();
    elements.value = nextScene.elements.map((item) => ({ ...item }));
    // ASSUMPTION: 文档未规定脏管道处理，按无悬空引用原则丢弃两端图元不存在的记录。
    pipes.value = sanitizePipes(Array.isArray(nextScene.pipes) ? nextScene.pipes : [], elements.value);
    selectedIds.value = [];
    colorCursor = elements.value.length;
    syncAutoIncrement(elements.value, pipes.value);
    clearHistory();
  }

  // 构造保存用纯数据快照；savedAt 每次保存时刷新，body 必须带 pipes。
  function createSceneSnapshot(): Scene {
    return {
      version: 2,
      elements: elements.value.map((item) => ({ ...item })),
      pipes: pipes.value.map((item) => ({ ...item })),
      savedAt: new Date().toISOString()
    };
  }

  // 清空全部图元/管道并取消选中，仅作用于前端内存状态。
  function clear(): void {
    commitHistory();
    elements.value = [];
    pipes.value = [];
    selectedIds.value = [];
    elementAutoIncrement = PRESET_ELEMENT_COUNT;
    pipeAutoIncrement = PRESET_PIPE_COUNT;
    colorCursor = 0;
  }

  return {
    elements,
    pipes,
    selectedIds,
    selectedId,
    selectedElement,
    past,
    future,
    canUndo,
    canRedo,
    commitHistory,
    undo,
    redo,
    withHistoryBatch,
    bringForward,
    sendBackward,
    beginDragHistory,
    commitDragHistory,
    cancelDragHistory,
    addElement,
    addElementRaw,
    updateElementRaw,
    removeElementRaw,
    addPipeRaw,
    elementsSnapshot,
    pipesSnapshot,
    clearRaw,
    removeElement,
    removeSelected,
    removePipesByElement,
    updateSelected,
    setElementPositions,
    selectElement,
    selectElements,
    toggleElementSelection,
    addPipe,
    removePipe,
    loadScene,
    createSceneSnapshot,
    clear
  };
});
