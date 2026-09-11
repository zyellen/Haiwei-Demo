<!-- AlarmBar.vue：底部通栏报警栏，展示运行时 store 维护的最近报警记录。 -->
<!-- 只订阅 recentAlarms，SSE 每秒更新的 values/alarms 不会触发本组件重渲染。 -->
<script setup lang="ts">
import { useRuntimeStore } from '../stores/runtime';

const runtime = useRuntimeStore();
</script>

<template>
  <footer class="alarm-bar" aria-label="最近报警">
    <span class="alarm-title">最近报警</span>
    <p v-if="runtime.recentAlarms.length === 0" class="alarm-empty">暂无报警</p>
    <ul v-else class="alarm-list">
      <li v-for="alarm in runtime.recentAlarms" :key="alarm.id" class="alarm-item">
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
