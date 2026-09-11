// lamp.ts：指示灯图元绘制（正常绿、报警红闪、未绑定灰）。

import type { Element, ResolvedTag } from '../../types';
import { ALARM_COLOR, LAMP_GRAY, LAMP_GREEN, drawCenteredLines, isAlarmFlashBright, readingLine } from './base';

// 绘制指示灯：正常绿、报警红闪烁、无值/未绑定灰；外圈用同心圆模拟光晕。
export function drawLamp(
  ctx: CanvasRenderingContext2D,
  el: Element,
  tag: ResolvedTag | undefined,
  value: number | undefined,
  alarming: boolean,
  now: number
): void {
  const diameter = Math.min(Math.abs(el.w), Math.abs(el.h));
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const radius = diameter / 2;
  const color = alarming ? ALARM_COLOR : value === undefined ? LAMP_GRAY : LAMP_GREEN;
  const flashAlpha = alarming && !isAlarmFlashBright(now) ? 0.3 : 1;

  ctx.save();
  ctx.fillStyle = color;
  const glowLayers = [
    { radius: radius * 1.22, alpha: 0.12 },
    { radius: radius * 1.1, alpha: 0.2 },
    { radius: radius * 0.86, alpha: 0.55 }
  ];
  for (const layer of glowLayers) {
    if (layer.radius <= 0) {
      continue;
    }
    ctx.globalAlpha = layer.alpha * flashAlpha;
    ctx.beginPath();
    ctx.arc(cx, cy, layer.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = flashAlpha;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  drawCenteredLines(ctx, [el.text, readingLine(tag, value)], el);
}
