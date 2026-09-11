<!-- AlarmBar.vue：底部通栏报警栏，展示运行时 store 维护的最近报警记录。 -->
<!-- 默认只显示当前设备号的报警（无设备号的记录始终显示），可切换查看全部设备。 -->
<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { useRuntimeStore } from '../stores/runtime';

const runtime = useRuntimeStore();

// 过滤范围：默认「按设备」只保留当前设备号；切到「全部设备」时不做过滤。
const showAllDevices = shallowRef(false);

// 按当前设备号过滤报警；deviceNo 为 null 的旧记录在按设备模式下始终保留。
const visibleAlarms = computed(() => {
  if (showAllDevices.value) {
    return runtime.recentAlarms;
  }
  const currentDeviceNo = runtime.activeDeviceNo;
  return runtime.recentAlarms.filter(
    (alarm) => alarm.deviceNo === null || alarm.deviceNo === currentDeviceNo
  );
});

// 标题体现当前过滤范围与设备号，让用户明确看到的报警属于哪台设备。
const titleText = computed(() =>
  showAllDevices.value ? '最近报警 · 全部设备' : `最近报警 · ${runtime.activeDeviceNo}#`
);

// 空态文案随过滤范围变化，区分「全部无报警」与「本设备无报警」。
const emptyText = computed(() => (showAllDevices.value ? '暂无报警' : '本设备暂无报警'));

function toggleScope(): void {
  showAllDevices.value = !showAllDevices.value;
}
</script>

<template>
  <footer class="alarm-bar" aria-label="最近报警">
    <span class="alarm-title">{{ titleText }}</span>
    <button
      class="alarm-toggle"
      type="button"
      :aria-pressed="showAllDevices"
      @click="toggleScope"
    >
      {{ showAllDevices ? '仅本设备' : '全部设备' }}
    </button>
    <p v-if="visibleAlarms.length === 0" class="alarm-empty">{{ emptyText }}</p>
    <ul v-else class="alarm-list">
      <li v-for="alarm in visibleAlarms" :key="alarm.id" class="alarm-item">
        <span class="alarm-time">{{ alarm.time }}</span>
        <span class="alarm-name">{{ alarm.tagName }}</span>
        <span class="alarm-kind">{{ alarm.kind === 'high' ? '超上限' : '低于下限' }}</span>
      </li>
    </ul>
  </footer>
</template>

<style scoped>
.alarm-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 40px;
  padding: 0 16px;
  overflow: hidden;
  color: #e4e6e3;
  font-size: 13px;
  background: #1e2124;
  border-top: 1px solid #33373b;
}

.alarm-title {
  flex: 0 0 auto;
  color: #a8aba6;
}

.alarm-toggle {
  flex: 0 0 auto;
  padding: 3px 8px;
  color: #e4e6e3;
  font-size: 12px;
  background: #272b2f;
  border: 1px solid #33373b;
  border-radius: 6px;
  cursor: pointer;
}

.alarm-toggle:hover {
  background: #31363b;
  border-color: #4a4f55;
}

.alarm-toggle[aria-pressed='true'] {
  color: #15171a;
  background: #d9b45b;
  border-color: #d9b45b;
}

.alarm-empty {
  margin: 0;
  color: #a8aba6;
}

.alarm-list {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: 16px;
  min-width: 0;
  margin: 0;
  padding: 0;
  overflow: hidden;
  list-style: none;
}

.alarm-item {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.alarm-time {
  color: #a8aba6;
  font-family: "SFMono-Regular", Menlo, Consolas, monospace;
}

.alarm-kind {
  color: #e05252;
}
</style>
