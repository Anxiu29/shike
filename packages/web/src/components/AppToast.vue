<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { Info, X, LoaderCircle } from '@lucide/vue'
import type { ToastAction } from '../lib/toast'
defineProps<{ message: string; action: ToastAction | null; busy: boolean }>()
const emit = defineEmits<{ close: []; undo: [] }>()
const target = ref<HTMLElement>(document.body)
let observer: MutationObserver | undefined
function syncTarget() {
  // showModal 的顶层不受 z-index 控制。提示放进最上层 dialog，才能看见并点击撤销。
  const dialogs = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')]
  const next = dialogs.at(-1) ?? document.body
  if (target.value !== next) target.value = next
}
onMounted(() => {
  syncTarget()
  observer = new MutationObserver(syncTarget)
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open'] })
})
onBeforeUnmount(() => observer?.disconnect())
</script>
<template>
  <Teleport :to="target"><Transition name="toast"><div v-if="message" class="toast-message" role="status" aria-live="polite" aria-atomic="true" data-testid="toast"><Info :size="18"/><span class="toast-copy">{{ message }}</span><button v-if="action" type="button" class="toast-undo" data-testid="toast-undo" :disabled="busy" @click="emit('undo')"><LoaderCircle v-if="busy" :size="14" class="spin"/>{{ busy ? '撤销中…' : action.label }}</button><button type="button" class="toast-close" aria-label="关闭提示" :disabled="busy" @click="emit('close')"><X :size="16"/></button></div></Transition></Teleport>
</template>
