<!-- DescribePanel.vue：声明式画面描述入口，负责 JSON 指令编辑、应用与应用结果展示。 -->
<!-- 面板只通过 applyOps/describeScene 与 scene store 协作，Toast 由 App 统一处理。 -->
<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { applyOps, describeScene } from '../core/describe';
import type { OpResult } from '../core/describe';
import { useRuntimeStore } from '../stores/runtime';
import { useSceneStore } from '../stores/scene';

const emit = defineEmits<{
  applied: [count: number];
}>();

const scene = useSceneStore();
const runtime = useRuntimeStore();

const commandText = shallowRef('');
const result = shallowRef<OpResult | null>(null);
const parseError = shallowRef('');

const templateHint = computed<string>(() => {
  if (runtime.tagTemplates.length === 0) {
    return '可用模板：加载中…';
  }
  return `可用模板：${runtime.tagTemplates
    .map((template) => `${template.tagTemplateId}（${template.name}）`)
    .join('、')}`;
});

const resultText = computed<string>(() => {
  if (parseError.value !== '') {
    return `解析失败：${parseError.value}`;
  }
  const current = result.value;
  if (current === null) {
    return '尚未应用指令';
  }
  const errors = current.errors.length === 0 ? '无' : current.errors.join('；');
  return `applied ${current.applied} ／ 新增 ${current.added.length} ／ 更新 ${current.updated.length} ／ 删除 ${current.removed.length} ／ errors: ${errors}`;
});

const errorText = computed<string>(() => {
  if (parseError.value !== '') {
    return parseError.value;
  }
  return result.value?.errors.join('\n') ?? '';
});

const context = {
  addElementRaw: scene.addElementRaw,
  removeElementRaw: scene.removeElementRaw,
  updateElementRaw: scene.updateElementRaw,
  addPipeRaw: scene.addPipeRaw,
  getTemplateName: (tagTemplateId: string) =>
    runtime.tagTemplates.find((template) => template.tagTemplateId === tagTemplateId)?.name,
  clearRaw: scene.clearRaw,
  elementsSnapshot: scene.elementsSnapshot,
  pipesSnapshot: scene.pipesSnapshot
};

function onApply(): void {
  parseError.value = '';
  let parsed: unknown;
  try {
    parsed = JSON.parse(commandText.value) as unknown;
  } catch (error) {
    result.value = null;
    parseError.value = error instanceof Error ? error.message : String(error);
    return;
  }

  // 整批 applyOps 只登记一次历史（有实际变更时），批内每条 op 不单独压栈。
  const nextResult = scene.withHistoryBatch(
    () => applyOps(parsed as Parameters<typeof applyOps>[0], context),
    (applied) => applied.applied > 0
  );
  result.value = nextResult;
  emit('applied', nextResult.applied);
}

function onExport(): void {
  commandText.value = JSON.stringify(
    describeScene({
      elements: scene.elements,
      pipes: scene.pipes
    }),
    null,
    2
  );
  result.value = null;
  parseError.value = '';
}

function onClearText(): void {
  commandText.value = '';
  result.value = null;
  parseError.value = '';
}
</script>

<template>
  <details class="describe-panel">
    <summary class="panel-summary">描述指令</summary>

    <div class="panel-body">
      <textarea
        v-model="commandText"
        class="command-input"
        aria-label="声明式画面 JSON 指令"
        placeholder='[{"op":"add","kind":"rect","x":20,"y":20}]'
      />

      <div class="action-row">
        <button class="panel-button is-primary" type="button" @click="onApply">应用</button>
        <button class="panel-button" type="button" @click="onExport">导出当前画面</button>
        <button class="panel-button" type="button" @click="onClearText">清空文本</button>
      </div>

      <p class="result-line" aria-live="polite">{{ resultText }}</p>
      <pre v-if="errorText !== ''" class="error-output">{{ errorText }}</pre>

      <p class="template-hint">{{ templateHint }}</p>
      <p class="template-example">textTemplate 示例：设备 {n}</p>
    </div>
  </details>
</template>

<style scoped>
.describe-panel {
  display: block;
  background: #1e2124;
  border-top: 1px solid #33373b;
}

.panel-summary {
  padding: 10px 16px;
  color: #e4e6e3;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  list-style-position: inside;
  user-select: none;
}

.panel-summary:hover {
  background: #272b2f;
}

.panel-body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 42vh;
  padding: 0 12px 12px;
  overflow-y: auto;
}

.command-input {
  min-height: 132px;
  padding: 8px;
  color: #e4e6e3;
  font-family: "SFMono-Regular", Menlo, Consolas, monospace;
  font-size: 11px;
  line-height: 1.5;
  resize: vertical;
  background: #15171a;
  border: 1px solid #33373b;
  border-radius: 6px;
}

.command-input:focus {
  outline: none;
  border-color: #5a9ade;
}

.action-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.panel-button {
  padding: 5px 8px;
  color: #e4e6e3;
  font-size: 12px;
  background: #272b2f;
  border: 1px solid #33373b;
  border-radius: 6px;
  cursor: pointer;
}

.panel-button:hover {
  background: #31363b;
  border-color: #4a4f55;
}

.panel-button.is-primary {
  color: #15171a;
  background: #d9b45b;
  border-color: #d9b45b;
}

.panel-button.is-primary:hover {
  background: #e5c36f;
  border-color: #e5c36f;
}

.result-line,
.template-hint,
.template-example {
  margin: 0;
  color: #a8aba6;
  font-size: 11px;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.result-line {
  color: #e4e6e3;
  font-family: "SFMono-Regular", Menlo, Consolas, monospace;
}

.error-output {
  max-height: 96px;
  margin: 0;
  padding: 6px;
  overflow: auto;
  color: #ffb0a8;
  font-family: "SFMono-Regular", Menlo, Consolas, monospace;
  font-size: 11px;
  white-space: pre-wrap;
  background: #2b1d1d;
  border: 1px solid #6d3535;
  border-radius: 6px;
}

.template-example {
  color: #72766f;
}
</style>
