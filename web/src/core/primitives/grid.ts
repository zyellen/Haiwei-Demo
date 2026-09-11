// grid.ts：40px 间距的暗网格背景绘制。

import { GRID_COLOR } from './base';

const GRID_SIZE = 40;

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
