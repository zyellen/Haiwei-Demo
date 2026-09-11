<!-- Toolbar.vue：顶部工具栏，提供新增图元、管道连线、保存、加载、清空与大屏模式入口。 -->
<!-- 组件只发出用户意图，具体请求与状态变更统一下沉到 App / Pinia store。 -->
<script setup lang="ts">
import { computed } from 'vue';
import { useRuntimeStore } from '../stores/runtime';
import { useViewStore } from '../stores/view';
import type { Element } from '../types';

const runtime = useRuntimeStore();
const view = useViewStore();

// 设备号下拉直接绑定运行时 store 的 activeDeviceNo，切换后未显式指定设备号的图元即切换实例。
const activeDeviceNo = computed<number>({
  get: () => runtime.activeDeviceNo,
  set: (deviceNo) => {
    runtime.activeDeviceNo = deviceNo;
  }
});

// pipeMode / fullscreen 由 App 持有并以 props 下发，保证按钮状态与画布、全屏 API 同步。
defineProps<{
  pipeMode: boolean;
  fullscreen: boolean;
}>();

const emit = defineEmits<{
  add: [type: Element['type']];
  delete: [];
  save: [];
  load: [];
  clear: [];
  togglePipe: [];
  toggleFullscreen: [];
}>();

// 清空为破坏性操作，先经原生 confirm 二次确认再向上抛出事件。
function onClearClick(): void {
  if (window.confirm('确认清空画布？')) {
    emit('clear');
  }
}
</script>

<template>
  <header class="toolbar">
    <nav class="toolbar-group" aria-label="图元操作">
      <button class="toolbar-button" type="button" @click="emit('add', 'rect')">+矩形</button>
      <button class="toolbar-button" type="button" @click="emit('add', 'circle')">+圆形</button>
      <button class="toolbar-button" type="button" @click="emit('add', 'label')">+文本</button>
      <button class="toolbar-button" type="button" @click="emit('add', 'button')">+按钮</button>
      <button class="toolbar-button" type="button" @click="emit('add', 'tank')">+液位</button>
      <button class="toolbar-button" type="button" @click="emit('add', 'motor')">+电机</button>
      <button class="toolbar-button" type="button" @click="emit('add', 'lamp')">+指示灯</button>
      <button class="toolbar-button" type="button" @click="emit('add', 'trend')">+趋势图</button>
      <button
        class="toolbar-button"
        :class="{ 'is-active': pipeMode }"
        type="button"
        :aria-pressed="pipeMode"
        @click="emit('togglePipe')"
      >
        +管道
      </button>
      <button class="toolbar-button" type="button" @click="emit('delete')">删除选中</button>
      <button
        class="toolbar-button"
        :class="{ 'is-active': view.snapEnabled }"
        type="button"
        :aria-pressed="view.snapEnabled"
        @click="view.toggleSnap()"
      >
        吸附
      </button>
    </nav>

    <span class="toolbar-divider" aria-hidden="true"></span>

    <nav class="toolbar-group" aria-label="画面操作">
      <button class="toolbar-button" type="button" @click="emit('save')">保存</button>
      <button class="toolbar-button" type="button" @click="emit('load')">加载</button>
      <button class="toolbar-button" type="button" @click="onClearClick">清空</button>
      <button class="toolbar-button" type="button" @click="emit('toggleFullscreen')">
        {{ fullscreen ? '退出大屏' : '大屏模式' }}
      </button>
    </nav>

    <h1 class="app-title">Mini SCADA</h1>

    <label class="toolbar-device">
      <span class="toolbar-device-label">设备号</span>
      <select v-model.number="activeDeviceNo" class="toolbar-select" aria-label="当前设备号">
        <option v-for="device in runtime.devices" :key="device.deviceNo" :value="device.deviceNo">
          {{ device.deviceNo }}#
        </option>
      </select>
    </label>
  </header>
</template>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px;
  background: #1e2124;
  border-bottom: 1px solid #33373b;
}

.toolbar-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-divider {
  width: 1px;
  height: 22px;
  margin: 0 4px;
  background: #33373b;
}

.toolbar-button {
  padding: 6px 12px;
  color: #e4e6e3;
  font-size: 13px;
  background: #272b2f;
  border: 1px solid #33373b;
  border-radius: 6px;
  cursor: pointer;
}

.toolbar-button:hover {
  background: #31363b;
  border-color: #4a4f55;
}

.toolbar-button:active {
  background: #3a4046;
}

/* 连线模式高亮：与选中描边同用黄色，形成一致的交互反馈。 */
.toolbar-button.is-active {
  color: #15171a;
  background: #d9b45b;
  border-color: #d9b45b;
}

.app-title {
  margin: 0 0 0 auto;
  padding-left: 16px;
  color: #e4e6e3;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
}

.toolbar-device {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: 8px;
}

.toolbar-device-label {
  color: #a8aba6;
  font-size: 12px;
  white-space: nowrap;
}

.toolbar-select {
  min-width: 64px;
  padding: 5px 24px 5px 8px;
  color: #e4e6e3;
  font-size: 13px;
  background: #272b2f;
  border: 1px solid #33373b;
  border-radius: 6px;
  cursor: pointer;
}

.toolbar-select:hover {
  border-color: #4a4f55;
}

.toolbar-select:focus {
  outline: none;
  border-color: #5a9ade;
}
</style>
