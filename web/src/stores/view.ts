// view.ts：画布视图状态仓库，维护缩放/平移与网格吸附开关，不参与 scene.json 持久化。

import { shallowRef } from 'vue';
import { defineStore } from 'pinia';

// 缩放范围与吸附网格间距；GRID 只影响落点写入，不改变现有网格绘制间距。
export const MIN_SCALE = 0.5;
export const MAX_SCALE = 2;
export const GRID = 10;

function clampScale(value: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

// 把任意坐标吸附到最近的 GRID 倍数。
export function snapToGrid(value: number): number {
  return Math.round(value / GRID) * GRID;
}

export const useViewStore = defineStore('view', () => {
  const scale = shallowRef(1);
  const offsetX = shallowRef(0);
  const offsetY = shallowRef(0);
  const snapEnabled = shallowRef(true);

  // 以逻辑坐标锚点缩放：保持锚点当前对应的屏幕位置不变。
  function zoomAt(logicalAnchorX: number, logicalAnchorY: number, factor: number): void {
    const previousScale = scale.value;
    const nextScale = clampScale(previousScale * factor);
    if (nextScale === previousScale) {
      return;
    }
    offsetX.value += logicalAnchorX * (previousScale - nextScale);
    offsetY.value += logicalAnchorY * (previousScale - nextScale);
    scale.value = nextScale;
  }

  // 平移量使用屏幕像素；缩放后仍保持与鼠标位移一致。
  function panBy(dxPx: number, dyPx: number): void {
    offsetX.value += dxPx;
    offsetY.value += dyPx;
  }

  function resetView(): void {
    scale.value = 1;
    offsetX.value = 0;
    offsetY.value = 0;
  }

  function toggleSnap(): void {
    snapEnabled.value = !snapEnabled.value;
  }

  return {
    scale,
    offsetX,
    offsetY,
    snapEnabled,
    zoomAt,
    panBy,
    resetView,
    toggleSnap
  };
});
