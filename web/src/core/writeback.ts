// writeback.ts：按钮图元写回的纯工具与 HTTP 调用，不持有 Vue 状态。
// 网络异常统一转为 result 对象，调用方无需在事件处理里额外 try/catch。

import type { TagTemplate } from '../types';

export interface WriteTagResult {
  ok: boolean;
  value?: number;
  error?: string;
  message?: string;
}

// 调用 POST /api/write；HTTP 非 2xx 与网络异常都返回 ok:false，不向调用方抛出。
export async function writeTag(
  deviceNo: number,
  tagTemplateId: string,
  value: number
): Promise<WriteTagResult> {
  try {
    const response = await fetch('/api/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ deviceNo, tagTemplateId, value })
    });

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const errorPayload =
        payload !== null && typeof payload === 'object' && !Array.isArray(payload)
          ? (payload as { error?: unknown; message?: unknown })
          : {};
      return {
        ok: false,
        error: typeof errorPayload.error === 'string' ? errorPayload.error : 'http_error',
        message: typeof errorPayload.message === 'string' ? errorPayload.message : `HTTP ${response.status}`
      };
    }

    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return { ok: false, error: 'invalid_response', message: '服务端返回格式异常' };
    }

    const successPayload = payload as { ok?: unknown; value?: unknown };
    return {
      ok: successPayload.ok === true,
      value: typeof successPayload.value === 'number' ? successPayload.value : undefined
    };
  } catch {
    return { ok: false, error: 'network' };
  }
}

// 闭环切换语义：当前值靠上限时切到量程 20%，否则切到量程 80%。
export function nextToggleValue(min: number, max: number, current: number): number {
  const range = max - min;
  const middle = min + range * 0.5;
  if (current >= middle) {
    return min + range * 0.2;
  }
  return min + range * 0.8;
}

// 判断模板是否存在且可写，供画布点击前做本地兜底校验。
export function isWritableTemplate(
  tagTemplateId: string | null,
  templates: TagTemplate[]
): boolean {
  if (tagTemplateId === null) {
    return false;
  }
  return templates.some(
    (template) => template.tagTemplateId === tagTemplateId && template.writable === true
  );
}
