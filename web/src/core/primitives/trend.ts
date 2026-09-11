// trend.ts：趋势图图元绘制（窗口、内网格、最近 60 点折线与越限红线）。

import type { Element, ResolvedTag } from '../../types';
import { ALARM_COLOR, CANVAS_BG, DEFAULT_ELEMENT_BLUE, GRID_COLOR, TEXT_COLOR, roundRectPath } from './base';

// 趋势图量程：优先使用模板 min/max，并在采样越出模板量程时扩展到数据范围。
function trendRange(tag: ResolvedTag | undefined, samples: readonly number[]): { min: number; max: number } {
  let min = tag?.min ?? 0;
  let max = tag?.max ?? 1;
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    min = samples[0] ?? 0;
    max = samples[0] ?? 1;
  }
  for (const sample of samples) {
    min = Math.min(min, sample);
    max = Math.max(max, sample);
  }
  if (min === max) {
    const padding = Math.max(1, Math.abs(min) * 0.1);
    min -= padding;
    max += padding;
  }
  return { min, max };
}

function formatRangeValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

// 绘制趋势图：窗口、内网格、最近 60 点折线、量程文字；越限线段统一使用报警红。
export function drawTrend(
  ctx: CanvasRenderingContext2D,
  el: Element,
  tag: ResolvedTag | undefined,
  samples: readonly number[]
): void {
  const fill = el.fill || DEFAULT_ELEMENT_BLUE;
  roundRectPath(ctx, el.x, el.y, el.w, el.h, 6);
  ctx.fillStyle = CANVAS_BG;
  ctx.fill();
  ctx.strokeStyle = fill;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const paddingX = 8;
  const paddingTop = 20;
  const paddingBottom = 20;
  const plotX = el.x + paddingX;
  const plotY = el.y + paddingTop;
  const plotWidth = Math.max(0, el.w - paddingX * 2);
  const plotHeight = Math.max(0, el.h - paddingTop - paddingBottom);

  ctx.save();
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let column = 0; column <= 4; column += 1) {
    const x = plotX + (plotWidth * column) / 4;
    ctx.moveTo(x, plotY);
    ctx.lineTo(x, plotY + plotHeight);
  }
  for (let row = 0; row <= 3; row += 1) {
    const y = plotY + (plotHeight * row) / 3;
    ctx.moveTo(plotX, y);
    ctx.lineTo(plotX + plotWidth, y);
  }
  ctx.stroke();
  ctx.restore();

  ctx.fillStyle = TEXT_COLOR;
  ctx.font = '12px "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(el.text, el.x + paddingX, el.y + 5);

  const range = trendRange(tag, samples);
  if (samples.length > 0 && plotWidth > 0 && plotHeight > 0) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(plotX, plotY, plotWidth, plotHeight);
    ctx.clip();

    const pointX = (index: number): number =>
      plotX + (samples.length === 1 ? plotWidth / 2 : (plotWidth * index) / (samples.length - 1));
    const pointY = (sample: number): number =>
      plotY + plotHeight - ((sample - range.min) / (range.max - range.min)) * plotHeight;

    if (samples.length === 1) {
      ctx.beginPath();
      ctx.arc(pointX(0), pointY(samples[0] ?? range.min), 2.5, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
    } else {
      for (let index = 1; index < samples.length; index += 1) {
        const previous = samples[index - 1] ?? range.min;
        const current = samples[index] ?? range.min;
        const outOfLimit =
          (tag?.alarmHigh !== null && tag?.alarmHigh !== undefined && (previous > tag.alarmHigh || current > tag.alarmHigh)) ||
          (tag?.alarmLow !== null && tag?.alarmLow !== undefined && (previous < tag.alarmLow || current < tag.alarmLow));
        ctx.beginPath();
        ctx.moveTo(pointX(index - 1), pointY(previous));
        ctx.lineTo(pointX(index), pointY(current));
        ctx.strokeStyle = outOfLimit ? ALARM_COLOR : fill;
        ctx.lineWidth = outOfLimit ? 2 : 1.5;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  ctx.fillStyle = TEXT_COLOR;
  ctx.font = '11px "Helvetica Neue", Arial, sans-serif';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  const unit = tag?.unit === undefined || tag.unit.length === 0 ? '' : ` ${tag.unit}`;
  ctx.fillText(
    `${formatRangeValue(range.min)}~${formatRangeValue(range.max)}${unit}`,
    el.x + el.w - 6,
    el.y + el.h - 5
  );
}
