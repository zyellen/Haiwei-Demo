// hitTest.ts：画布命中检测，判断逻辑坐标落在哪个图元内。
// 检测按 z 序从后往前（后添加的优先），与绘制层叠顺序保持一致。

import type { Element } from '../types';

// 判断点 (px, py) 是否落在单个图元范围内；三类图元统一使用包围盒。
export function isPointInElement(el: Element, px: number, py: number): boolean {
  return px >= el.x && px <= el.x + el.w && py >= el.y && py <= el.y + el.h;
}

// 返回命中的最上层图元；未命中时返回 null。
// 从数组末尾向前遍历，天然实现“后添加优先命中”的 z 序语义。
export function hitTestElements(elements: Element[], px: number, py: number): Element | null {
  for (let i = elements.length - 1; i >= 0; i -= 1) {
    const el = elements[i];
    if (el !== undefined && isPointInElement(el, px, py)) {
      return el;
    }
  }
  return null;
}
