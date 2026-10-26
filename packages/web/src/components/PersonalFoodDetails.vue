<script setup lang="ts">
import { computed } from 'vue'
import { ArrowLeft, Plus } from '@lucide/vue'
import { calculateEnergyRange, calculateNutrients, labelNutrients, selectedEstimateOption, type LibraryFood, type Nutrients } from '@shike/shared'
import AppSheet from './AppSheet.vue'
import { entryBasis } from '../lib/entries'
import { numberLabel, portionLabel, rangeLabel } from '../lib/dates'
import { personalFoodSymbol } from '../lib/personal-foods'

const props = defineProps<{ food: LibraryFood }>()
const emit = defineEmits<{ close: []; add: [] }>()
const entry = computed(() => props.food.entry)
const nutrients = computed(() => calculateNutrients(entry.value))
const energyRange = computed(() => calculateEnergyRange(entry.value))
const estimate = computed(() => entry.value.estimateProfile ? selectedEstimateOption(entry.value.estimateProfile, entry.value.estimateLevel ?? 'medium') : null)
const basis = computed(() => {
  const value = entry.value
  if (value.packageSnapshot) return { label: ({ '100g': '每100 g', '100ml': '每100 mL', serving: '每份', package: '每包', unknown: '标签基准待确认' })[value.packageSnapshot.label.basis], nutrients: labelNutrients(value.packageSnapshot.label) }
  return value.volumeSnapshot ? { label: '每100 mL', nutrients: value.volumeSnapshot.nutrientsPer100ml } : { label: '每100 g', nutrients: value.nutrientsPer100g }
})
const warnings = computed(() => [...new Set([...entry.value.warnings, ...(estimate.value?.assumptions ?? entry.value.aiEstimateSnapshot?.assumptions ?? []), ...(entry.value.recipeSnapshot?.warnings ?? []), ...(entry.value.portionSnapshot ? [entry.value.portionSnapshot.assumption] : [])])])
const fields: { key: keyof Nutrients; label: string; unit: string }[] = [{ key: 'energyKcal', label: '热量', unit: 'kcal' }, { key: 'proteinG', label: '蛋白质', unit: 'g' }, { key: 'fatG', label: '脂肪', unit: 'g' }, { key: 'carbsG', label: '碳水化合物', unit: 'g' }]
const nutrientLabel = (value: number | null, unit: string) => value === null ? '待补充' : `${numberLabel(value)} ${unit}`
</script>

<template>
  <AppSheet open title="食物详情" subtitle="查看常用食物保存的份量与营养依据" test-id="personal-food-details" class-name="personal-food-detail-sheet" @close="emit('close')">
    <div class="personal-detail-heading"><span class="personal-food-symbol" aria-hidden="true">{{ personalFoodSymbol(entry) }}</span><div><h3 data-testid="personal-detail-name">{{ entry.name }}</h3><p>{{ entryBasis(entry) }}</p></div></div>
    <div class="personal-detail-portion"><span>保存的份量</span><strong data-testid="personal-detail-portion">{{ portionLabel(entry) }}</strong><p v-if="energyRange" data-testid="personal-detail-range">估算热量 {{ rangeLabel(energyRange) }} kcal · {{ estimate?.label }} · 按中值记账</p><p v-else>营养按保存的份量换算；缺失项保留为待补充。</p></div>
    <table class="personal-detail-nutrients" data-testid="personal-detail-nutrients"><caption class="sr-only">{{ entry.name }}营养明细</caption><thead><tr><th scope="col">营养</th><th scope="col">保存的份量</th><th scope="col">{{ basis.label }}</th></tr></thead><tbody><tr v-for="field in fields" :key="field.key"><th scope="row">{{ field.label }}</th><td :data-testid="`personal-detail-total-${field.key}`">{{ nutrientLabel(nutrients[field.key], field.unit) }}</td><td :data-testid="`personal-detail-basis-${field.key}`">{{ nutrientLabel(basis.nutrients[field.key], field.unit) }}</td></tr></tbody></table>
    <section v-if="entry.recipeSnapshot" class="personal-detail-section" data-testid="personal-detail-recipe"><h4>保存的配料</h4><dl><div v-for="ingredient in entry.recipeSnapshot.ingredients" :key="ingredient.id"><dt>{{ ingredient.name }}</dt><dd>{{ numberLabel(ingredient.weightG) }} g</dd></div></dl><p>配料沿用保存时的配方，实际用量请在加入餐食后核对。</p></section>
    <section v-if="entry.packageSnapshot" class="personal-detail-section" data-testid="personal-detail-package"><h4>包装标签</h4><p v-if="entry.packageSnapshot.brand">品牌：{{ entry.packageSnapshot.brand }}</p><p v-if="entry.packageSnapshot.barcode">条码：{{ entry.packageSnapshot.barcode }}</p><p v-if="entry.packageSnapshot.label.servingSize">每份：{{ numberLabel(entry.packageSnapshot.label.servingSize.amount) }} {{ entry.packageSnapshot.label.servingSize.unit === 'ml' ? 'mL' : 'g' }}</p><p v-if="entry.packageSnapshot.label.netContent">净含量：{{ numberLabel(entry.packageSnapshot.label.netContent.amount) }} {{ entry.packageSnapshot.label.netContent.unit === 'ml' ? 'mL' : 'g' }}</p><p v-if="entry.packageSnapshot.label.energy">标签原标注热量：{{ numberLabel(entry.packageSnapshot.label.energy.value) }} {{ entry.packageSnapshot.label.energy.unit }} / {{ basis.label }}</p></section>
    <section class="personal-detail-section" data-testid="personal-detail-source"><h4>营养来源</h4><p>{{ entry.provenance || '未填写来源，请核对营养数据。' }}</p><p v-if="entry.aiEstimateSnapshot">{{ entry.aiEstimateSnapshot.provider }} / {{ entry.aiEstimateSnapshot.model }} · AI 粗估，非实测</p><p v-if="entry.packageSnapshot && entry.packageSnapshot.provider !== 'manual'">{{ entry.packageSnapshot.provider }} / {{ entry.packageSnapshot.model }}</p></section>
    <section v-if="warnings.length" class="personal-detail-section personal-detail-notes" data-testid="personal-detail-warnings"><h4>假设与提醒</h4><ul><li v-for="warning in warnings" :key="warning">{{ warning }}</li></ul></section>
    <template #footer><div class="personal-detail-footer"><button type="button" class="button secondary" data-testid="personal-detail-back" @click="emit('close')"><ArrowLeft :size="16" />返回食物库</button><button type="button" class="button primary" data-testid="personal-detail-add" @click="emit('add')"><Plus :size="17" />加入这一餐</button><p>加入后可调整本餐份量，不会改写食物库。</p></div></template>
  </AppSheet>
</template>
