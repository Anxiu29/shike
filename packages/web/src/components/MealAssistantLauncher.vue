<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { LoaderCircle, MessageCircle } from '@lucide/vue'
import type { EstimatedFood, MealRecord } from '@shike/shared'
import type { Health } from '../lib/api'
import type MealAssistant from './MealAssistant.vue'
import AppSheet from './AppSheet.vue'
import AsyncPanelError from './AsyncPanelError.vue'

const props = defineProps<{ date: string; page: string; available: boolean; health: Health | null; personalFoods: EstimatedFood[] }>()
const emit = defineEmits<{ saved: [record: MealRecord]; review: [record: MealRecord, photos: string[]] }>()
const component = shallowRef<typeof MealAssistant | null>(null)
const panel = ref<InstanceType<typeof MealAssistant> | null>(null)
const loading = ref(false), loadError = ref(false)
let disposed = false, openRequested = false
onBeforeUnmount(() => { disposed = true })
// 切主页面或打开其它面板即取消旧意图；即使下载结束前又返回，也等用户重新点击。
watch([() => props.page, () => props.available], () => { openRequested = false; loadError.value = false })

/** 首次点击才下载助手及其食物匹配依赖；载入后保留实例，关闭和切页不销毁草稿。 */
async function activate() {
  if (loading.value || !props.available) return
  loading.value = true; loadError.value = false; openRequested = true
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    // import不能像fetch一样中止：race只限制本次界面等待，迟到的模块不再触发后续show。
    // 超时后资源仍可进入浏览器缓存，用户下一次主动点击时可复用，避免自动重载丢草稿。
    const loaded = await Promise.race([
      import('./MealAssistant.vue'),
      new Promise<never>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error('助手加载超时')), 20_000) }),
    ])
    if (disposed) return
    component.value = loaded.default
    await nextTick()
    // 等待期间用户可能已打开设置、相机或编辑器，不能在另一项操作上突然弹窗。
    if (props.available && openRequested) await panel.value?.show()
  } catch { if (!disposed) loadError.value = props.available && openRequested }
  finally { clearTimeout(timeout); if (!disposed) loading.value = false }
}
function review(record: MealRecord, photos: string[]) { emit('review', record, photos) }
defineExpose({
  // App的保存/取消详细编辑仍调用原助手；这里只转交方法，不复制聊天与草稿状态。
  completeReview: (record: MealRecord) => panel.value?.completeReview(record),
  resumeReview: () => panel.value?.resumeReview(),
})
</script>

<template>
  <button v-if="!component && available" class="assistant-fab" data-testid="assistant-open" aria-label="打开AI记餐助手" :disabled="loading" :aria-busy="loading" @click="activate"><LoaderCircle v-if="loading" class="spin" :size="21"/><MessageCircle v-else :size="21"/><span>{{ loading ? '正在打开…' : 'AI记餐' }}</span></button>
  <component :is="component" v-if="component" ref="panel" :date="date" :available="available" :health="health" :personal-foods="personalFoods" @saved="emit('saved', $event)" @review="review" />
  <AppSheet :open="loadError && available" title="AI记餐助手" test-id="assistant-load-error" class-name="meal-assistant-sheet" @close="loadError = false"><AsyncPanelError /></AppSheet>
</template>
