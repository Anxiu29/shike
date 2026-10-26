<script setup lang="ts">
/**
 * 添加分两步：先选食品/手填，再确认加入父编辑器清单；最终保存餐食才写饮食历史。
 * 此处持有独立草稿，取消不会生成空条目，也不会丢掉外层已有餐食；本地匹配不请求AI。
 * 当前默认先开食品库，手填是后备入口。名称必填；首次选择可补带标记的常见份量，
 * 用户清空后仍允许未知值；明确手填营养时不拿库中其它字段补齐未填部分。
 * 对照 FoodEditor.confirmManualFood/cancelManualFood 与 ManualFoodSheet.test.ts。
 */
import { computed, ref, useId } from 'vue'
import { Check, Utensils, ChevronDown, Search } from '@lucide/vue'
import { calculateNutrients, foodEntrySchema, emptyNutrients, normalizeFoodName, syncPackageEntry, type PackagedFood, type PackageSnapshot, type EstimatedFood, type FoodEntry, type Nutrients } from '@shike/shared'
import { matchedEntry, manualEntry, entryBasis, inputNumber, resizeEntry } from '../lib/entries'
import { entryForFoodChoice } from '../lib/food-picker'
import { db } from '../lib/db'
import { inputNumberLabel, numberLabel } from '../lib/dates'
import AppSheet from './AppSheet.vue'
import FoodPicker from './FoodPicker.vue'
import PackagedLibrary from './PackagedLibrary.vue'
import PackageLabelEditor from './PackageLabelEditor.vue'
import PortionAmountInput from './PortionAmountInput.vue'
import type { PortionSnapshot } from '@shike/shared'
import { typicalPortion, portionAmount } from '@shike/shared'

const props = withDefaults(defineProps<{ personalFoods: EstimatedFood[]; packagedFoods?: PackagedFood[]; initialStage?: 'form' | 'foods'; purpose?: 'meal' | 'library' }>(), { packagedFoods: () => [], initialStage: 'form', purpose: 'meal' })
const emit = defineEmits<{ close: []; add: [entry: FoodEntry]; changed: [] }>()
const formId = useId(), name = ref(''), weight = ref<number | null>(null), unit = ref<'g' | 'ml'>('g'), nutrients = ref<Nutrients>(emptyNutrients())
const stage = ref<'form' | 'foods' | 'packages'>(props.initialStage), choice = ref<FoodEntry | null>(null), selectedId = ref('')
const nameInput = ref<HTMLInputElement | null>(null), error = ref(''), submitted = ref(false)
const fields = [{ key: 'energyKcal', label: '热量', unit: 'kcal' }, { key: 'proteinG', label: '蛋白质', unit: 'g' }, { key: 'fatG', label: '脂肪', unit: 'g' }, { key: 'carbsG', label: '碳水化合物', unit: 'g' }] as const
const portion = ref<PortionSnapshot>()
const hasNutrition = computed(() => Object.values(nutrients.value).some(value => value !== null))
const maximum = (key: keyof Nutrients) => (key === 'energyKcal' ? 1000 : 100) * (unit.value === 'ml' ? 2 : 1)
const baseDraft = computed<FoodEntry | null>(() => {
  if (!name.value.trim()) return null
  if (weight.value !== null && (!Number.isFinite(weight.value) || weight.value < 0 || weight.value > 20000)) return null
  if (fields.some(field => { const value = nutrients.value[field.key]; return value !== null && (!Number.isFinite(value) || value < 0 || value > maximum(field.key)) })) return null
  if (choice.value?.packageSnapshot) return { ...choice.value, name: name.value.trim() }
  // 没有密度时，绝不把每100g资料当作每100mL使用。
  if (unit.value === 'ml') return { ...manualEntry(name.value.trim()), kind: hasNutrition.value ? 'manual' : 'unknown', volumeSnapshot: { amountMl: weight.value, nutrientsPer100ml: { ...nutrients.value } }, provenance: '用户填写的每100mL营养数据，按实际饮用量换算；未填项目保持未知。' }
  if (!hasNutrition.value && choice.value) { const entry = JSON.parse(JSON.stringify(choice.value)) as FoodEntry; resizeEntry(entry, weight.value); return { ...entry, name: name.value.trim() } }
  if (!hasNutrition.value) return matchedEntry(name.value.trim(), weight.value, props.personalFoods)
  return { ...manualEntry(name.value.trim(), weight.value), kind: 'manual', nutrientsPer100g: { ...nutrients.value }, provenance: '用户手动填写的每100g营养数据，按实际可食重量换算；未填项目保持未知。' }
})
const draft = computed<FoodEntry | null>(() => baseDraft.value ? { ...baseDraft.value, ...(portion.value && !baseDraft.value.packageSnapshot ? { portionSnapshot: { ...portion.value } } : {}) } : null)
function changeAmount(value: { amount: number | null; basis: 'g' | 'ml'; portion?: PortionSnapshot }) {
  if (value.basis !== unit.value) { unit.value = value.basis; changeUnit() }
  weight.value = value.amount; portion.value = value.portion; error.value = ''
}
const pickerDraft = computed(() => draft.value ?? manualEntry(name.value))
const energy = computed(() => draft.value ? calculateNutrients(draft.value).energyKcal : null)
async function choose(id: string) {
  if (!id) { stage.value = 'form'; return }
  try {
    const saved = await db.libraryFoods.toArray()
    const entry = entryForFoodChoice(id, unit.value === 'g' ? weight.value : null, props.personalFoods, props.packagedFoods, saved)
    if (!entry) throw new Error('食物已不可用，请重新选择。')
    choice.value = entry; name.value = entry.name; selectedId.value = id
    unit.value = entry.volumeSnapshot ? 'ml' : 'g'; weight.value = entry.volumeSnapshot?.amountMl ?? entry.weightG
    nutrients.value = entry.volumeSnapshot ? { ...entry.volumeSnapshot.nutrientsPer100ml } : emptyNutrients()
    portion.value = entry.portionSnapshot ? { ...entry.portionSnapshot } : undefined
    stage.value = 'form'
  } catch { error.value = '读取食品库失败，请重试。'; stage.value = 'form' }
}
function closeFoods() { if (props.initialStage === 'foods' && !name.value.trim()) emit('close'); else stage.value = 'form' }
function usePackage(entry: FoodEntry) { portion.value = undefined; choice.value = entry; name.value = entry.name; selectedId.value = ''; weight.value = null; nutrients.value = emptyNutrients(); stage.value = 'form' }
function updatePackage(snapshot: PackageSnapshot) { if (choice.value) { choice.value.packageSnapshot = snapshot; syncPackageEntry(choice.value) } }
function renamed() { error.value = ''; if (portion.value?.assumption.startsWith('常见份量估算')) weight.value = null; portion.value = undefined; if (choice.value && normalizeFoodName(name.value) !== normalizeFoodName(choice.value.name) && !choice.value.packageSnapshot) { choice.value = null; selectedId.value = '' } }
function fillCommon(event: FocusEvent) {
  // 用户正要填写重量或选择单位时不抢先改输入，避免焦点切换把“150”和新输入拼接。
  if ((event.relatedTarget as HTMLElement | null)?.closest('.portion-input')) return
  if (name.value.trim() && weight.value === null && !choice.value?.packageSnapshot) { const guess = typicalPortion(name.value, unit.value); weight.value = portionAmount(guess); portion.value = guess }
}
function changeUnit() { weight.value = null; portion.value = undefined; nutrients.value = emptyNutrients(); choice.value = null; selectedId.value = ''; error.value = '' }
function closePackages() { stage.value = 'form'; emit('changed') }
function submit() {
  if (submitted.value) return
  error.value = ''
  if (!name.value.trim()) { error.value = '请先填写食物名称。'; nameInput.value?.focus(); return }
  if (weight.value !== null && (!Number.isFinite(weight.value) || weight.value < 0 || weight.value > 20000)) { error.value = `份量请填0～20,000 ${unit.value === 'ml' ? 'mL' : 'g'}，不确定可以留空。`; return }
  for (const field of fields) { const value = nutrients.value[field.key]; if (value !== null && (!Number.isFinite(value) || value < 0 || value > maximum(field.key))) { error.value = `每100 ${unit.value === 'ml' ? 'mL' : 'g'}的${field.label}请填0～${maximum(field.key)} ${field.unit}，不确定可以留空。`; return } }
  const result = foodEntrySchema.safeParse(draft.value)
  if (!result.success) { error.value = '请核对名称、份量与营养值后再添加。'; return }
  // 这里只提交草稿；餐食由父编辑器最终保存，常用库模式由App保存独立快照。
  submitted.value = true; emit('add', result.data)
}
defineExpose({ saveFailed: (message: string) => { submitted.value = false; error.value = message } })
</script>
<template>
  <AppSheet :open="stage === 'form'" :title="purpose === 'library' ? '添加常用食物' : '添加食物'" :subtitle="purpose === 'library' ? '保存你常吃的份量，下次可以直接添加' : '选食物或包装标签，再填写这次的份量'" :busy="purpose === 'library' && submitted" test-id="manual-food-sheet" @close="emit('close')">
    <form :id="formId" class="manual-food-form" data-testid="manual-food-form" novalidate @submit.prevent="submit">
      <button type="button" class="button secondary full" data-testid="manual-food-choose" @click="stage = 'foods'"><Search :size="18" />选择食物 · 含包装食品</button>
      <label>食物名称 <span class="muted">必填</span><input ref="nameInput" v-model="name" data-testid="manual-food-name" placeholder="例如：米饭、香蕉、自制沙拉" maxlength="200" autocomplete="off" :aria-invalid="!name.trim() && !!error" @input="renamed" @blur="fillCommon" /></label>
      <template v-if="!choice?.packageSnapshot">
        <PortionAmountInput :name="name" :amount="weight" :basis="unit" :portion="portion" allow-volume prefix="manual-food" amount-test-id="manual-food-weight" @change="changeAmount" />
        <p class="tiny muted">{{ unit === 'ml' ? '请按每100 mL填写饮品营养。没有密度时，食物库的每100 g数据不能直接换算。' : '重量不确定可以稍后补充，未填时不会按100 g计入热量。' }}</p>
      </template>
      <PackageLabelEditor v-if="choice?.packageSnapshot" :snapshot="choice.packageSnapshot" :index="0" @change="updatePackage" />
      <div v-if="draft" class="manual-food-preview" data-testid="manual-food-preview"><Utensils :size="19" /><div><strong>{{ hasNutrition ? '使用手动填写的营养值' : draft.kind === 'unknown' ? '营养数据待补充' : `已匹配：${draft.name}` }}</strong><p>{{ entryBasis(draft) }}</p><p>{{ energy === null ? '热量待补充' : `这一项约 ${numberLabel(energy)} kcal` }}</p></div></div>
      <details v-if="!choice?.packageSnapshot" class="manual-food-nutrition"><summary>手填每100 {{ unit === 'ml' ? 'mL' : 'g' }}营养 <span>可选</span><ChevronDown :size="15" /></summary><p class="tiny muted">有确定数值时再填。填入后使用这些数值，不自动补齐其他项目。</p><div class="manual-food-nutrient-grid"><label v-for="field in fields" :key="field.key">{{ field.label }} <span class="muted">{{ field.unit }}</span><input :value="inputNumberLabel(nutrients[field.key])" :data-testid="`manual-food-${field.key}`" type="number" min="0" :max="maximum(field.key)" step="0.01" inputmode="decimal" placeholder="未知可留空" @input="nutrients[field.key] = inputNumber($event); error = ''" /></label></div></details>
      <p v-if="error" class="notice danger" role="alert" data-testid="manual-food-error">{{ error }}</p>
    </form>
    <template #footer><div class="manual-food-footer-wrap"><div class="manual-food-footer"><button type="button" class="button secondary" data-testid="cancel-manual-food" :disabled="purpose === 'library' && submitted" @click="emit('close')">取消</button><button type="submit" :form="formId" class="button primary" data-testid="confirm-manual-food" :disabled="submitted"><Check :size="17" />{{ purpose === 'library' ? submitted ? '保存中…' : '保存到食物库' : '加入清单' }}</button></div><p class="tiny muted manual-food-save-note">{{ purpose === 'library' ? '保存为常用食物，之后可从首页快速添加到任意一餐。' : '加入后还可修改，保存这一餐才会记入历史。' }}</p></div></template>
  </AppSheet>
  <FoodPicker v-if="stage === 'foods'" :entry="pickerDraft" :selected-id="selectedId" :personal-foods="personalFoods" :packaged-foods="packagedFoods" @close="closeFoods" @select="choose" @packages="stage = 'packages'" />
  <PackagedLibrary v-if="stage === 'packages'" @select="usePackage" @close="closePackages" />
</template>
