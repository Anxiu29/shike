<script setup lang="ts">
/**
 * 受控输入：props是当前值，change事件把新总量/口径/份量快照交父组件，自己不写数据库。
 * 选个/碗时沿用已有总量；从g切到mL清空旧数值，不能暗设密度1。
 * 改数量或单份大小经portionAmount换算；直接改总量不沿用失效的数量假设。
 * 包装食品使用自己的PackageLabelEditor，不套用通用“包/袋”重量。
 * 回归：web/tests/portion-input.test.ts及shared/tests/portions.test.ts。
 */
import { computed } from 'vue'
import { defaultPortion, portionAmount, portionUnits, type PortionSnapshot } from '@shike/shared'
import { inputNumber } from '../lib/entries'
import { inputNumberLabel, numberLabel } from '../lib/dates'

const props = defineProps<{ name: string; amount: number | null; basis: 'g' | 'ml'; portion?: PortionSnapshot; allowVolume?: boolean; prefix: string; amountTestId: string; disabled?: boolean }>()
const emit = defineEmits<{ change: [value: { amount: number | null; basis: 'g' | 'ml'; portion?: PortionSnapshot }] }>()
// 自动补的参考份量仍先展示总克数，方便直接称重修改；用户选“个/碗”才展开数量。
const displayedPortion = computed(() => props.portion?.assumption.startsWith('常见份量估算') ? undefined : props.portion)
const unit = computed(() => displayedPortion.value?.unit ?? props.basis)
const units = computed(() => props.basis === 'ml' ? portionUnits.filter(value => !['个', '根', '块', '片'].includes(value)) : portionUnits)
function select(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  if (value === 'g' || value === 'ml') { emit('change', { basis: value, amount: value === props.basis ? props.amount : null }); return }
  const portion = defaultPortion(props.name, value as PortionSnapshot['unit'], props.basis)
  // 已有称重或AI估重比通用大小假设更具体；切单位时先保留总量，不静默改掉热量。
  if (props.amount !== null && Number.isFinite(props.amount) && props.amount >= 0) {
    if (props.amount === 0) portion.quantity = 0
    else portion.amountPerUnit = props.amount
    portion.assumption = '沿用已有总重量／容量，暂按1个所选单位记录；如包含多个，请同时核对数量与每个大小。不是通用标准大小。'
  }
  emit('change', { basis: props.basis, amount: portionAmount(portion), portion })
}
function update(key: 'quantity' | 'amountPerUnit', event: Event) {
  if (!props.portion) return
  const portion = { ...props.portion, [key]: inputNumber(event) }
  if (key === 'amountPerUnit') portion.assumption = '用户调整的单个／单份大小，按数量换算；请按实际称重或标签核对。'
  emit('change', { basis: props.basis, amount: portionAmount(portion), portion })
}
</script>
<template>
  <div class="portion-input">
    <div class="form-row">
      <label>计量单位<select :value="unit" :data-testid="`${prefix}-unit`" :disabled="disabled" @change="select"><option value="g" v-if="basis === 'g' || allowVolume">g · 食物重量</option><option value="ml" v-if="basis === 'ml' || allowVolume">mL · 饮品容量</option><option v-for="option in units" :key="option" :value="option" :disabled="!name.trim()">{{ option }} · 估算份量</option></select></label>
      <label v-if="!displayedPortion">{{ basis === 'ml' ? '饮用量' : '可食重量' }} <span class="muted">{{ basis === 'ml' ? 'mL' : 'g' }} · 可留空</span><input :value="inputNumberLabel(amount)" :data-testid="amountTestId" type="number" min="0" max="20000" step="0.01" inputmode="decimal" :disabled="disabled" placeholder="不确定可留空" @input="emit('change', { basis, amount: inputNumber($event) })" /></label>
      <label v-else>这次{{ basis === 'ml' ? '喝' : '吃' }}了多少（{{ displayedPortion.unit }}）<input :value="inputNumberLabel(displayedPortion.quantity)" :data-testid="`${prefix}-quantity`" type="number" min="0" max="20000" step="0.01" inputmode="decimal" :disabled="disabled" placeholder="例如1、0.5" @input="update('quantity', $event)" /></label>
    </div>
    <p v-if="portion && !displayedPortion" class="tiny muted portion-assumption">{{ portion.assumption }}</p>
    <template v-if="displayedPortion">
      <label class="portion-unit-size">每{{ displayedPortion.unit }}约多少 {{ basis === 'ml' ? 'mL' : 'g' }}<input :value="inputNumberLabel(displayedPortion.amountPerUnit)" :data-testid="`${prefix}-per-unit`" type="number" min="0.01" max="20000" step="0.01" inputmode="decimal" :disabled="disabled" placeholder="可按实际大小修改" @input="update('amountPerUnit', $event)" /></label>
      <p class="portion-summary" :data-testid="`${prefix}-summary`">{{ displayedPortion.quantity === null ? '数量待填' : numberLabel(displayedPortion.quantity) + ' ' + displayedPortion.unit }} ≈ {{ amount === null ? '份量待补充' : numberLabel(amount) + ' ' + (basis === 'ml' ? 'mL' : 'g') }}</p>
      <p class="tiny muted portion-assumption">{{ displayedPortion.assumption }}数量和单份大小不确定时请留空；总份量上限20,000 {{ basis === 'ml' ? 'mL' : 'g' }}。</p>
    </template>
  </div>
</template>
<style scoped>
.portion-input { margin: 12px 0 16px; }
.portion-unit-size { margin-top: 12px; }
.portion-summary { margin: 10px 0 6px; font-size: 14px; color: #367b62; font-weight: 600; }
.portion-assumption { line-height: 1.7; }
</style>
