// draw.ts：负责画布整体绘制，包含网格背景、管道连线、全部图元、选中框与报警闪烁。
// 所有绘制函数接收 CanvasRenderingContext2D 与逻辑坐标，不含交互与状态管理。

import type { Element, Pipe, ResolvedTag } from '../types';

// 画布与图元配色常量，取值严格对齐开发文档 §6.1。
const CANVAS_BG = '#14181d';
const GRID_COLOR = '#22262a';
const GRID_SIZE = 40;
const ALARM_COLOR = '#e05252';
const PIPE_COLOR = '#4a4f55';
const PIPE_WIDTH = 4;
// 管道接头圆点半径与流向箭头尺寸（箭头长度对应「边长约 10px」）。
const PIPE_DOT_RADIUS = 4;
const PIPE_ARROW_LENGTH = 10;
const PIPE_ARROW_OFFSET = 12;
const SELECT_COLOR = '#d9b45b';
const LAMP_GREEN = '#7ab55c';
const LAMP_GRAY = '#4a4f55';
const DEFAULT_ELEMENT_BLUE = '#5a9ade';
const TEXT_COLOR = '#ffffff';
const TEXT_FONT = '13px "Helvetica Neue", Arial, sans-serif';

// 报警闪烁周期：以 500ms 为半周期在填充原色与报警红之间切换。
const FLASH_PERIOD_MS = 500;
// 趋势图最多绘制 60 个采样，与 runtime store 的单键历史上限保持一致。
const TREND_HISTORY_LIMIT = 60;
// 非趋势图元共用只读空历史，避免渲染循环中反复创建临时数组。
const EMPTY_HISTORY: readonly number[] = [];

// 单次渲染所需的全部输入，由 CanvasStage 在每帧组装。
export interface RenderSceneOptions {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  elements: Element[];
  pipes: Pipe[];
  selectedIds: string[];
  pipeSourceId: string | null;
  scale: number;
  offsetX: number;
  offsetY: number;
  selectionBox: SelectionBox | null;
  values: Record<string, number>;
  alarms: Record<string, 'high' | 'low'>;
  activeDeviceNo: number;
  resolveKey: (deviceNo: number, tagTemplateId: string) => string;
  getResolvedTag: (
    deviceNo: number | null,
    tagTemplateId: string | null
  ) => ResolvedTag | undefined;
  getHistory: (key: string, count?: number) => number[];
}

// 橡皮筋框选的逻辑坐标矩形；由 CanvasStage 维护并在变换后的画布上绘制。
export interface SelectionBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 绘制圆角矩形路径；自行实现以避免依赖较新的 ctx.roundRect 接口。
function roundRectPath(
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

// 绘制 40px 间距的暗网格线；范围按当前视图换算，平移后仍覆盖可见区域。
export function drawGrid(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  right: number,
  bottom: number
): void {
  ctx.save();
  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  // 通过 0.5 像素偏移让 1px 线条落在像素中心，避免高分屏下发虚。
  ctx.beginPath();
  for (let x = Math.floor(left / GRID_SIZE) * GRID_SIZE; x <= right; x += GRID_SIZE) {
    const px = Math.round(x) + 0.5;
    ctx.moveTo(px, top);
    ctx.lineTo(px, bottom);
  }
  for (let y = Math.floor(top / GRID_SIZE) * GRID_SIZE; y <= bottom; y += GRID_SIZE) {
    const py = Math.round(y) + 0.5;
    ctx.moveTo(left, py);
    ctx.lineTo(right, py);
  }
  ctx.stroke();
  ctx.restore();
}

// 计算矩形/label 边界与中心连线的比例：center + t*(dx,dy) 恰落在边界上。
function rectBoundaryT(el: Element, dx: number, dy: number): number {
  const halfW = Math.abs(el.w) / 2;
  const halfH = Math.abs(el.h) / 2;
  // 某一轴方向为 0 时该轴不构成限制，取另一轴；与外层 t 公式一致。
  const tx = dx === 0 ? Number.POSITIVE_INFINITY : halfW / Math.abs(dx);
  const ty = dy === 0 ? Number.POSITIVE_INFINITY : halfH / Math.abs(dy);
  return Math.min(tx, ty);
}

// 计算图元边界与中心连线的交点参数：rect/label 用矩形边界，circle 按内切正方形的半径处理。
function boundaryT(el: Element, dx: number, dy: number, distance: number): number {
  if (el.type === 'circle') {
    // 圆用半径（w/2）除以中心距；圆按内切正方形处理即可。
    return Math.abs(el.w) / 2 / distance;
  }
  return rectBoundaryT(el, dx, dy);
}

// 计算两图元边界上的端点：从 from 边界到 to 边界；两图元重叠或相接时返回 null。
export function pipeEndpoints(
  from: Element,
  to: Element
): { x1: number; y1: number; x2: number; y2: number } | null {
  const c1x = from.x + from.w / 2;
  const c1y = from.y + from.h / 2;
  const c2x = to.x + to.w / 2;
  const c2y = to.y + to.h / 2;
  const dx = c2x - c1x;
  const dy = c2y - c1y;
  const distance = Math.hypot(dx, dy);
  // 中心重合时没有可用的连线方向，直接跳过。
  if (distance === 0) {
    return null;
  }
  const t1 = boundaryT(from, dx, dy, distance);
  const t2 = boundaryT(to, dx, dy, distance);
  // ASSUMPTION: 文档 §6.3.6 字面为「两图元中心连直线」，此处改为边界到边界，
  // 避免管道穿入图元内部遮挡内容；t1 + t2 >= 1 表示两图元重叠或相接，线段被吃光。
  if (t1 + t2 >= 1) {
    return null;
  }
  return {
    x1: c1x + dx * t1,
    y1: c1y + dy * t1,
    x2: c2x - dx * t2,
    y2: c2y - dy * t2
  };
}

// 在靠近 to 端沿 P1→P2 方向绘制实心三角箭头，表示物料/信号流向。
function drawFlowArrow(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  // 线段过短时不画箭头，避免箭头越过 from 端或压入图元。
  if (length < PIPE_ARROW_OFFSET + PIPE_ARROW_LENGTH) {
    return;
  }
  const ux = dx / length;
  const uy = dy / length;
  // 箭头尖端距 to 边界约 12px，底边再后退一个箭头长度，整体保持在目标图元之外。
  const tipX = x2 - ux * PIPE_ARROW_OFFSET;
  const tipY = y2 - uy * PIPE_ARROW_OFFSET;
  const baseX = tipX - ux * PIPE_ARROW_LENGTH;
  const baseY = tipY - uy * PIPE_ARROW_LENGTH;
  // 垂直方向向量撑开三角形底边，形成约 10px 边长的实心三角。
  const halfWidth = PIPE_ARROW_LENGTH / 2;
  const px = -uy * halfWidth;
  const py = ux * halfWidth;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(baseX + px, baseY + py);
  ctx.lineTo(baseX - px, baseY - py);
  ctx.closePath();
  ctx.fill();
}

// 绘制管道：从 from 边界连到 to 边界，4px 灰色直线 + 两端圆点 + 流向箭头。
// 每帧按图元最新坐标重算，拖动图元时连线实时跟随；端点被删除或两图元重叠则跳过，避免悬空线。
export function drawPipes(ctx: CanvasRenderingContext2D, pipes: Pipe[], elements: Element[]): void {
  if (pipes.length === 0) {
    return;
  }
  const byId = new Map(elements.map((el) => [el.id, el]));
  ctx.save();
  ctx.strokeStyle = PIPE_COLOR;
  ctx.fillStyle = PIPE_COLOR;
  ctx.lineWidth = PIPE_WIDTH;
  ctx.lineCap = 'round';
  for (const pipe of pipes) {
    const from = byId.get(pipe.fromId);
    const to = byId.get(pipe.toId);
    // 端点图元被删除时跳过；悬空管道的清理仍由 scene store 负责。
    if (from === undefined || to === undefined) {
      continue;
    }
    const endpoints = pipeEndpoints(from, to);
    // 重叠或相接时不画负长度线。
    if (endpoints === null) {
      continue;
    }
    const { x1, y1, x2, y2 } = endpoints;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    // 两端小圆点贴在边界上；管道绘制在图元下层，圆点进入图元内部的部分由填充覆盖。
    ctx.beginPath();
    ctx.arc(x1, y1, PIPE_DOT_RADIUS, 0, Math.PI * 2);
    ctx.arc(x2, y2, PIPE_DOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    drawFlowArrow(ctx, x1, y1, x2, y2);
  }
  ctx.restore();
}

// 按报警闪烁规则计算当前填充色：未报警恒为原色，报警时按 500ms 周期切换。
function resolveFillColor(fill: string, alarming: boolean, now: number): string {
  if (!alarming) {
    return fill;
  }
  // Date.now()/500 取整后对 2 取模，得到 0/1 两种相位，即 500ms 亮暗交替。
  return Math.floor(now / FLASH_PERIOD_MS) % 2 === 0 ? fill : ALARM_COLOR;
}

// 报警闪烁的亮/暗相位：亮相位显示报警红，暗相位降低透明度但仍保持红色。
function isAlarmFlashBright(now: number): boolean {
  return Math.floor(now / FLASH_PERIOD_MS) % 2 === 0;
}

// 将值线性钳制到 0..1；量程非法时返回 0，避免 NaN 进入绘制路径。
function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

// 点位读数的第二行文字：未绑定显示“未绑定”，有绑定无值显示“--”。
function readingLine(tag: ResolvedTag | undefined, value: number | undefined): string {
  if (tag === undefined) {
    return '未绑定';
  }
  const displayValue = value === undefined ? '--' : value.toFixed(1);
  return `${tag.name}: ${displayValue} ${tag.unit}`;
}

// 在图元中心绘制一到两行文字，供 rect 与 circle 复用。
function drawCenteredLines(ctx: CanvasRenderingContext2D, lines: string[], el: Element): void {
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
function drawLabelText(ctx: CanvasRenderingContext2D, el: Element, tag: ResolvedTag | undefined, displayValue: string): void {
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

// 绘制液位图元：矩形轮廓、从底部生长的填充和按当前值计算的液面高亮线。
function drawTank(ctx: CanvasRenderingContext2D, el: Element, tag: ResolvedTag | undefined, value: number | undefined): void {
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

// 电机旋转角是每帧累计的渲染状态，不写入 Element，也不参与 scene.json。
interface MotorAnimation {
  angle: number;
  lastTime: number;
}
const motorAnimations = new Map<string, MotorAnimation>();

// 绘制旋转电机：速度由绑定值/max 驱动，值非正或报警时冻结，报警时整圆描红。
function drawMotor(ctx: CanvasRenderingContext2D, el: Element, tag: ResolvedTag | undefined, value: number | undefined, alarming: boolean): void {
  const cx = el.x + el.w / 2;
  const cy = el.y + el.h / 2;
  const radius = Math.min(Math.abs(el.w), Math.abs(el.h)) / 2;
  const now = performance.now();
  const previous = motorAnimations.get(el.id);
  const elapsedSeconds = previous === undefined ? 0 : Math.max(0, (now - previous.lastTime) / 1000);
  let angle = previous?.angle ?? 0;
  const max = tag?.max ?? 0;
  const canRotate = value !== undefined && value > 0 && !alarming && max > 0;
  if (canRotate) {
    // 角速度(rad/s) = 2π * clamp(value / max, 0, 1) * 1.5。
    const angularSpeed = 2 * Math.PI * clamp01(value / max) * 1.5;
    angle = (angle + angularSpeed * elapsedSeconds) % (Math.PI * 2);
  }
  motorAnimations.set(el.id, { angle, lastTime: now });

  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.fillStyle = el.fill || DEFAULT_ELEMENT_BLUE;
  ctx.fill();

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);
  ctx.fillStyle = TEXT_COLOR;
  for (let blade = 0; blade < 3; blade += 1) {
    ctx.save();
    ctx.rotate((blade * Math.PI * 2) / 3);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(radius * 0.28, -radius * 0.62, 0, -radius * 0.82);
    ctx.quadraticCurveTo(-radius * 0.28, -radius * 0.62, 0, 0);
    ctx.fill();
    ctx.restore();
  }
  ctx.beginPath();
  ctx.arc(0, 0, Math.max(2, radius * 0.12), 0, Math.PI * 2);
  ctx.fillStyle = PIPE_COLOR;
  ctx.fill();
  ctx.restore();

  drawCenteredLines(ctx, [el.text, readingLine(tag, value)], el);
}

// 绘制指示灯：正常绿、报警红闪烁、无值/未绑定灰；外圈用同心圆模拟光晕。
function drawLamp(
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
function drawTrend(
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

// 按图元外轮廓叠加报警描边：圆/电机/灯使用圆，其余使用矩形或圆角矩形。
function drawAlarmOutline(ctx: CanvasRenderingContext2D, el: Element): void {
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

// 绘制单个图元；alarming 决定是否叠加报警描边与闪烁填充。
export function drawElement(
  ctx: CanvasRenderingContext2D,
  el: Element,
  tag: ResolvedTag | undefined,
  value: number | undefined,
  alarming: boolean,
  now: number,
  history: readonly number[] = EMPTY_HISTORY
): void {
  const flashFill = resolveFillColor(el.fill, alarming, now);
  const displayValue = value === undefined ? '--' : value.toFixed(1);
  ctx.save();

  if (el.type === 'rect') {
    roundRectPath(ctx, el.x, el.y, el.w, el.h, 6);
    ctx.fillStyle = flashFill;
    ctx.fill();
    // ASSUMPTION: 预置水箱/电机为 rect/circle；为满足 AC2 的可读性，绑定点位时也显示第二行实时值。
    drawCenteredLines(ctx, tag === undefined ? [el.text] : [el.text, `${displayValue} ${tag.unit}`], el);
  } else if (el.type === 'circle') {
    // 按 w/h 绘制椭圆，中心与半径均由图元尺寸推导。
    ctx.beginPath();
    ctx.ellipse(el.x + el.w / 2, el.y + el.h / 2, Math.abs(el.w / 2), Math.abs(el.h / 2), 0, 0, Math.PI * 2);
    ctx.fillStyle = flashFill;
    ctx.fill();
    drawCenteredLines(ctx, tag === undefined ? [el.text] : [el.text, `${displayValue} ${tag.unit}`], el);
  } else if (el.type === 'button') {
    // 按钮使用 8px 圆角矩形；第二行仅在绑定点位且运行态已有值时显示。
    roundRectPath(ctx, el.x, el.y, el.w, el.h, 8);
    ctx.fillStyle = flashFill;
    ctx.fill();
    drawCenteredLines(
      ctx,
      tag !== undefined && value !== undefined
        ? [el.text, `${tag.name}: ${displayValue} ${tag.unit}`]
        : [el.text],
      el
    );
  } else if (el.type === 'tank') {
    drawTank(ctx, el, tag, value);
  } else if (el.type === 'motor') {
    drawMotor(ctx, el, tag, value, alarming);
  } else if (el.type === 'lamp') {
    drawLamp(ctx, el, tag, value, alarming, now);
  } else if (el.type === 'trend') {
    drawTrend(ctx, el, tag, history);
  } else {
    // label 无底色（文档 §6.2）：报警时不额外铺红底，只保留外层统一的 3px 红描边。
    drawLabelText(ctx, el, tag, displayValue);
  }

  // 报警态统一叠加 3px 红色描边。
  if (alarming) {
    drawAlarmOutline(ctx, el);
  }

  ctx.restore();
}

// 绘制选中态：黄色虚线描边 + 四角小方块手柄（纯视觉，不参与缩放）。
export function drawSelection(ctx: CanvasRenderingContext2D, el: Element, scale: number): void {
  ctx.save();
  ctx.strokeStyle = SELECT_COLOR;
  ctx.lineWidth = 1.5 / scale;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(el.x, el.y, el.w, el.h);
  ctx.setLineDash([]);

  // 四角手柄边长与图元中心偏移，均相对图元四角定位。
  const handleSize = 6;
  const half = handleSize / 2;
  const corners: Array<[number, number]> = [
    [el.x, el.y],
    [el.x + el.w, el.y],
    [el.x, el.y + el.h],
    [el.x + el.w, el.y + el.h]
  ];
  ctx.fillStyle = SELECT_COLOR;
  for (const [cx, cy] of corners) {
    ctx.fillRect(cx - half, cy - half, handleSize, handleSize);
  }
  ctx.restore();
}

// 渲染整幅画面：清屏 → 背景 → 网格 → 管道 → 图元（后加的在上层）→ 选中框。
export function renderScene(options: RenderSceneOptions): void {
  const {
    ctx,
    width,
    height,
    elements,
    pipes,
    selectedIds,
    pipeSourceId,
    scale,
    offsetX,
    offsetY,
    selectionBox,
    values,
    alarms,
    activeDeviceNo,
    resolveKey,
    getResolvedTag,
    getHistory
  } = options;
  const now = Date.now();

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = CANVAS_BG;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, scale);
  // 画布清屏保持屏幕空间；网格及全部文档内容使用统一的视图变换。
  drawGrid(
    ctx,
    -offsetX / scale,
    -offsetY / scale,
    (width - offsetX) / scale,
    (height - offsetY) / scale
  );

  // ASSUMPTION: 任务描述称管道当前已在图元下层，但仓库现状是绘制在图元之上；
  // 为满足「线不得进入任一图元内部」与「管道仍在图元下层」，此处把管道调用提前到图元之前。
  drawPipes(ctx, pipes, elements);

  for (const el of elements) {
    const deviceNo = el.deviceNo ?? activeDeviceNo;
    const tagTemplateId = el.tagTemplateId;
    const key = tagTemplateId === null ? null : resolveKey(deviceNo, tagTemplateId);
    const tag = tagTemplateId === null ? undefined : getResolvedTag(deviceNo, tagTemplateId);
    const value = key === null ? undefined : values[key];
    const alarming = key !== null && alarms[key] !== undefined;
    const history = el.type === 'trend' && key !== null ? getHistory(key, TREND_HISTORY_LIMIT) : EMPTY_HISTORY;
    drawElement(ctx, el, tag, value, alarming, now, history);
  }

  // 选中框最后绘制，保证始终浮于所有图元之上。
  const selectedIdSet = new Set(selectedIds);
  for (const selected of elements) {
    if (selectedIdSet.has(selected.id)) {
      drawSelection(ctx, selected, scale);
    }
  }

  // 连线模式下已选的起点图元同样用黄色虚线高亮，明确当前连线的源端。
  if (pipeSourceId !== null && !selectedIdSet.has(pipeSourceId)) {
    const source = elements.find((item) => item.id === pipeSourceId);
    if (source !== undefined) {
      drawSelection(ctx, source, scale);
    }
  }

  // 橡皮筋最后绘制；颜色沿用选中态黄色，避免引入新的视觉规范。
  if (selectionBox !== null) {
    ctx.save();
    ctx.fillStyle = 'rgba(217, 180, 91, 0.16)';
    ctx.strokeStyle = SELECT_COLOR;
    ctx.lineWidth = 1 / scale;
    ctx.setLineDash([6 / scale, 4 / scale]);
    ctx.fillRect(selectionBox.x, selectionBox.y, selectionBox.w, selectionBox.h);
    ctx.strokeRect(selectionBox.x, selectionBox.y, selectionBox.w, selectionBox.h);
    ctx.restore();
  }
  ctx.restore();
}
