<!-- App.vue：应用外壳，按文档 §6.1 组织顶栏、画布/属性面板与底部报警栏。 -->
<!-- 负责启动并行加载、保存/加载请求编排、连线模式、大屏模式与 toast 生命周期。 -->
<script setup lang="ts">
import { onBeforeUnmount, onMounted, shallowRef, useTemplateRef } from 'vue';
import Toolbar from './components/Toolbar.vue';
import CanvasStage from './components/CanvasStage.vue';
import PropertyPanel from './components/PropertyPanel.vue';
import DescribePanel from './components/DescribePanel.vue';
import AlarmBar from './components/AlarmBar.vue';
import ToastHost from './components/ToastHost.vue';
import { upgradeScene } from './core/migrate';
import { buildDefaultScene, useSceneStore } from './stores/scene';
import { useRuntimeStore } from './stores/runtime';
import { snapToGrid, useViewStore } from './stores/view';
import type { Element } from './types';

const scene = useSceneStore();
const runtime = useRuntimeStore();
const view = useViewStore();

// 通过模板引用调用 CanvasStage 暴露的 getSize()，拿到画布逻辑宽高。
const canvasStageRef = useTemplateRef<InstanceType<typeof CanvasStage>>('canvasStageRef');
// 大屏模式的目标容器；requestFullscreen 作用于画布区域而非整个页面。
const canvasAreaRef = useTemplateRef<HTMLElement>('canvasAreaRef');

// 连线模式与全屏状态统一放在外壳，工具栏按钮与画布交互共享同一份真值。
const pipeMode = shallowRef(false);
const fullscreen = shallowRef(false);

// 右上角 toast 文案与自动消失计时器。
const toastMessage = shallowRef<string | null>(null);
let toastTimer: number | null = null;

// 在画布中心新增图元；尺寸尚未测量完成时兜底到 (0, 0) 中心。
function onAdd(type: Element['type']): void {
  const logical = canvasStageRef.value?.getCenterLogical() ?? { x: 0, y: 0 };
  const centerX = view.snapEnabled ? snapToGrid(logical.x) : Math.round(logical.x);
  const centerY = view.snapEnabled ? snapToGrid(logical.y) : Math.round(logical.y);
  scene.addElement(type, centerX, centerY, view.snapEnabled);
}

// 工具栏「删除选中」直接映射到 store 动作。
function onDelete(): void {
  scene.removeSelected();
}

// 清空仅作用于前端内存，管道数组一并清空。
function onClear(): void {
  scene.clear();
}

// 切换连线模式；进入时取消普通选中，避免与连线起点高亮混淆。
function onTogglePipe(): void {
  const next = !pipeMode.value;
  if (next) {
    scene.selectElement(null);
  }
  pipeMode.value = next;
}

// 画布内部完成连线或按 ESC 后，只负责关闭外壳的连线模式标记。
function onExitPipeMode(): void {
  pipeMode.value = false;
}

// 进入/退出大屏：对画布区域容器调用 Fullscreen API，失败时不改变既有状态。
async function onToggleFullscreen(): Promise<void> {
  const target = canvasAreaRef.value;
  if (target === null) {
    return;
  }
  // 不支持 Fullscreen API 时按需求只告警并保持原状。
  if (document.fullscreenEnabled !== true || typeof target.requestFullscreen !== 'function') {
    console.warn('[fullscreen] 当前浏览器不支持全屏 API');
    return;
  }
  try {
    if (document.fullscreenElement === null) {
      await target.requestFullscreen();
    } else {
      await document.exitFullscreen();
    }
  } catch (error) {
    console.warn('[fullscreen] 切换全屏失败:', error);
  }
}

// 浏览器全屏状态变化（含用户按 ESC 退出）时同步按钮文案。
function onFullscreenChange(): void {
  fullscreen.value = document.fullscreenElement !== null;
}

// 描述指令应用完成后复用现有 ToastHost 提示，不在面板内复制全局提示状态。
function onDescribeApplied(count: number): void {
  showToast(`已应用 ${count} 条指令`);
}

// 显示 2 秒自动消失的右上角提示；连续提示时重新计时。
function showToast(message: string): void {
  if (toastTimer !== null) {
    window.clearTimeout(toastTimer);
  }
  toastMessage.value = message;
  toastTimer = window.setTimeout(() => {
    toastMessage.value = null;
    toastTimer = null;
  }, 2000);
}

// 保存当前画面；成功返回后提示，失败只告警不打断编辑。
async function onSave(): Promise<void> {
  try {
    const response = await fetch('/api/scene', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(scene.createSceneSnapshot())
    });
    if (!response.ok) {
      throw new Error(`保存失败：HTTP ${response.status}`);
    }
    showToast('画面已保存');
  } catch (error) {
    console.warn('[scene] 保存画面失败:', error);
  }
}

// 加载服务端存档；仅 200 覆盖画布，404 保留当前内容并提示暂无存档。
async function onLoad(): Promise<void> {
  try {
    const response = await fetch('/api/scene');
    if (response.status === 404) {
      showToast('暂无已保存画面');
      return;
    }
    if (!response.ok) {
      throw new Error(`加载失败：HTTP ${response.status}`);
    }
    const savedScene = upgradeScene(await response.json());
    scene.loadScene(savedScene);
    showToast('已加载画面');
  } catch (error) {
    console.warn('[scene] 加载画面失败:', error);
  }
}

// 首次启动并行拉取元数据与存档；有存档则还原，404 则载入文档 §6.5 预置画面。
async function loadInitialScene(): Promise<void> {
  try {
    const [, sceneResponse] = await Promise.all([runtime.fetchMeta(), fetch('/api/scene')]);
    if (sceneResponse.status === 404) {
      scene.loadScene(buildDefaultScene());
      return;
    }
    if (!sceneResponse.ok) {
      throw new Error(`初始画面请求失败：HTTP ${sceneResponse.status}`);
    }
    const savedScene = upgradeScene(await sceneResponse.json());
    scene.loadScene(savedScene);
  } catch (error) {
    // 后端不可用时保持可编辑空画布，SSE/后续手动操作仍可自动恢复。
    console.warn('[scene] 加载初始画面失败:', error);
  }
}

onMounted(() => {
  void loadInitialScene();
  document.addEventListener('fullscreenchange', onFullscreenChange);
});

onBeforeUnmount(() => {
  document.removeEventListener('fullscreenchange', onFullscreenChange);
  if (toastTimer !== null) {
    window.clearTimeout(toastTimer);
    toastTimer = null;
  }
});
</script>

<template>
  <div class="app-shell">
    <Toolbar
      :pipe-mode="pipeMode"
      :fullscreen="fullscreen"
      @add="onAdd"
      @delete="onDelete"
      @save="onSave"
      @load="onLoad"
      @clear="onClear"
      @toggle-pipe="onTogglePipe"
      @toggle-fullscreen="onToggleFullscreen"
    />

    <main class="workspace">
      <section ref="canvasAreaRef" class="canvas-area" aria-label="画布区域">
        <CanvasStage
          ref="canvasStageRef"
          :pipe-mode="pipeMode"
          @exit-pipe-mode="onExitPipeMode"
          @toast="showToast"
        />
      </section>
      <div class="side-column">
        <PropertyPanel />
        <DescribePanel @applied="onDescribeApplied" />
      </div>
    </main>

    <AlarmBar />
    <ToastHost :message="toastMessage" />
  </div>
</template>

<style scoped>
.app-shell,
.app-shell * {
  box-sizing: border-box;
}

.app-shell {
  display: grid;
  grid-template-rows: 48px minmax(0, 1fr) 40px;
  height: 100vh;
  overflow: hidden;
  background: #15171a;
  color: #e4e6e3;
}

.workspace {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 240px;
  min-height: 0;
}

.canvas-area {
  position: relative;
  min-width: 0;
  min-height: 0;
  background: #14181d;
}

.side-column {
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #1e2124;
  border-left: 1px solid #33373b;
}

.side-column :deep(.property-panel) {
  width: 100%;
  min-height: 0;
  height: 100%;
  border-left: 0;
}

/* 画布区域进入全屏后铺满屏幕，网格画布随之按新尺寸自动重测。 */
.canvas-area:fullscreen {
  width: 100vw;
  height: 100vh;
  background: #14181d;
}
</style>
