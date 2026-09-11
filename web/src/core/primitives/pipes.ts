// pipes.ts：管道连线绘制（边界端点计算、圆点与流向箭头）。

import type { Element, Pipe } from '../../types';
import { PIPE_COLOR } from './base';

const PIPE_WIDTH = 4;
// 管道接头圆点半径与流向箭头尺寸（箭头长度对应「边长约 10px」）。
const PIPE_DOT_RADIUS = 4;
const PIPE_ARROW_LENGTH = 10;
const PIPE_ARROW_OFFSET = 12;

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
