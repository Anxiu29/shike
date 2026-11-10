<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Sparkles, LoaderCircle } from '@lucide/vue'
import { portionUnits, type PackageLabel, type PortionSnapshot } from '@shike/shared'
import { estimatePortion } from '../lib/portion-estimation'
const props = defineProps<{ name: string; unit?: PortionSnapshot['unit']; basis?: 'g' | 'ml'; label?: PackageLabel; auto?: boolean; revision: string; disabled?: boolean }>()
const emit = defineEmits<{ estimated: [portion: PortionSnapshot]; estimating: [busy: boolean] }>()
const unit = ref(props.unit ?? '个'), busy = ref(false), error = ref('')
let generation = 0, mounted = false
watch(() => [props.name, props.unit, props.revision], () => { generation++; error.value = ''; if (props.unit) unit.value = props.unit })
async function run() {
  if (busy.value || props.disabled || !props.name.trim()) return
  const token = ++generation, revision = props.revision, name = props.name, selectedUnit = unit.value
  busy.value = true; error.value = ''; emit('estimating', true)
  try {
    const result = await estimatePortion({ name, unit: selectedUnit, ...(props.basis ? { basis: props.basis } : {}), ...(props.label ? { label: JSON.parse(JSON.stringify(props.label)) } : {}) })
    // 用户已改数量/标签、换食品或关闭面板时，不让迟到的模型结果覆盖新输入。
    if (mounted && token === generation && revision === props.revision && name === props.name) emit('estimated', result)
  } catch (cause) { if (mounted && token === generation) error.value = cause instanceof Error ? cause.message : '暂时无法估重，请手动填写。' }
  finally { if (mounted) { busy.value = false; emit('estimating', false) } }
}
onMounted(() => { mounted = true; if (props.auto) void run() })
watch(() => props.auto, value => { if (mounted && value) void run() })
onBeforeUnmount(() => { mounted = false; generation++; emit('estimating', false) })
</script>
<template>
  <div class="portion-estimator">
    <div><label>估重单位<select v-model="unit" aria-label="AI估重单位" data-testid="portion-estimate-unit" :disabled="busy || disabled"><option v-for="item in portionUnits" :key="item" :value="item">{{ item === '包' || item === '袋' ? `独立小${item}` : item === '盒' ? '整盒' : item }}</option></select></label><button type="button" class="text-button" data-testid="portion-estimate" :disabled="busy || disabled || !name.trim()" @click="run"><LoaderCircle v-if="busy" class="spin" :size="15"/><Sparkles v-else :size="15"/>{{ busy ? '正在估重…' : 'AI估计单个大小' }}</button></div>
    <p class="tiny muted">使用所选模型，可能消耗额度；AI估重不是称重或标签实测，大小可修改。</p>
    <p v-if="error" class="tiny amber-text" data-testid="portion-estimate-error" role="status">{{ error }}</p>
  </div>
</template>
<style scoped>
.portion-estimator { margin: 12px 0; padding: 10px; border-radius: 12px; background: #f4f7ef; }
.portion-estimator > div { display: flex; align-items: end; gap: 10px; flex-wrap: wrap; }
.portion-estimator label { font-size: 11px; flex: 1; min-width: 100px; }
.portion-estimator select { display: block; width: 100%; margin-top: 4px; }
.portion-estimator button { min-height: 40px; }
.portion-estimator p { margin: 7px 0 0; line-height: 1.6; }
</style>
