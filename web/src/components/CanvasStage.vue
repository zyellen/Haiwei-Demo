<!-- CanvasStage.vue：核心画布组件，负责高分屏绘制、命中选中、拖拽、管道连线与 SSE 生命周期。 -->
<!-- 常驻 requestAnimationFrame 重绘，并把 runtime 实时值/报警态交给 draw.ts 渲染。 -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef, useTemplateRef, watch } from 'vue';
import { hitTestElements } from '../core/hitTest';
import { renderScene } from '../core/draw';
import type { SelectionBox } from '../core/draw';
import { isWritableTemplate, nextToggleValue, writeTag } from '../core/writeback';
import { useSceneStore } from '../stores/scene';
import { useRuntimeStore } from '../stores/runtime';
import { snapToGrid, useViewStore } from '../stores/view';
import type { Element } from '../types';

// pipeMode 由 App 统一持有（工具栏与画布共用）；退出请求通过事件上抛。
const props = defineProps<{
  pipeMode: boolean;
}>();

const emit = defineEmits<{
  exitPipeMode: [];
  toast: [message: string];
}>();

const scene = useSceneStore();
const runtime = useRuntimeStore();
const view = useViewStore();

const canvasRef = useTemplateRef<HTMLCanvasElement>('canvasRef');
const containerRef = useTemplateRef<HTMLDivElement>('containerRef');

// 画布逻辑尺寸（CSS 像素），与 canvas 的物理像素尺寸按 dpr 区分。
let logicalWidth = 0;
let logicalHeight = 0;
// 设备像素比在每次尺寸测量时刷新，兼容跨屏拖动窗口的情况。
let dpr = 1;

let rafId = 0;
let resizeObserver: ResizeObserver | null = null;
// EventSource 的关闭函数，由 runtime.start() 返回并在组件卸载时调用。
let stopRuntimeStream: (() => void) | null = null;

// 拖拽上下文：dragging 为 false 时 offsetX/offsetY 无意义。
const dragging = shallowRef(false);
const panning = shallowRef(false);
const hoveredClickableButton = shallowRef(false);
// mousedown 起点与位移判定：<4px 仍视为点击，不触发写回。
let pointerDown:
  | { elementId: string; clientX: number; clientY: number; x: number; y: number }
  | null = null;
// 同一图元写回进行中时忽略重复点击，避免并发生成多条覆盖记录。
const pendingWrites = new Set<string>();
let dragOffsets: Array<{ id: string; dx: number; dy: number }> = [];
let dragStartPositions = new Map<string, { x: number; y: number }>();
let panStart: { clientX: number; clientY: number } | null = null;
let spacePressed = false;
const selectionBox = shallowRef<SelectionBox | null>(null);
let selectionStart: { x: number; y: number } | null = null;
// 连线模式下已选中的起点图元 id；仅作为画布局部交互状态，不写入存档。
const pipeSourceId = shallowRef<string | null>(null);

// 唯一鼠标坐标入口：先减画布屏幕偏移，再减视图平移，最后除以缩放。
function toLogical(clientX: number, clientY: number): { x: number; y: number } {
  const canvas = canvasRef.value;
  if (canvas === null) {
    return { x: 0, y: 0 };
  }
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left - view.offsetX) / view.scale,
    y: (clientY - rect.top - view.offsetY) / view.scale
  };
}

// 选择框规范化，统一交换反向拖动产生的负宽高。
function normalizeSelection(
  start: { x: number; y: number },
  end: { x: number; y: number }
): SelectionBox {
  return {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y)
  };
}

// 选择框与图元包围盒相交即选中，不要求完全包含。
function elementsInBox(box: SelectionBox): string[] {
  return scene.elements
    .filter(
      (element) =>
        element.x <= box.x + box.w &&
        element.x + element.w >= box.x &&
        element.y <= box.y + box.h &&
        element.y + element.h >= box.y
    )
    .map((element) => element.id);
}

function endDrag(): void {
  dragging.value = false;
  pointerDown = null;
  dragOffsets = [];
  dragStartPositions = new Map();
}

// 按容器 CSS 尺寸与当前 dpr 重设 canvas 物理尺寸与内联样式。
function syncCanvasSize(): void {
  const canvas = canvasRef.value;
  const container = containerRef.value;
  if (canvas === null || container === null) {
    return;
  }
  const rect = container.getBoundingClientRect();
  // 容器可能被压缩到 0，这里兜底为 1px，避免 canvas 尺寸非法。
  logicalWidth = Math.max(1, Math.round(rect.width));
  logicalHeight = Math.max(1, Math.round(rect.height));
  dpr = window.devicePixelRatio || 1;

  canvas.width = Math.round(logicalWidth * dpr);
  canvas.height = Math.round(logicalHeight * dpr);
  canvas.style.width = `${logicalWidth}px`;
  canvas.style.height = `${logicalHeight}px`;
}

// 常驻渲染循环：每帧先按 dpr 设置变换，再用逻辑宽高绘制，保证高分屏清晰不错位。
function renderFrame(): void {
  const canvas = canvasRef.value;
  if (canvas !== null) {
    const ctx = canvas.getContext('2d');
    if (ctx !== null) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderScene({
        ctx,
        width: logicalWidth,
        height: logicalHeight,
        elements: scene.elements,
        pipes: scene.pipes,
        selectedIds: scene.selectedIds,
        pipeSourceId: pipeSourceId.value,
        scale: view.scale,
        offsetX: view.offsetX,
        offsetY: view.offsetY,
        selectionBox: selectionBox.value,
        values: runtime.values,
        alarms: runtime.alarms,
        activeDeviceNo: runtime.activeDeviceNo,
        resolveKey: (deviceNo, tagTemplateId) => runtime.resolveKey(deviceNo, tagTemplateId),
        getResolvedTag: (deviceNo, tagTemplateId) => runtime.getResolvedTag(deviceNo, tagTemplateId),
        getHistory: (key, count) => runtime.getHistory(key, count)
      });
    }
    rafId = window.requestAnimationFrame(renderFrame);
  }
}

// 退出连线模式并清空起点高亮；ESC、选中终点或工具栏再次点击都会走到这里。
function exitPipeMode(): void {
  pipeSourceId.value = null;
  emit('exitPipeMode');
}

// 连线模式下的点击语义：第一次点击记起点，第二次点击创建管道并退出连线模式。
// ASSUMPTION: 文档未规定点击同一图元的行为，按“取消起点选择、继续留在连线模式”处理。
function handlePipeClick(hitId: string | null): void {
  if (hitId === null) {
    pipeSourceId.value = null;
    return;
  }
  if (pipeSourceId.value === null) {
    pipeSourceId.value = hitId;
    return;
  }
  if (pipeSourceId.value === hitId) {
    pipeSourceId.value = null;
    return;
  }
  // addPipe 内部已阻止自环与同向重复；无论成功与否都退出连线模式。
  scene.addPipe(pipeSourceId.value, hitId);
  exitPipeMode();
}

// mousedown：连线模式走连线逻辑；普通模式沿用 M2 的选中 + 拖拽行为。
function onMouseDown(e: MouseEvent): void {
  const { x, y } = toLogical(e.clientX, e.clientY);
  if (e.button === 1 || (e.button === 0 && spacePressed)) {
    panning.value = true;
    panStart = { clientX: e.clientX, clientY: e.clientY };
    pointerDown = null;
    selectionBox.value = null;
    selectionStart = null;
    e.preventDefault();
    return;
  }
  if (e.button !== 0) {
    return;
  }
  const hit = hitTestElements(scene.elements, x, y);
  pointerDown = null;
  if (props.pipeMode) {
    handlePipeClick(hit?.id ?? null);
    return;
  }
  if (hit !== null) {
    if (e.shiftKey) {
      scene.toggleElementSelection(hit.id);
      // Shift 是选择修改键：切换后不启动拖动，避免立即把刚移除/追加的图元再次拖走。
      pointerDown = null;
      dragging.value = false;
      return;
    }
    if (!scene.selectedIds.includes(hit.id)) {
      scene.selectElement(hit.id);
    }
    if (!scene.selectedIds.includes(hit.id)) {
      return;
    }
    // 记录拖动前快照；拖动过程不逐帧压栈，mouseup/leave 时合并为一条历史。
    scene.beginDragHistory();
    dragging.value = true;
    pointerDown = { elementId: hit.id, clientX: e.clientX, clientY: e.clientY, x, y };
    dragStartPositions = new Map(
      scene.elements
        .filter((element) => scene.selectedIds.includes(element.id))
        .map((element) => [element.id, { x: element.x, y: element.y }])
    );
    dragOffsets = [...dragStartPositions].map(([id, position]) => ({
      id,
      dx: position.x - x,
      dy: position.y - y
    }));
  } else {
    dragging.value = false;
    scene.selectElement(null);
    selectionStart = { x, y };
    selectionBox.value = { x, y, w: 0, h: 0 };
  }
}

// mousemove：拖动中按取整后的坐标更新选中图元位置；管道每帧按新坐标重算。
function onMouseMove(e: MouseEvent): void {
  if (panning.value && panStart !== null) {
    view.panBy(e.clientX - panStart.clientX, e.clientY - panStart.clientY);
    panStart = { clientX: e.clientX, clientY: e.clientY };
    return;
  }
  const { x, y } = toLogical(e.clientX, e.clientY);
  if (!dragging.value) {
    if (selectionStart !== null) {
      selectionBox.value = normalizeSelection(selectionStart, { x, y });
      return;
    }
    const hovered = props.pipeMode ? null : hitTestElements(scene.elements, x, y);
    hoveredClickableButton.value =
      hovered?.type === 'button' && hovered.tagTemplateId !== null;
    return;
  }
  hoveredClickableButton.value = false;
  const primary = dragOffsets.find((item) => item.id === pointerDown?.elementId);
  const primaryStart = primary === undefined ? undefined : dragStartPositions.get(primary.id);
  if (primary === undefined || primaryStart === undefined) {
    return;
  }
  const rawPrimaryX = x + primary.dx;
  const rawPrimaryY = y + primary.dy;
  const nextPrimaryX = view.snapEnabled ? snapToGrid(rawPrimaryX) : Math.round(rawPrimaryX);
  const nextPrimaryY = view.snapEnabled ? snapToGrid(rawPrimaryY) : Math.round(rawPrimaryY);
  const deltaX = nextPrimaryX - primaryStart.x;
  const deltaY = nextPrimaryY - primaryStart.y;
  const positions = dragOffsets.map((item) => {
    const start = dragStartPositions.get(item.id);
    if (start === undefined) {
      return { id: item.id, x: nextPrimaryX, y: nextPrimaryY };
    }
    return {
      id: item.id,
      x: start.x + deltaX,
      y: start.y + deltaY
    };
  });
  scene.setElementPositions(positions, { recordHistory: false });
}

// 读取模板与当前值，构造下一次切换值并发起写回；成功/失败都通过 App 的 ToastHost 提示。
async function writeButtonValue(element: Element): Promise<void> {
  const tagTemplateId = element.tagTemplateId;
  if (tagTemplateId === null) {
    return;
  }
  const template = runtime.tagTemplates.find(
    (item) => item.tagTemplateId === tagTemplateId
  );
  if (template === undefined) {
    emit('toast', '写入失败：点位模板不存在');
    return;
  }
  if (!isWritableTemplate(tagTemplateId, runtime.tagTemplates)) {
    emit('toast', '写入失败：该点位模板不可写');
    return;
  }

  const deviceNo = element.deviceNo ?? runtime.activeDeviceNo;
  const key = runtime.resolveKey(deviceNo, tagTemplateId);
  const currentValue = runtime.values[key] ?? (template.min + template.max) / 2;
  const value = nextToggleValue(template.min, template.max, currentValue);

  if (pendingWrites.has(element.id)) {
    return;
  }
  pendingWrites.add(element.id);
  try {
    const result = await writeTag(deviceNo, tagTemplateId, value);
    if (result.ok) {
      const writtenValue = result.value ?? value;
      emit('toast', `已写入 ${deviceNo}#${template.name} = ${writtenValue} ${template.unit}`);
    } else {
      emit('toast', `写入失败：${result.message ?? '网络异常'}`);
    }
  } finally {
    pendingWrites.delete(element.id);
  }
}

// mouseup：先结束拖动，再仅对位移小于 4px 的已绑定按钮执行写回。
function onMouseUp(e: MouseEvent): void {
  if (panning.value) {
    panning.value = false;
    panStart = null;
    return;
  }
  const down = pointerDown;
  const box = selectionBox.value;
  selectionBox.value = null;
  selectionStart = null;
  endDrag();
  // 鼠标抬起是拖动落点写回的收尾：整段拖动在此压入一条历史（无位移则为空操作）。
  scene.commitDragHistory();
  if (box !== null) {
    scene.selectElements(elementsInBox(box));
    return;
  }
  if (props.pipeMode || down === null) {
    return;
  }
  if (scene.selectedIds.length !== 1 || !scene.selectedIds.includes(down.elementId)) {
    return;
  }
  // 按钮写回判定同样走 toLogical()：屏幕位移先还原到逻辑坐标再与 4px 阈值比较。
  const up = toLogical(e.clientX, e.clientY);
  const distance = Math.hypot(up.x - down.x, up.y - down.y);
  if (distance >= 4) {
    return;
  }
  const element = scene.elements.find((item) => item.id === down.elementId);
  if (element === undefined || element.type !== 'button' || element.tagTemplateId === null) {
    return;
  }
  void writeButtonValue(element);
}

// 鼠标离开画布时结束拖动并清除可点击光标提示。
function onMouseLeave(): void {
  panning.value = false;
  panStart = null;
  selectionBox.value = null;
  selectionStart = null;
  endDrag();
  // 拖出画布同样结束拖动，落点已写回，这里补记一次历史。
  scene.commitDragHistory();
  hoveredClickableButton.value = false;
}

// 键盘：连接模式下 ESC 退出；Cmd/Ctrl+Z 撤销、Cmd/Ctrl+Shift+Z 重做；Delete/Backspace 删除。
function onKeyDown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    if (props.pipeMode) {
      exitPipeMode();
    }
    return;
  }

  const target = e.target;
  const tagName = (target as HTMLElement | null)?.tagName?.toLowerCase() ?? '';
  // 焦点在文本控件内时不拦截，让文本域使用浏览器的原生撤销/重做。
  if (tagName === 'input' || tagName === 'select' || tagName === 'textarea') {
    return;
  }

  // 空格是平移修饰键；键 0 重置视图，均不属于文档编辑操作。
  if (e.key === ' ') {
    spacePressed = true;
    e.preventDefault();
    return;
  }
  if (e.key === '0') {
    e.preventDefault();
    view.resetView();
    return;
  }

  // 撤销/重做：主修饰键 + Z；带 Shift 为 redo。兼容 Windows/Linux 的 Ctrl。
  const key = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && key === 'z') {
    e.preventDefault();
    if (e.shiftKey) {
      scene.redo();
    } else {
      scene.undo();
    }
    return;
  }

  if (e.key !== 'Delete' && e.key !== 'Backspace') {
    return;
  }
  if (scene.selectedIds.length === 0) {
    return;
  }
  // 阻止 Backspace 在浏览器中触发返回上一页。
  e.preventDefault();
  scene.removeSelected();
}

// 空格松开或窗口失焦时清理修饰键，避免下一次左键拖拽意外进入平移模式。
function onKeyUp(e: KeyboardEvent): void {
  if (e.key === ' ') {
    spacePressed = false;
  }
}

function onWindowBlur(): void {
  spacePressed = false;
  panning.value = false;
  panStart = null;
}

// 滚轮以光标下的逻辑坐标为锚点缩放；preventDefault 阻止页面滚动。
function onWheel(e: WheelEvent): void {
  e.preventDefault();
  const { x, y } = toLogical(e.clientX, e.clientY);
  view.zoomAt(x, y, e.deltaY < 0 ? 1.1 : 1 / 1.1);
}

// 外部关闭连线模式（工具栏按钮）时同步清空起点高亮。
watch(
  () => props.pipeMode,
  (enabled) => {
    if (!enabled) {
      pipeSourceId.value = null;
    }
  }
);

onMounted(() => {
  syncCanvasSize();
  rafId = window.requestAnimationFrame(renderFrame);
  resizeObserver = new ResizeObserver(() => {
    syncCanvasSize();
  });
  if (containerRef.value !== null) {
    resizeObserver.observe(containerRef.value);
  }
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onWindowBlur);
  canvasRef.value?.addEventListener('wheel', onWheel, { passive: false });
  // 建立 SSE；连接关闭由组件卸载统一处理，断线重连由 EventSource 自身负责。
  stopRuntimeStream = runtime.start();
});

onBeforeUnmount(() => {
  scene.cancelDragHistory();
  window.cancelAnimationFrame(rafId);
  resizeObserver?.disconnect();
  resizeObserver = null;
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('blur', onWindowBlur);
  canvasRef.value?.removeEventListener('wheel', onWheel);
  stopRuntimeStream?.();
  stopRuntimeStream = null;
});

// 暴露画布中心点与逻辑尺寸，供 App 在添加图元时定位到中央。
defineExpose({
  getSize(): { width: number; height: number } {
    return { width: logicalWidth, height: logicalHeight };
  },
  getCenterLogical(): { x: number; y: number } {
    const canvas = canvasRef.value;
    if (canvas === null) {
      return { x: logicalWidth / 2, y: logicalHeight / 2 };
    }
    const rect = canvas.getBoundingClientRect();
    return toLogical(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }
});
</script>

<template>
  <div ref="containerRef" class="canvas-stage">
    <canvas
      ref="canvasRef"
      class="canvas-surface"
      :class="{ 'is-piping': pipeMode, 'is-dragging': dragging, 'is-panning': panning, 'is-clickable': hoveredClickableButton }"
      @mousedown="onMouseDown"
      @mousemove="onMouseMove"
      @mouseup="onMouseUp"
      @mouseleave="onMouseLeave"
    ></canvas>
  </div>
</template>

<style scoped>
.canvas-stage {
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #14181d;
}

.canvas-surface {
  display: block;
  cursor: default;
}

.canvas-surface.is-dragging {
  cursor: move;
}

.canvas-surface.is-panning {
  cursor: grabbing;
}

.canvas-surface.is-piping {
  cursor: crosshair;
}

.canvas-surface.is-clickable {
  cursor: pointer;
}
</style>
