// migrate.ts：把服务端旧存档升级为 Scene v2；未知字段只做保守处理，不丢弃图元。
// 迁移表只服务于 version 1（或缺失版本）的历史 tagId，不参与新画面运行时绑定。

import type { Element, Pipe, Scene } from '../types';

// 旧 tagId 到「点位模板 + 设备号」的兼容映射。
const LEGACY_TAG_BINDINGS: Record<string, { tagTemplateId: string; deviceNo: number }> = {
  'tank1.level': { tagTemplateId: 'tpl.level', deviceNo: 1 },
  'tank2.level': { tagTemplateId: 'tpl.level', deviceNo: 2 },
  'motor1.speed': { tagTemplateId: 'tpl.speed', deviceNo: 1 },
  'motor1.current': { tagTemplateId: 'tpl.current', deviceNo: 1 },
  'pump1.temp': { tagTemplateId: 'tpl.temp', deviceNo: 1 },
  'pump1.pressure': { tagTemplateId: 'tpl.pressure', deviceNo: 1 },
  'valve1.open': { tagTemplateId: 'tpl.valve', deviceNo: 1 },
  'valve2.open': { tagTemplateId: 'tpl.valve', deviceNo: 2 }
};

const ELEMENT_TYPES: Element['type'][] = [
  'rect',
  'circle',
  'label',
  'button',
  'tank',
  'motor',
  'lamp',
  'trend'
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function readElementType(value: unknown): Element['type'] {
  return ELEMENT_TYPES.includes(value as Element['type']) ? (value as Element['type']) : 'rect';
}

// 将任意旧图元补齐为 v2 字段；未知 tagId 保留图元本体并清空绑定。
function upgradeElement(raw: unknown, index: number): Element {
  const source = isRecord(raw) ? raw : {};
  const legacyTagId = typeof source.tagId === 'string' ? source.tagId : null;
  const binding = legacyTagId === null ? undefined : LEGACY_TAG_BINDINGS[legacyTagId];

  return {
    id: readString(source.id, `el_${index + 1}`),
    type: readElementType(source.type),
    x: readNumber(source.x, 0),
    y: readNumber(source.y, 0),
    w: readNumber(source.w, 120),
    h: readNumber(source.h, 80),
    fill: readString(source.fill, '#5a9ade'),
    text: readString(source.text, ''),
    tagTemplateId: binding?.tagTemplateId ?? null,
    deviceNo: binding?.deviceNo ?? null
  };
}

// 管道沿用 v2 结构；无法识别为字符串的端点置空后由 scene store 的管道清洗逻辑剔除。
function upgradePipe(raw: unknown, index: number): Pipe {
  const source = isRecord(raw) ? raw : {};
  return {
    id: readString(source.id, `pipe_${index + 1}`),
    fromId: readString(source.fromId, ''),
    toId: readString(source.toId, '')
  };
}

// 把服务端返回值升级为 Scene v2；version 2 原样返回，保持调用方当前行为。
export function upgradeScene(raw: unknown): Scene {
  if (isRecord(raw) && raw.version === 2) {
    return raw as unknown as Scene;
  }

  const source = isRecord(raw) ? raw : {};
  const rawElements = Array.isArray(source.elements) ? source.elements : [];
  const rawPipes = Array.isArray(source.pipes) ? source.pipes : [];

  return {
    version: 2,
    elements: rawElements.map(upgradeElement),
    pipes: rawPipes.map(upgradePipe),
    savedAt: new Date().toISOString()
  };
}
