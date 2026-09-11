<!-- PropertyPanel.vue：右侧属性面板，编辑选中图元的位置、尺寸、颜色、文字与点位绑定。 -->
<!-- 绑定采用「点位模板 + 设备号」，地址只读展示且由后端解析，不在画面中写入。 -->
<script setup lang="ts">
import { computed } from 'vue';
import { useSceneStore } from '../stores/scene';
import { useRuntimeStore } from '../stores/runtime';
import type { Device, Element, ResolvedTag, TagTemplate } from '../types';

const scene = useSceneStore();
const runtime = useRuntimeStore();

// 当前选中图元；无选中时为 null，模板据此切换占位提示与编辑表单。
const selected = computed<Element | null>(() => scene.selectedElement);
const selectionCount = computed<number>(() => scene.selectedIds.length);
const multipleSelected = computed<boolean>(() => selectionCount.value > 1);

// 模板下拉当前值：未绑定统一映射为空串，提交时再还原为 null。
const templateSelectValue = computed<string>(() => selected.value?.tagTemplateId ?? '');

// 设备下拉当前值：未选择模板时置空并禁用，避免出现设备号非空但模板空的非法组合。
const deviceSelectValue = computed<string>(() => {
  if (selected.value?.tagTemplateId === null || selected.value?.tagTemplateId === undefined) {
    return '';
  }
  return selected.value.deviceNo === null ? '' : String(selected.value.deviceNo);
});

// 解析展示使用的设备号：图元未指定实例时回落到顶栏当前设备号。
const effectiveDeviceNo = computed<number | null>(
  () => selected.value?.deviceNo ?? runtime.activeDeviceNo
);

const selectedDevice = computed<Device | undefined>(() => {
  const deviceNo = effectiveDeviceNo.value;
  if (deviceNo === null) {
    return undefined;
  }
  return runtime.devices.find((device) => device.deviceNo === deviceNo);
});

const selectedResolvedTag = computed<ResolvedTag | undefined>(() =>
  runtime.getResolvedTag(effectiveDeviceNo.value, selected.value?.tagTemplateId ?? null)
);

const selectedTemplate = computed<TagTemplate | undefined>(() => {
  const tagTemplateId = selected.value?.tagTemplateId;
  if (tagTemplateId === null || tagTemplateId === undefined) {
    return undefined;
  }
  return runtime.tagTemplates.find((template) => template.tagTemplateId === tagTemplateId);
});

// 按钮图元只允许绑定可写模板，其他类型保持全量模板列表。
const visibleTemplates = computed<TagTemplate[]>(() => {
  if (selected.value?.type !== 'button') {
    return runtime.tagTemplates;
  }
  return runtime.tagTemplates.filter((template) => template.writable);
});

// 只读显示解析结果；元数据或组合暂不可用时给出明确占位，不把地址写回图元。
const resolvedAddressText = computed<string>(() => {
  const element = selected.value;
  if (element === null || element.tagTemplateId === null) {
    return '未绑定点位';
  }
  const deviceNo = element.deviceNo ?? runtime.activeDeviceNo;
  const deviceName = selectedDevice.value?.name ?? `${deviceNo}号设备`;
  const address = selectedResolvedTag.value?.address ?? '--';
  if (element.deviceNo === null) {
    return `跟随当前设备号（当前 ${deviceNo}# ${deviceName}）· ${address}`;
  }
  return `${deviceName} · ${address}`;
});

// number 输入统一走这里：空值或非法数字忽略，合法则取整写回。
function onNumberInput(key: 'x' | 'y' | 'w' | 'h', event: Event): void {
  const raw = (event.target as HTMLInputElement).value;
  if (raw === '') {
    return;
  }
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    return;
  }
  scene.updateSelected({ [key]: Math.round(parsed) });
}

// 颜色输入即时写回；id/type 不允许通过面板修改，因此单独处理其余字段。
function onFillInput(event: Event): void {
  scene.updateSelected({ fill: (event.target as HTMLInputElement).value });
}

// 文本输入即时写回。
function onTextInput(event: Event): void {
  scene.updateSelected({ text: (event.target as HTMLInputElement).value });
}

// 模板下拉：选择模板即绑定为跟随当前设备号；清空则同时清除两个绑定字段。
function onTemplateChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  if (value === '') {
    scene.updateSelected({ tagTemplateId: null, deviceNo: null });
    return;
  }
  scene.updateSelected({ tagTemplateId: value, deviceNo: null });
}

// 设备号下拉选择空值时仅取消设备实例，保留点位模板以跟随当前设备号。
function onDeviceChange(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  if (value === '') {
    scene.updateSelected({ deviceNo: null });
    return;
  }
  scene.updateSelected({ deviceNo: Number(value) });
}
</script>

<template>
  <aside class="property-panel" aria-label="属性面板">
    <h2 class="panel-title">属性</h2>

    <p v-if="selectionCount === 0" class="empty-hint">未选中图元</p>

    <div v-else-if="multipleSelected" class="multi-selection">
      <p class="multi-selection-hint">已选中 {{ selectionCount }} 个图元</p>
      <button class="delete-button" type="button" @click="scene.removeSelected()">删除选中</button>
    </div>

    <div v-else-if="selected !== null" class="panel-body">
      <div class="meta-row">
        <span class="meta-label">ID</span>
        <span class="meta-value">{{ selected.id }}</span>
      </div>
      <div class="meta-row">
        <span class="meta-label">类型</span>
        <span class="meta-value">{{ selected.type }}</span>
      </div>

      <label class="field">
        <span class="field-label">x</span>
        <input
          class="field-input"
          type="number"
          :value="selected.x"
          @input="onNumberInput('x', $event)"
        />
      </label>

      <label class="field">
        <span class="field-label">y</span>
        <input
          class="field-input"
          type="number"
          :value="selected.y"
          @input="onNumberInput('y', $event)"
        />
      </label>

      <label class="field">
        <span class="field-label">w</span>
        <input
          class="field-input"
          type="number"
          :value="selected.w"
          @input="onNumberInput('w', $event)"
        />
      </label>

      <label class="field">
        <span class="field-label">h</span>
        <input
          class="field-input"
          type="number"
          :value="selected.h"
          @input="onNumberInput('h', $event)"
        />
      </label>

      <label class="field">
        <span class="field-label">填充色</span>
        <input class="field-color" type="color" :value="selected.fill" @input="onFillInput" />
      </label>

      <label class="field field-stack">
        <span class="field-label">文字</span>
        <input class="field-input" type="text" :value="selected.text" @input="onTextInput" />
      </label>

      <div class="binding-group">
        <span class="field-label">点位绑定</span>
        <label class="field field-stack">
          <span class="field-label">点位模板</span>
          <select class="field-input" :value="templateSelectValue" @change="onTemplateChange">
            <option value="">不绑定</option>
            <option
              v-for="template in visibleTemplates"
              :key="template.tagTemplateId"
              :value="template.tagTemplateId"
            >
              {{ template.name }}
            </option>
          </select>
          <span v-if="selected.type === 'button'" class="field-hint">按钮只能绑定可写点位</span>
        </label>

        <label class="field field-stack">
          <span class="field-label">设备号</span>
          <select
            class="field-input"
            :value="deviceSelectValue"
            :disabled="selected.tagTemplateId === null"
            @change="onDeviceChange"
          >
            <option value="">跟随当前设备号</option>
            <option
              v-for="device in runtime.devices"
              :key="device.deviceNo"
              :value="device.deviceNo"
            >
              {{ device.deviceNo }}# {{ device.name }}
            </option>
          </select>
        </label>

        <div class="resolved-address" aria-live="polite">
          <span class="resolved-label">解析地址</span>
          <span class="resolved-value">{{ resolvedAddressText }}</span>
          <span v-if="selectedTemplate !== undefined" class="resolved-unit">
            单位：{{ selectedTemplate.unit }}
          </span>
        </div>
      </div>

      <div class="layer-actions">
        <button class="layer-button" type="button" @click="scene.bringForward(selected.id)">
          上移一层
        </button>
        <button class="layer-button" type="button" @click="scene.sendBackward(selected.id)">
          下移一层
        </button>
      </div>

      <button class="delete-button" type="button" @click="scene.removeSelected()">删除图元</button>
    </div>
  </aside>
</template>

<style scoped>
.property-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 240px;
  height: 100%;
  padding: 16px;
  overflow-y: auto;
  background: #1e2124;
  border-left: 1px solid #33373b;
}

.panel-title {
  margin: 0;
  color: #e4e6e3;
  font-size: 14px;
  font-weight: 600;
}

.empty-hint {
  margin: 0;
  color: #a8aba6;
  font-size: 13px;
}

.multi-selection {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.multi-selection-hint {
  margin: 0;
  color: #e4e6e3;
  font-size: 13px;
}

.panel-body {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.meta-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
}

.meta-label {
  color: #a8aba6;
}

.meta-value {
  color: #e4e6e3;
  font-family: "SFMono-Regular", Menlo, Consolas, monospace;
  word-break: break-all;
}

.field {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
}

.field-stack {
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
}

.field-label {
  flex: 0 0 48px;
  color: #a8aba6;
}

.field-input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 4px 6px;
  color: #e4e6e3;
  font-size: 12px;
  background: #15171a;
  border: 1px solid #33373b;
  border-radius: 6px;
}

.field-input:disabled {
  color: #72766f;
  cursor: not-allowed;
  opacity: 0.8;
}

.field-hint {
  color: #a8aba6;
  font-size: 11px;
}

.field-input:focus {
  outline: none;
  border-color: #5a9ade;
}

.field-color {
  width: 40px;
  height: 26px;
  padding: 0;
  background: #15171a;
  border: 1px solid #33373b;
  border-radius: 6px;
  cursor: pointer;
}

.binding-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 4px;
  border-top: 1px solid #33373b;
}

.resolved-address {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px;
  color: #a8aba6;
  font-size: 11px;
  background: #15171a;
  border: 1px solid #2c3034;
  border-radius: 6px;
}

.resolved-label {
  color: #72766f;
}

.resolved-value {
  color: #d9b45b;
  font-family: "SFMono-Regular", Menlo, Consolas, monospace;
  word-break: break-all;
}

.resolved-unit {
  color: #a8aba6;
}

.layer-actions {
  display: flex;
  gap: 8px;
  margin-top: 6px;
}

.layer-button {
  flex: 1 1 0;
  padding: 7px 8px;
  color: #e4e6e3;
  font-size: 12px;
  background: #272b2f;
  border: 1px solid #33373b;
  border-radius: 6px;
  cursor: pointer;
}

.layer-button:hover {
  background: #31363b;
  border-color: #4a4f55;
}

.delete-button {
  margin-top: 6px;
  padding: 8px 12px;
  color: #ffffff;
  font-size: 13px;
  background: #e05252;
  border: 1px solid #e05252;
  border-radius: 6px;
  cursor: pointer;
}

.delete-button:hover {
  background: #c94848;
  border-color: #c94848;
}
</style>
