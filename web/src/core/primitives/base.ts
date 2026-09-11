// base.ts：基础图元与公共绘制工具，集中颜色/描边常量与 rect/circle/label/button 复用的底层能力。
// 基础图元的分支仍由 draw.ts 的 drawElement 调度，这里只提供它们共用的工具函数。

import type { Element, ResolvedTag } from '../../types';

// 画布与图元配色常量，取值严格对齐开发文档 §6.1。
export const CANVAS_BG = '#14181d';
export const GRID_COLOR = '#22262a';
export const ALARM_COLOR = '#e05252';
export const PIPE_COLOR = '#4a4f55';
export const SELECT_COLOR = '#d9b45b';
export const LAMP_GREEN = '#7ab55c';
// 未绑定指示灯与管道共用同一灰色；集中定义避免同一色值重复出现。
export const LAMP_GRAY = PIPE_COLOR;
export const DEFAULT_ELEMENT_BLUE = '#5a9ade';
export const TEXT_COLOR = '#ffffff';
export const TEXT_FONT = '13px "Helvetica Neue", Arial, sans-serif';

// 报警闪烁周期：以 500ms 为半周期在填充原色与报警红之间切换。
export const FLASH_PERIOD_MS = 500;
// 趋势图最多绘制 60 个采样，与 runtime store 的单键历史上限保持一致。
export const TREND_HISTORY_LIMIT = 60;
// 非趋势图元共用只读空历史，避免渲染循环中反复创建临时数组。
export const EMPTY_HISTORY: readonly number[] = [];

// 绘制圆角矩形路径；自行实现以避免依赖较新的 ctx.roundRect 接口。
export function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number
): void {
  // 半径不能超过宽高的一半，防止小尺寸图元画出异常形状。
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// 按报警闪烁规则计算当前填充色：未报警恒为原色，报警时按 500ms 周期切换。
export function resolveFillColor(fill: string, alarming: boolean, now: number): string {
  if (!alarming) {
    return fill;
  }
  // Date.now()/500 取整后对 2 取模，得到 0/1 两种相位，即 500ms 亮暗交替。
  return Math.floor(now / FLASH_PERIOD_MS) % 2 === 0 ? fill : ALARM_COLOR;
}

// 报警闪烁的亮/暗相位：亮相位显示报警红，暗相位降低透明度但仍保持红色。
export function isAlarmFlashBright(now: number): boolean {
  return Math.floor(now / FLASH_PERIOD_MS) % 2 === 0;
}

// 将值线性钳制到 0..1；量程非法时返回 0，避免 NaN 进入绘制路径。
export function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

// 点位读数的第二行文字：未绑定显示“未绑定”，有绑定无值显示“--”。
export function readingLine(tag: ResolvedTag | undefined, value: number | undefined): string {
  if (tag === undefined) {
    return '未绑定';
  }
  const displayValue = value === undefined ? '--' : value.toFixed(1);
  return `${tag.name}: ${displayValue} ${tag.unit}`;
}

// 在图元中心绘制一到两行文字，供 rect 与 circle 复用。
export function drawCenteredLines(ctx: CanvasRenderingContext2D, lines: string[], el: Element): void {
  const visibleLines = lines.filter((line) => line.length > 0);
  if (visibleLines.length === 0) {
    return;
  }
  ctx.save();
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = TEXT_FONT;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lineGap = 16;
  const centerY = el.y + el.h / 2;
  const firstY = centerY - ((visibleLines.length - 1) * lineGap) / 2;
  visibleLines.forEach((line, index) => {
    ctx.fillText(line, el.x + el.w / 2, firstY + index * lineGap);
  });
  ctx.restore();
}

// 绘制 label 的两行文本：第一行为 text，第二行在绑定点位模板时显示点位读数。
export function drawLabelText(ctx: CanvasRenderingContext2D, el: Element, tag: ResolvedTag | undefined, displayValue: string): void {
  ctx.save();
  ctx.fillStyle = TEXT_COLOR;
  ctx.font = TEXT_FONT;
  // ASSUMPTION: 文档未规定 label 对齐方式，选用左对齐 + 纵向居中，更接近工程读数面板。
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const paddingX = 6;
  const hasSecondLine = tag !== undefined;
  // 两行文字整体在 h 内纵向居中；只有一行时直接落在中线上。
  const centerY = el.y + el.h / 2;
  const lineGap = 16;
  if (hasSecondLine) {
    ctx.fillText(el.text, el.x + paddingX, centerY - lineGap / 2);
    // 取不到值时仍按文档要求显示 "--"。
    ctx.fillText(`${tag.name}: ${displayValue} ${tag.unit}`, el.x + paddingX, centerY + lineGap / 2);
  } else {
    ctx.fillText(el.text, el.x + paddingX, centerY);
  }
  ctx.restore();
}

// 按图元外轮廓叠加报警描边：圆/电机/灯使用圆，其余使用矩形或圆角矩形。
export function drawAlarmOutline(ctx: CanvasRenderingContext2D, el: Element): void {
  ctx.strokeStyle = ALARM_COLOR;
  ctx.lineWidth = 3;
  if (el.type === 'circle') {
    ctx.beginPath();
    ctx.ellipse(
      el.x + el.w / 2,
      el.y + el.h / 2,
      Math.abs(el.w / 2),
      Math.abs(el.h / 2),
      0,
      0,
      Math.PI * 2
    );
    ctx.stroke();
    return;
  }
  if (el.type === 'motor' || el.type === 'lamp') {
    ctx.beginPath();
    ctx.arc(
      el.x + el.w / 2,
      el.y + el.h / 2,
      Math.min(Math.abs(el.w), Math.abs(el.h)) / 2,
      0,
      Math.PI * 2
    );
    ctx.stroke();
    return;
  }
  roundRectPath(ctx, el.x, el.y, el.w, el.h, el.type === 'label' ? 0 : el.type === 'button' ? 8 : 6);
  ctx.stroke();
}
