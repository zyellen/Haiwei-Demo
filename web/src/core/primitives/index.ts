// index.ts：图元绘制模块的聚合出口；draw.ts 通过此出口复用各图元实现。
// 拆分只是文件组织变化，不改变任何绘制函数的行为与调用顺序。

export {
  ALARM_COLOR,
  CANVAS_BG,
  DEFAULT_ELEMENT_BLUE,
  EMPTY_HISTORY,
  FLASH_PERIOD_MS,
  GRID_COLOR,
  LAMP_GRAY,
  LAMP_GREEN,
  PIPE_COLOR,
  SELECT_COLOR,
  TEXT_COLOR,
  TEXT_FONT,
  TREND_HISTORY_LIMIT,
  clamp01,
  drawAlarmOutline,
  drawCenteredLines,
  drawLabelText,
  isAlarmFlashBright,
  readingLine,
  resolveFillColor,
  roundRectPath
} from './base';
export { drawGrid } from './grid';
export { drawPipes, pipeEndpoints } from './pipes';
export { drawTank } from './tank';
export { drawMotor } from './motor';
export { drawLamp } from './lamp';
export { drawTrend } from './trend';
