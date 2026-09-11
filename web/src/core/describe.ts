// describe.ts：声明式画面描述层，把 JSON 指令解析为 scene store 的最小写操作。
// 该模块只依赖类型与调用方传入的 DescribeContext，不直接依赖 Vue/Pinia。

import type { Element, Pipe } from '../types';

export type SceneOp =
  | {
      op: 'add';
      kind: 'rect' | 'circle' | 'text';
      x: number;
      y: number;
      w?: number;
      h?: number;
      text?: string;
      fill?: string;
      tagTemplateId?: string | null;
      deviceNo?: number | null;
    }
  | { op: 'update'; id: string; patch: Partial<Omit<Element, 'id' | 'type'>> }
  | { op: 'remove'; id: string }
  | { op: 'pipe'; from: string; to: string }
  | {
      op: 'generate';
      kind: 'rect' | 'circle' | 'text';
      deviceNos: number[];
      tagTemplateId: string;
      origin: { x: number; y: number };
      gap: { x: number; y: number };
      textTemplate?: string;
    }
  | { op: 'clear' };

export interface OpResult {
  applied: number;
  added: string[];
  updated: string[];
  removed: string[];
  errors: string[];
}

export interface SceneSnapshot {
  elements: Element[];
  pipes: Pipe[];
}

// describe.ts 只负责计算新建图元的业务字段，id 和默认颜色/文字由 scene store 生成。
export type NewElementInput = Omit<
  Element,
  'id' | 'type' | 'w' | 'h' | 'fill' | 'text' | 'tagTemplateId' | 'deviceNo'
> & {
  type: Element['type'];
  w?: number;
  h?: number;
  fill?: string;
  text?: string;
  tagTemplateId?: string | null;
  deviceNo?: number | null;
};

export interface DescribeContext {
  addElementRaw(element: NewElementInput): Element;
  removeElementRaw(id: string): void;
  updateElementRaw(id: string, patch: Partial<Omit<Element, 'id' | 'type'>>): boolean;
  addPipeRaw(fromId: string, toId: string): Pipe | null;
  // generate 未提供 textTemplate 时，由调用方按模板 id 提供模板名；核心不内置中文名猜测。
  getTemplateName?(tagTemplateId: string): string | undefined;
  clearRaw(): void;
  elementsSnapshot(): Element[];
  pipesSnapshot(): Pipe[];
}

type DescribeKind = 'rect' | 'circle' | 'text';
type AddData = {
  kind: DescribeKind;
  x: number;
  y: number;
  w?: number;
  h?: number;
  text?: string;
  fill?: string;
  tagTemplateId?: string | null;
  deviceNo?: number | null;
};
type GenerateData = {
  kind: DescribeKind;
  deviceNos: number[];
  tagTemplateId: string;
  origin: { x: number; y: number };
  gap: { x: number; y: number };
  textTemplate?: string;
};

const DEFAULT_SIZE: Record<DescribeKind, { w: number; h: number }> = {
  rect: { w: 120, h: 80 },
  circle: { w: 100, h: 100 },
  text: { w: 140, h: 40 }
};

const UPDATE_KEYS = new Set(['x', 'y', 'w', 'h', 'fill', 'text', 'tagTemplateId', 'deviceNo']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isKind(value: unknown): value is DescribeKind {
  return value === 'rect' || value === 'circle' || value === 'text';
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isPositiveNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isDeviceNo(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function toElementType(kind: DescribeKind): Element['type'] {
  return kind === 'text' ? 'label' : kind;
}

function buildElementInput(
  data: AddData,
  fallback: { tagTemplateId?: string | null; deviceNo?: number | null; text?: string } = {}
): NewElementInput {
  const size = DEFAULT_SIZE[data.kind];
  const input: NewElementInput = {
    type: toElementType(data.kind),
    x: data.x,
    y: data.y,
    w: data.w ?? size.w,
    h: data.h ?? size.h,
    tagTemplateId: data.tagTemplateId ?? fallback.tagTemplateId ?? null,
    deviceNo: data.deviceNo ?? fallback.deviceNo ?? null
  };

  const text = data.text ?? fallback.text;
  if (text !== undefined) {
    input.text = text;
  }
  if (data.fill !== undefined) {
    input.fill = data.fill;
  }
  return input;
}

function parseAddData(raw: Record<string, unknown>): AddData | string {
  if (!isKind(raw.kind)) {
    return `未知 kind：${String(raw.kind)}`;
  }
  if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.y)) {
    return 'x/y 必须是有限数字';
  }
  if (raw.w !== undefined && !isPositiveNumber(raw.w)) {
    return 'w 必须是正数';
  }
  if (raw.h !== undefined && !isPositiveNumber(raw.h)) {
    return 'h 必须是正数';
  }
  if (raw.text !== undefined && typeof raw.text !== 'string') {
    return 'text 必须是字符串';
  }
  if (raw.fill !== undefined && typeof raw.fill !== 'string') {
    return 'fill 必须是字符串';
  }
  if (
    raw.tagTemplateId !== undefined &&
    raw.tagTemplateId !== null &&
    typeof raw.tagTemplateId !== 'string'
  ) {
    return 'tagTemplateId 必须是字符串或 null';
  }
  if (raw.deviceNo !== undefined && raw.deviceNo !== null && !isDeviceNo(raw.deviceNo)) {
    return 'deviceNo 必须是正整数或 null';
  }

  return {
    kind: raw.kind,
    x: raw.x,
    y: raw.y,
    w: raw.w as number | undefined,
    h: raw.h as number | undefined,
    text: raw.text as string | undefined,
    fill: raw.fill as string | undefined,
    tagTemplateId: raw.tagTemplateId as string | null | undefined,
    deviceNo: raw.deviceNo as number | null | undefined
  };
}

function parseGenerateData(raw: Record<string, unknown>): GenerateData | string {
  if (!isKind(raw.kind)) {
    return `未知 kind：${String(raw.kind)}`;
  }
  if (!Array.isArray(raw.deviceNos) || !raw.deviceNos.every(isDeviceNo)) {
    return 'deviceNos 必须是正整数数组';
  }
  if (!isNonEmptyString(raw.tagTemplateId)) {
    return 'tagTemplateId 必须是非空字符串';
  }
  if (!isRecord(raw.origin) || !isFiniteNumber(raw.origin.x) || !isFiniteNumber(raw.origin.y)) {
    return 'origin.x/origin.y 必须是有限数字';
  }
  if (!isRecord(raw.gap) || !isFiniteNumber(raw.gap.x) || !isFiniteNumber(raw.gap.y)) {
    return 'gap.x/gap.y 必须是有限数字';
  }
  if (raw.textTemplate !== undefined && typeof raw.textTemplate !== 'string') {
    return 'textTemplate 必须是字符串';
  }

  return {
    kind: raw.kind,
    deviceNos: raw.deviceNos as number[],
    tagTemplateId: raw.tagTemplateId,
    origin: { x: raw.origin.x, y: raw.origin.y },
    gap: { x: raw.gap.x, y: raw.gap.y },
    textTemplate: raw.textTemplate as string | undefined
  };
}

function parsePatch(raw: unknown): Partial<Omit<Element, 'id' | 'type'>> | string {
  if (!isRecord(raw)) {
    return 'patch 必须是对象';
  }

  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'id' || key === 'type') {
      return `patch 不允许修改 ${key}`;
    }
    if (!UPDATE_KEYS.has(key)) {
      return `patch 不支持字段 ${key}`;
    }

    if ((key === 'x' || key === 'y') && !isFiniteNumber(value)) {
      return `${key} 必须是有限数字`;
    }
    if ((key === 'w' || key === 'h') && !isPositiveNumber(value)) {
      return `${key} 必须是正数`;
    }
    if ((key === 'fill' || key === 'text') && typeof value !== 'string') {
      return `${key} 必须是字符串`;
    }
    if (key === 'tagTemplateId' && value !== null && typeof value !== 'string') {
      return 'tagTemplateId 必须是字符串或 null';
    }
    if (key === 'deviceNo' && value !== null && !isDeviceNo(value)) {
      return 'deviceNo 必须是正整数或 null';
    }
    patch[key] = value;
  }

  return patch as Partial<Omit<Element, 'id' | 'type'>>;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// describeScene 导出 clear + add + pipe，pipe 通过 applyOps 内部的旧 id 别名映射得到等价端点。
export function describeScene(scene: SceneSnapshot): SceneOp[] {
  const ops: SceneOp[] = [{ op: 'clear' }];

  for (const element of scene.elements) {
    // DSL 的 kind 保持 rect/circle/text；按钮和本轮新增专用图元不扩展 DSL 表达能力。
    if (element.type !== 'rect' && element.type !== 'circle' && element.type !== 'label') {
      continue;
    }
    ops.push({
      op: 'add',
      kind: element.type === 'label' ? 'text' : element.type,
      x: element.x,
      y: element.y,
      w: element.w,
      h: element.h,
      text: element.text,
      fill: element.fill,
      tagTemplateId: element.tagTemplateId,
      deviceNo: element.deviceNo
    });
  }

  for (const pipe of scene.pipes) {
    ops.push({ op: 'pipe', from: pipe.fromId, to: pipe.toId });
  }

  return ops;
}

export function applyOps(ops: SceneOp[], ctx: DescribeContext): OpResult {
  const result: OpResult = {
    applied: 0,
    added: [],
    updated: [],
    removed: [],
    errors: []
  };

  if (!Array.isArray(ops)) {
    result.errors.push('指令必须是数组');
    return result;
  }

  const elementIds = new Set<string>();
  const pipeKeys = new Set<string>();
  let clearSourceIds: string[] = [];
  let clearAddIndex = 0;
  let idAliases = new Map<string, string>();

  try {
    for (const element of ctx.elementsSnapshot()) {
      elementIds.add(element.id);
    }
    for (const pipe of ctx.pipesSnapshot()) {
      pipeKeys.add(`${pipe.fromId}->${pipe.toId}`);
    }
  } catch (error) {
    result.errors.push(`读取画面失败：${errorText(error)}`);
    return result;
  }

  function resolveElementId(id: string): string {
    if (elementIds.has(id)) {
      return id;
    }
    const alias = idAliases.get(id);
    return alias !== undefined && elementIds.has(alias) ? alias : id;
  }

  function recordAdded(element: Element): void {
    result.added.push(element.id);
    elementIds.add(element.id);
    if (clearAddIndex < clearSourceIds.length) {
      const sourceId = clearSourceIds[clearAddIndex];
      if (!idAliases.has(sourceId)) {
        idAliases.set(sourceId, element.id);
      }
      clearAddIndex += 1;
    }
  }

  function removePipeKeysForElement(id: string): void {
    for (const key of pipeKeys) {
      if (key.startsWith(`${id}->`) || key.endsWith(`->${id}`)) {
        pipeKeys.delete(key);
      }
    }
  }

  for (let index = 0; index < ops.length; index += 1) {
    const raw: unknown = ops[index];

    try {
      if (!isRecord(raw) || typeof raw.op !== 'string') {
        result.errors.push(`[${index}] 非法指令：必须是带 op 的对象`);
        continue;
      }

      if (raw.op === 'add') {
        const data = parseAddData(raw);
        if (typeof data === 'string') {
          result.errors.push(`[${index}] add ${data}`);
          continue;
        }
        const element = ctx.addElementRaw(buildElementInput(data));
        recordAdded(element);
        result.applied += 1;
        continue;
      }

      if (raw.op === 'update') {
        if (!isNonEmptyString(raw.id)) {
          result.errors.push(`[${index}] update id 必须是非空字符串`);
          continue;
        }
        const patch = parsePatch(raw.patch);
        if (typeof patch === 'string') {
          result.errors.push(`[${index}] update ${patch}`);
          continue;
        }
        if (!ctx.updateElementRaw(raw.id, patch)) {
          result.errors.push(`[${index}] update 图元不存在：${raw.id}`);
          continue;
        }
        result.updated.push(raw.id);
        result.applied += 1;
        continue;
      }

      if (raw.op === 'remove') {
        if (!isNonEmptyString(raw.id)) {
          result.errors.push(`[${index}] remove id 必须是非空字符串`);
          continue;
        }
        const id = resolveElementId(raw.id);
        if (!elementIds.has(id)) {
          result.errors.push(`[${index}] remove 图元不存在：${raw.id}`);
          continue;
        }
        ctx.removeElementRaw(id);
        elementIds.delete(id);
        removePipeKeysForElement(id);
        result.removed.push(id);
        result.applied += 1;
        continue;
      }

      if (raw.op === 'pipe') {
        if (!isNonEmptyString(raw.from) || !isNonEmptyString(raw.to)) {
          result.errors.push(`[${index}] pipe from/to 必须是非空字符串`);
          continue;
        }
        if (raw.from === raw.to) {
          result.errors.push(`[${index}] pipe 不允许自环：${raw.from}`);
          continue;
        }
        const from = resolveElementId(raw.from);
        const to = resolveElementId(raw.to);
        if (!elementIds.has(from) || !elementIds.has(to)) {
          result.errors.push(`[${index}] pipe 端点不存在：${raw.from} -> ${raw.to}`);
          continue;
        }
        if (from === to) {
          result.errors.push(`[${index}] pipe 不允许自环：${raw.from}`);
          continue;
        }
        const key = `${from}->${to}`;
        if (pipeKeys.has(key)) {
          result.errors.push(`[${index}] pipe 已存在：${raw.from} -> ${raw.to}`);
          continue;
        }
        const pipe = ctx.addPipeRaw(from, to);
        if (pipe === null) {
          result.errors.push(`[${index}] pipe 创建失败：${raw.from} -> ${raw.to}`);
          continue;
        }
        pipeKeys.add(key);
        result.applied += 1;
        continue;
      }

      if (raw.op === 'generate') {
        const data = parseGenerateData(raw);
        if (typeof data === 'string') {
          result.errors.push(`[${index}] generate ${data}`);
          continue;
        }
        for (let deviceIndex = 0; deviceIndex < data.deviceNos.length; deviceIndex += 1) {
          const deviceNo = data.deviceNos[deviceIndex];
          const templateName = ctx.getTemplateName?.(data.tagTemplateId);
          const text =
            data.textTemplate === undefined
              ? templateName
              : data.textTemplate.split('{n}').join(String(deviceNo));
          const fallback = { tagTemplateId: data.tagTemplateId, deviceNo, text };
          const element = ctx.addElementRaw(
            buildElementInput(
              {
                kind: data.kind,
                x: data.origin.x + data.gap.x * deviceIndex,
                y: data.origin.y + data.gap.y * deviceIndex
              },
              fallback
            )
          );
          recordAdded(element);
        }
        result.applied += 1;
        continue;
      }

      if (raw.op === 'clear') {
        const sourceIds = [...elementIds];
        ctx.clearRaw();
        elementIds.clear();
        pipeKeys.clear();
        idAliases.clear();
        clearSourceIds = sourceIds;
        clearAddIndex = 0;
        result.removed.push(...sourceIds);
        result.applied += 1;
        continue;
      }

      result.errors.push(`[${index}] 未知指令：${raw.op}`);
    } catch (error) {
      result.errors.push(`[${index}] 执行失败：${errorText(error)}`);
    }
  }

  return result;
}
