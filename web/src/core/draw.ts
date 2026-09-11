// draw.ts：渲染门面，保留对外公共 API，负责 drawElement 类型分派、选中框与整幅画面调度。
// 各图元的实现已按图元拆分到 core/primitives/，本文件不再包含图元绘制实现体。

import type { Element, Pipe, ResolvedTag } from '../types';
import {
  CANVAS_BG,
  EMPTY_HISTORY,
  SELECT_COLOR,
  TREND_HISTORY_LIMIT,
  drawAlarmOutline,
  drawCenteredLines,
  drawGrid,
  drawLabelText,
  drawLamp,
  drawMotor,
  drawPipes,
  drawTank,
  drawTrend,
  resolveFillColor,
  roundRectPath
} from './primitives';

// 对外保持原有导入路径不变：公共图元 API 继续从 core/draw 转发导出。
export { drawGrid, drawPipes, pipeEndpoints } from './primitives';
export { drawTank, drawMotor, drawLamp, drawTrend } from './primitives';

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
