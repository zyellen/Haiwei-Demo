// motor.ts：电机图元绘制与旋转动画状态（motorAnimations 仅存在于渲染层，不写入场景）。

import type { Element, ResolvedTag } from '../../types';
import { DEFAULT_ELEMENT_BLUE, PIPE_COLOR, TEXT_COLOR, clamp01, drawCenteredLines, readingLine } from './base';

// 电机旋转角是每帧累计的渲染状态，不写入 Element，也不参与 scene.json。
interface MotorAnimation {
  angle: number;
  lastTime: number;
}
const motorAnimations = new Map<string, MotorAnimation>();

// 绘制旋转电机：速度由绑定值/max 驱动，值非正或报警时冻结，报警时整圆描红。
export function drawMotor(ctx: CanvasRenderingContext2D, el: Element, tag: ResolvedTag | undefined, value: number | undefined, alarming: boolean): void {
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
