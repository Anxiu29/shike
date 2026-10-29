<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { PackageOpen, ChevronDown } from '@lucide/vue'
import { labelNutrients, packageFactor, type PackageLabel, type PackageSnapshot } from '@shike/shared'
import { inputNumber } from '../lib/entries'
import { inputNumberLabel, numberLabel } from '../lib/dates'
const props = defineProps<{ snapshot: PackageSnapshot; index: number }>()
const emit = defineEmits<{ change: [value: PackageSnapshot] }>()
const basisNames = { '100g': '每 100 g', '100ml': '每 100 mL', serving: '每份', package: '每包', unknown: '基准待确认' }
const fields = [{ key: 'proteinG', label: '蛋白质' }, { key: 'fatG', label: '脂肪' }, { key: 'carbsG', label: '碳水化合物' }] as const
const kcal = computed(() => labelNutrients(props.snapshot.label).energyKcal)
const factor = computed(() => packageFactor(props.snapshot))
function update(change: (value: PackageSnapshot) => void, labelChanged = false) {
  const next = JSON.parse(JSON.stringify(props.snapshot)) as PackageSnapshot
  change(next); if (labelChanged) next.manuallyEdited = true
  emit('change', next)
}
function labelNumber(key: 'energy' | 'proteinG' | 'fatG' | 'carbsG', event: Event) {
  const value = inputNumber(event)
  update(next => { if (key === 'energy') next.label.energy = value === null ? null : { value, unit: next.label.energy?.unit ?? energyUnit.value }; else next.label[key] = value }, true)
}
// 能量为空时也允许先选单位；这是编辑状态，不写入不存在的0值。
const energyUnit = ref<'kJ' | 'kcal'>(props.snapshot.label.energy?.unit ?? 'kJ')
watch(() => props.snapshot.label.energy?.unit, unit => { if (unit) energyUnit.value = unit })
function measure(key: 'servingSize' | 'netContent', event: Event) {
  const amount = inputNumber(event)
  update(next => { next.label[key] = amount === null || amount <= 0 ? null : { amount, unit: next.label[key]?.unit ?? (next.label.basis === '100ml' ? 'ml' : 'g') } }, true)
}
function canTake(unit: 'serving' | 'package') { return packageFactor({ ...props.snapshot, consumedAmount: 1, consumedUnit: unit }) !== null }
</script>
<template>
  <section class="package-label-editor" :data-testid="`package-label-${index}`">
    <div class="package-label-title"><PackageOpen :size="19" /><strong>包装营养表</strong><span>{{ snapshot.provider === 'mock' ? '模拟标签' : snapshot.manuallyEdited ? '已手动修改' : snapshot.source ? '公开商品参考 · 请核对' : snapshot.provider === 'offline' ? '本机识读（试验）· 请核对' : 'AI 读取 · 请核对' }}</span></div>
    <p v-if="snapshot.source" class="tiny muted"><a :href="snapshot.source.url" target="_blank" rel="noopener noreferrer">Open Food Facts · ODbL-1.0 · 查看来源</a></p>
    <div class="package-label-values"><span>{{ basisNames[snapshot.label.basis] }}</span><strong>{{ snapshot.label.energy ? `${numberLabel(snapshot.label.energy.value)} ${snapshot.label.energy.unit}` : '能量待补充' }}</strong><small v-if="snapshot.label.energy?.unit === 'kJ'">折合约 {{ numberLabel(kcal) }} kcal</small></div>
    <p class="tiny muted">净含量 {{ snapshot.label.netContent ? `${numberLabel(snapshot.label.netContent.amount)} ${snapshot.label.netContent.unit === 'ml' ? 'mL' : 'g'}` : '待补充' }}<template v-if="snapshot.label.servingSize"> · 每份 {{ numberLabel(snapshot.label.servingSize.amount) }} {{ snapshot.label.servingSize.unit === 'ml' ? 'mL' : 'g' }}</template>。净含量不等于已吃份量。</p>
    <div class="package-consumption"><h4>这次吃了多少？</h4><div class="package-amount-row"><label>实际摄入<input :value="inputNumberLabel(snapshot.consumedAmount)" :data-testid="`package-amount-${index}`" type="number" min="0" :max="['serving', 'package'].includes(snapshot.consumedUnit) ? 100 : 20000" step="0.01" inputmode="decimal" placeholder="请填写，不默认吃完整包" @input="update(next => { next.consumedAmount = inputNumber($event) })" /></label><label>单位<select :value="snapshot.consumedUnit" :data-testid="`package-unit-${index}`" @change="update(next => { next.consumedUnit = ($event.target as HTMLSelectElement).value as PackageSnapshot['consumedUnit']; next.consumedAmount = null })"><option value="g">g</option><option value="ml">mL</option><option value="serving">份</option><option value="package">包</option></select></label></div><div class="package-shortcuts"><button v-if="canTake('serving')" type="button" :data-testid="`package-one-serving-${index}`" @click="update(next => { next.consumedAmount = 1; next.consumedUnit = 'serving' })">1 份</button><template v-if="canTake('package')"><button type="button" :data-testid="`package-half-${index}`" @click="update(next => { next.consumedAmount = 0.5; next.consumedUnit = 'package' })">半包</button><button type="button" :data-testid="`package-whole-${index}`" @click="update(next => { next.consumedAmount = 1; next.consumedUnit = 'package' })">整包</button></template></div><p v-if="snapshot.consumedAmount === null" class="tiny amber-text">请填写实际摄入量，未默认按整包计算。</p><p v-else-if="factor === null" class="tiny amber-text" :data-testid="`package-conversion-warning-${index}`">缺少对应换算信息。请核对营养表基准、每份大小和净含量；mL 不会直接当作 g。</p></div>
    <p v-if="snapshot.label.basis === 'unknown'" class="notice warning tiny">尚未读清营养表基准，请补拍包装背面，或展开下方手动填写。</p>
    <details class="package-correction" :data-testid="`package-correction-${index}`"><summary>核对／修正标签数字 <ChevronDown :size="15" /></summary><div class="package-label-fields"><label>营养表基准<select :value="snapshot.label.basis" :data-testid="`package-basis-${index}`" @change="update(next => { next.label.basis = ($event.target as HTMLSelectElement).value as PackageLabel['basis'] }, true)"><option v-for="(name, key) in basisNames" :key="key" :value="key">{{ name }}</option></select></label><div class="package-amount-row"><label>标签能量<input :value="inputNumberLabel(snapshot.label.energy?.value)" :data-testid="`package-energy-${index}`" type="number" min="0" max="100000" step="0.01" inputmode="decimal" placeholder="看不清留空" @input="labelNumber('energy', $event)" /></label><label>原单位<select v-model="energyUnit" :data-testid="`package-energy-unit-${index}`" @change="update(next => { if (next.label.energy) next.label.energy.unit = energyUnit }, true)"><option value="kJ">kJ</option><option value="kcal">kcal</option></select></label></div><div class="package-macro-inputs"><label v-for="field in fields" :key="field.key">{{ field.label }}（g）<input :value="inputNumberLabel(snapshot.label[field.key])" :data-testid="`package-${field.key}-${index}`" type="number" min="0" max="5000" step="0.01" inputmode="decimal" placeholder="看不清留空" @input="labelNumber(field.key, $event)" /></label></div><div v-for="item in ([{ key: 'servingSize', name: '每份大小' }, { key: 'netContent', name: '整包净含量' }] as const)" :key="item.key" class="package-amount-row"><label>{{ item.name }}<input :value="inputNumberLabel(snapshot.label[item.key]?.amount)" :data-testid="`package-${item.key}-${index}`" type="number" min="0.01" max="20000" step="0.01" inputmode="decimal" placeholder="未标注留空" @input="measure(item.key, $event)" /></label><label>单位<select :value="snapshot.label[item.key]?.unit ?? (snapshot.label.basis === '100ml' ? 'ml' : 'g')" :disabled="!snapshot.label[item.key]" :data-testid="`package-${item.key}-unit-${index}`" @change="update(next => { if (next.label[item.key]) next.label[item.key]!.unit = ($event.target as HTMLSelectElement).value as 'g' | 'ml' }, true)"><option value="g">g</option><option value="ml">mL</option></select></label></div></div><p class="tiny muted">抄写同一列的标注值，不填 NRV%／每日参考值百分比。看不清的值留空；原始读取不等于实测，所有热量仍为估算。</p></details>
  </section>
</template>
