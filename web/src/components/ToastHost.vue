<!-- ToastHost.vue：固定在页面右上角的轻量提示组件，仅负责展示 App 传入的消息。 -->
<!-- 不引入第三方库，显示与消失时机由父组件控制。 -->
<script setup lang="ts">
defineProps<{
  message: string | null;
}>();
</script>

<template>
  <Transition name="toast">
    <div v-if="message !== null" class="toast" role="status" aria-live="polite">
      {{ message }}
    </div>
  </Transition>
</template>

<style scoped>
.toast {
  position: fixed;
  top: 64px;
  right: 18px;
  z-index: 10;
  padding: 10px 14px;
  color: #ffffff;
  font-size: 13px;
  line-height: 1.3;
  background: #272b2f;
  border: 1px solid #4a4f55;
  border-radius: 6px;
  box-shadow: 0 8px 24px rgb(0 0 0 / 35%);
}

.toast-enter-active,
.toast-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
}

.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
