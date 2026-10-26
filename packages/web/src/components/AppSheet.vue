<script setup lang="ts">
/**
 * 通用弹窗：Teleport 放到 body，dialog.showModal 阻止背景交互，slot 填内容与底部动作。
 * 打开时保存焦点和背景 overflow，关闭/卸载时恢复；Tab 在可见可用控件内循环。
 * visualViewport 跟随可视区域变化，配合 style.css 的独立滚动和底部操作区适配短屏。
 * busy 时所有关闭入口复用同一保护，安卓返回仍被当前层消费；不会替业务保存数据。
 * interaction.spec.ts 检查焦点、Escape、撤销和短屏；软键盘与安全区仍需真机验收。
 */
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import { X } from '@lucide/vue'
import { useBackLayer } from '../lib/use-back-layer'
const props = defineProps<{ open: boolean; title: string; subtitle?: string; busy?: boolean; testId?: string; className?: string }>()
const emit = defineEmits<{ close: [] }>()
const dialog = ref<HTMLDialogElement | null>(null), heading = ref<HTMLElement | null>(null)
const titleId = useId()
let previousFocus: HTMLElement | null = null, oldOverflow: string | null = null
function viewport() {
  const view = window.visualViewport
  dialog.value?.style.setProperty('--sheet-viewport', `${view?.height ?? window.innerHeight}px`)
  dialog.value?.style.setProperty('--sheet-offset', `${Math.max(0, window.innerHeight - (view?.height ?? window.innerHeight) - (view?.offsetTop ?? 0))}px`)
}
function unlock() {
  if (oldOverflow !== null) { document.body.style.overflow = oldOverflow; oldOverflow = null }
  if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true })
  previousFocus = null
}
async function sync() {
  await nextTick()
  if (props.open && dialog.value && !dialog.value.open) {
    previousFocus = document.activeElement as HTMLElement
    oldOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden'
    viewport(); dialog.value.showModal(); heading.value?.focus({ preventScroll: true })
  } else if (!props.open && dialog.value?.open) { dialog.value.close(); unlock() }
}
function close() { if (!props.busy) emit('close') }
useBackLayer(() => props.open, close)
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab' || event.defaultPrevented || !dialog.value) return
  // 原生 dialog 会阻止背景交互，但部分浏览器仍允许 Tab 进入地址栏；在表单内循环焦点。
  const controls = [...dialog.value.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]')]
    .filter(element => element.tabIndex >= 0 && !element.matches(':disabled, [inert]') && element.getClientRects().length > 0)
  const first = controls[0], last = controls.at(-1), current = document.activeElement
  if (!first || !last) { event.preventDefault(); heading.value?.focus(); return }
  if (event.shiftKey && (current === first || !controls.includes(current as HTMLElement))) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && (current === last || !controls.includes(current as HTMLElement))) { event.preventDefault(); first.focus() }
}
function backdrop(event: MouseEvent) {
  const element = dialog.value
  if (!element || event.target !== element) return
  const box = element.getBoundingClientRect()
  if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) close()
}
watch(() => props.open, sync, { flush: 'post' })
onMounted(() => { void sync(); window.visualViewport?.addEventListener('resize', viewport); window.visualViewport?.addEventListener('scroll', viewport) })
onBeforeUnmount(() => { dialog.value?.close(); unlock(); window.visualViewport?.removeEventListener('resize', viewport); window.visualViewport?.removeEventListener('scroll', viewport) })
</script>
<template>
  <Teleport to="body">
    <dialog ref="dialog" class="app-sheet" :class="className" :aria-labelledby="titleId" :data-testid="testId" @cancel.prevent="close" @click="backdrop" @keydown="trapFocus">
      <template v-if="open">
        <header class="sheet-header"><div><h2 :id="titleId" ref="heading" tabindex="-1">{{ title }}</h2><p v-if="subtitle">{{ subtitle }}</p></div><button type="button" class="icon-button sheet-close" :aria-label="`关闭${title}`" :disabled="busy" data-testid="close-sheet" @click="close"><X :size="21" /></button></header>
        <div class="sheet-body"><slot /></div>
        <footer v-if="$slots.footer" class="sheet-footer"><slot name="footer" /></footer>
      </template>
    </dialog>
  </Teleport>
</template>
