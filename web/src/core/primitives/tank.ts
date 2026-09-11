// tank.ts：液位图元绘制（矩形轮廓 + 按量程从底部生长的填充与液面高亮线）。

import type { Element, ResolvedTag } from '../../types';
import { DEFAULT_ELEMENT_BLUE, TEXT_COLOR, clamp01, drawCenteredLines, readingLine } from './base';

// 绘制液位图元：矩形轮廓、从底部生长的填充和按当前值计算的液面高亮线。
export function drawTank(ctx: CanvasRenderingContext2D, el: Element, tag: ResolvedTag | undefined, value: number | undefined): void {
  const strokeColor = el.fill || DEFAULT_ELEMENT_BLUE;
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = 2;
  ctx.strokeRect(el.x, el.y, el.w, el.h);

  const fillHeight =
    tag === undefined || value === undefined || tag.max === tag.min
      ? 0
      : clamp01((value - tag.min) / (tag.max - tag.min)) * (el.h - 2);
  if (fillHeight > 0) {
    const fillY = el.y + el.h - 1 - fillHeight;
    ctx.fillStyle = strokeColor;
    ctx.globalAlpha = 0.72;
    ctx.fillRect(el.x + 1, fillY, el.w - 2, fillHeight);
    ctx.globalAlpha = 1;
    // 液面高亮线使用正文色，保持现有色板与足够的可见性。
    ctx.strokeStyle = TEXT_COLOR;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(el.x + 1, fillY);
    ctx.lineTo(el.x + el.w - 1, fillY);
    ctx.stroke();
  }

  drawCenteredLines(ctx, [el.text, readingLine(tag, value)], el);
}
