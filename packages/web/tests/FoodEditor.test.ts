// @vitest-environment happy-dom
import 'fake-indexeddb/auto'
import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'
import { calculateNutrients, applyEstimateLevel, createRecipeEntry, findRecipe, createEstimatedFoodEntry, findFood, type MealRecord, type NutritionEstimateProfile, type EstimateLevel } from '@shike/shared'
import FoodEditor from '../src/components/FoodEditor.vue'
import { recognitionEstimate, matchedEntry } from '../src/lib/entries'
import { ShikeDatabase, saveMeal } from '../src/lib/db'
import { porridgeProfile } from './range-fixture'

let wrapper: VueWrapper | undefined
afterEach(() => { wrapper?.unmount(); wrapper = undefined })

function openAIEditor(options: { profile?: NutritionEstimateProfile; level?: EstimateLevel; weight?: number } = {}): VueWrapper {
  const estimate = recognitionEstimate('杂粮粥', { energyKcal: 50, proteinG: 1.4, fatG: 0.6, carbsG: 10 }, ['假设无糖清水稀粥，含水量未知'], 'gemini', 'test-model', options.profile)!
  let entry = createEstimatedFoodEntry(estimate, options.weight ?? 200)
  if (options.level) entry = applyEstimateLevel(entry, options.level)
  entry.warnings.push('照片无法确定实际份量。')
  const meal: MealRecord = { id: 'existing-meal', date: '2026-10-14', mealType: 'lunch', mode: 'live', createdAt: '2026-10-14T04:00:00.000Z', updatedAt: '2026-10-14T04:00:00.000Z', items: [entry] }
  wrapper = mount(FoodEditor, { attachTo: document.body, props: { date: meal.date, mealType: 'lunch', record: meal, start: 'edit', estimatedFoods: [], health: { status: 'ok', mode: 'live', provider: 'gemini', model: 'test-model' } }, global: { stubs: { teleport: true } } })
  return wrapper
}
async function rename(form: VueWrapper, name: string) {
  await form.get('[data-testid="food-name-0"]').setValue(name)
  await form.get('[data-testid="food-name-0"]').trigger('blur')
}
async function savedRecord(form: VueWrapper): Promise<MealRecord> {
  await form.get('[data-testid="confirm-ai"]').setValue(true)
  await form.get('[data-testid="save-meal"]').trigger('click')
  return form.emitted('save')![0]![0] as MealRecord
}

describe('食物来源筛选', () => {
  it('按名称收窄 USDA 分组，并保留当前计算依据', async () => {
    wrapper = mount(FoodEditor, { attachTo: document.body, props: { date: '2026-10-14', mealType: 'lunch', start: 'manual', estimatedFoods: [], health: null }, global: { stubs: { teleport: true } } })
    await wrapper.get('[data-testid="add-food"]').trigger('click')
    const select = wrapper.get('[data-testid="food-source-0"]')
    expect(select.text()).toContain('米饭')
    expect(select.text()).toContain('苦瓜（水煮）')
    const filter = wrapper.get('[data-testid="food-source-filter-0"]')
    await filter.setValue('苦瓜')
    await new Promise((resolve) => setTimeout(resolve, 0))
    const filtered = wrapper.get('[data-testid="food-source-0"]')
    expect(filtered.text()).toContain('苦瓜（水煮）')
    expect(filtered.text()).not.toContain('白米饭')
    await filtered.setValue(findFood('苦瓜')!.id)
    await filter.setValue('米饭')
    await new Promise((resolve) => setTimeout(resolve, 0))
    const kept = wrapper.get('[data-testid="food-source-0"]')
    expect(kept.element).toHaveProperty('value', findFood('苦瓜')!.id)
    expect(kept.text()).toContain('苦瓜（水煮）')
  })
})

describe('食物名称纠正与估算依据', () => {
  it('AI 杂粮粥改为库内燕麦片时重新匹配，并同步下一次改名基准', async () => {
    const form = openAIEditor()
    await rename(form, '燕麦片')
    expect(form.get('[data-testid="food-source-0"]').element).toHaveProperty('value', findFood('燕麦片')!.id)
    expect(form.get('[data-testid="food-basis-0"]').text()).toContain('USDA')
    expect(form.find('option[value="ai-current"]').exists()).toBe(false)
    expect(form.get('[data-testid="food-calories-0"]').text()).not.toContain('100 kcal')
    await rename(form, '自制新菜')
    expect(form.get('[data-testid="food-source-0"]').element).toHaveProperty('value', '')
    expect(form.get('[data-testid="food-calories-0"]').text()).toBe('待补充')
  })
  it('AI 杂粮粥改为库外新菜时清除原值与候选，保存不会把旧粗估缓存成新菜', async () => {
    const form = openAIEditor()
    await rename(form, '自制新菜')
    expect(form.get('[data-testid="food-calories-0"]').text()).toBe('待补充')
    expect(form.find('option[value="ai-current"]').exists()).toBe(false)
    const saved = await savedRecord(form)
    expect(saved.items[0]!.id).toBe((form.props('record') as MealRecord).items[0]!.id)
    expect(saved.items[0]!.weightG).toBe(200)
    expect(saved.items[0]!.kind).toBe('unknown')
    expect(saved.items[0]!.aiEstimateSnapshot).toBeUndefined()
    expect(calculateNutrients(saved.items[0]!).energyKcal).toBeNull()
    const database = new ShikeDatabase(`rename-test-${crypto.randomUUID()}`)
    try { await saveMeal(saved, database); expect(await database.estimatedFoods.count()).toBe(0) }
    finally { await database.delete() }
  })
  it('规范化同名仅有空白和括号差异时保留 AI 值与候选', async () => {
    const form = openAIEditor()
    await rename(form, ' 杂粮（粥） ')
    expect(form.get('[data-testid="food-calories-0"]').text()).toContain('100 kcal')
    expect(form.find('option[value="ai-current"]').exists()).toBe(true)
    const saved = await savedRecord(form)
    expect(saved.items[0]!.kind).toBe('ai')
    expect(saved.items[0]!.nutrientsPer100g.energyKcal).toBe(50)
  })
  it('用户已手动填写的数值允许改名保留，但不继续带 AI 快照', async () => {
    const form = openAIEditor()
    await form.get('[data-testid="food-energyKcal-0"]').setValue('80')
    await rename(form, '我的手工营养菜')
    const saved = await savedRecord(form)
    expect(saved.items[0]!.kind).toBe('manual')
    expect(saved.items[0]!.nutrientsPer100g.energyKcal).toBe(80)
    expect(saved.items[0]!.aiEstimateSnapshot).toBeUndefined()
  })
})

describe('AI 估算区间与确定值', () => {
  it('默认中档显示每 100 g 与整份区间，以中值记账，切档和重量即时更新', async () => {
    const form = openAIEditor({ profile: porridgeProfile, weight: 300 })
    expect(form.get('[data-testid="estimate-medium-0"]').attributes('aria-pressed')).toBe('true')
    expect(form.get('[data-testid="food-range-0"]').text()).toContain('180–270')
    expect(form.get('[data-testid="food-calories-0"]').text()).toContain('225 kcal')
    expect(form.get('.estimate-range-summary').text()).toContain('60–90')
    await form.get('[data-testid="estimate-high-0"]').trigger('click')
    expect(form.get('[data-testid="food-range-0"]').text()).toContain('270–360')
    expect(form.get('[data-testid="food-calories-0"]').text()).toContain('315 kcal')
    expect(form.get('[data-testid="ai-assumptions-0"]').text()).toContain('糖多')
    await form.get('[data-testid="food-weight-0"]').setValue('600')
    expect(form.get('[data-testid="food-range-0"]').text()).toContain('540–720')
    expect(form.get('[data-testid="food-calories-0"]').text()).toContain('630 kcal')
  })
  it('历史编辑保留原高档，保存缓存原档后新的同名餐仍从中档开始', async () => {
    const form = openAIEditor({ profile: porridgeProfile, level: 'high', weight: 300 })
    expect(form.get('[data-testid="estimate-high-0"]').attributes('aria-pressed')).toBe('true')
    const record = await savedRecord(form)
    expect(record.items[0]!.estimateLevel).toBe('high')
    const database = new ShikeDatabase(`range-cache-${crypto.randomUUID()}`)
    try {
      await saveMeal(record, database)
      const library = await database.estimatedFoods.toArray()
      expect(library[0]!.estimateLevel).toBe('high')
      expect(library[0]!.estimateProfile).toEqual(porridgeProfile)
      const next = matchedEntry('杂粮粥', 300, library)
      expect(next.estimateLevel).toBe('medium')
      expect(calculateNutrients(next).energyKcal).toBe(225)
      expect((await database.meals.get(record.id))!.items[0]!.estimateLevel).toBe('high')
      expect(calculateNutrients((await database.meals.get(record.id))!.items[0]!).energyKcal).toBe(315)
    } finally { await database.delete() }
  })
  it('明确输入每 100 g 80 kcal 后撤销区间与 AI 快照，按 240 kcal 保存', async () => {
    const form = openAIEditor({ profile: porridgeProfile, weight: 300 })
    await form.get('[data-testid="use-known-energy-0"]').trigger('click')
    expect(form.get('[data-testid="nutrition-details-0"]').attributes()).toHaveProperty('open')
    await form.get('[data-testid="food-energyKcal-0"]').setValue('80')
    expect(form.find('[data-testid="food-range-0"]').exists()).toBe(false)
    expect(form.find('[data-testid="estimate-medium-0"]').exists()).toBe(false)
    expect(form.get('[data-testid="food-calories-0"]').text()).toContain('240 kcal')
    const saved = await savedRecord(form)
    expect(saved.items[0]!.estimateProfile).toBeUndefined()
    expect(saved.items[0]!.estimateLevel).toBeUndefined()
    expect(saved.items[0]!.aiEstimateSnapshot).toBeUndefined()
    expect(saved.items[0]!.nutrientsPer100g.proteinG).toBe(1.5)
    expect(saved.items[0]!.warnings).toContain('照片无法确定实际份量。')
    for (const assumption of porridgeProfile.options.flatMap(option => option.assumptions)) expect(saved.items[0]!.warnings).not.toContain(assumption)
  })
  it('旧单值 AI 不伪造区间，范围食物语义改名后清除旧区间', async () => {
    const old = openAIEditor()
    expect(old.find('[data-testid="food-range-0"]').exists()).toBe(false)
    old.unmount()
    const form = openAIEditor({ profile: porridgeProfile, weight: 300 })
    await rename(form, '自制新菜')
    expect(form.find('[data-testid="food-range-0"]').exists()).toBe(false)
    expect(form.get('[data-testid="food-calories-0"]').text()).toBe('待补充')
  })
})

describe('参考配方的用油区间', () => {
  it('重新编辑少油历史后改为多油，仅保留当前假设；确定值覆盖也不恢复旧档', async () => {
    const entry = applyEstimateLevel(createRecipeEntry(findRecipe('蛋炒饭')!, 300), 'low')
    entry.warnings.push('照片中酱料无法确认。')
    const lowAssumptions = entry.estimateProfile!.options.find(option => option.level === 'low')!.assumptions
    const highAssumptions = entry.estimateProfile!.options.find(option => option.level === 'high')!.assumptions
    const meal: MealRecord = { id: 'saved-low-recipe', date: '2026-10-14', mealType: 'lunch', mode: 'manual', createdAt: '2026-10-14T04:00:00.000Z', updatedAt: '2026-10-14T04:00:00.000Z', items: [entry] }
    wrapper = mount(FoodEditor, { attachTo: document.body, props: { date: meal.date, mealType: 'lunch', record: meal, start: 'edit', estimatedFoods: [], health: { status: 'ok', mode: 'live', provider: 'gemini', model: 'test-model' } }, global: { stubs: { teleport: true } } })
    const form = wrapper
    expect(form.get('[data-testid="estimate-low-0"]').attributes('aria-pressed')).toBe('true')
    await form.get('[data-testid="estimate-high-0"]').trigger('click')
    for (const assumption of lowAssumptions.filter(value => !highAssumptions.includes(value))) expect(form.text()).not.toContain(assumption)
    for (const assumption of highAssumptions) expect(form.text()).toContain(assumption)
    await form.get('[data-testid="food-energyKcal-0"]').setValue('80')
    for (const assumption of [...lowAssumptions, ...highAssumptions]) expect(form.text()).not.toContain(assumption)
    await form.get('[data-testid="save-meal"]').trigger('click')
    const saved = form.emitted('save')![0]![0] as MealRecord
    expect(saved.items[0]!.warnings).toContain('照片中酱料无法确认。')
    expect(saved.items[0]!.estimateProfile).toBeUndefined()
  })
  it('成品重量为空或零时禁用油档，恢复正重量后可切档且油基准未破坏', async () => {
    const entry = createRecipeEntry(findRecipe('蛋炒饭')!, 300)
    const meal: MealRecord = { id: 'recipe-zero-weight', date: '2026-10-14', mealType: 'lunch', mode: 'manual', createdAt: '2026-10-14T04:00:00.000Z', updatedAt: '2026-10-14T04:00:00.000Z', items: [entry] }
    wrapper = mount(FoodEditor, { attachTo: document.body, props: { date: meal.date, mealType: 'lunch', record: meal, start: 'edit', estimatedFoods: [], health: { status: 'ok', mode: 'live', provider: 'gemini', model: 'test-model' } }, global: { stubs: { teleport: true } } })
    const form = wrapper
    const originalOil = Number((form.get('[data-testid="recipe-ingredient-oil-0"]').element as HTMLInputElement).value)
    for (const emptyWeight of ['', '0']) {
      await form.get('[data-testid="food-weight-0"]').setValue(emptyWeight)
      expect((form.get('[data-testid="estimate-high-0"]').element as HTMLButtonElement).disabled).toBe(true)
      await form.get('[data-testid="estimate-high-0"]').trigger('click')
      expect(form.get('[data-testid="estimate-medium-0"]').attributes('aria-pressed')).toBe('true')
      expect(Number((form.get('[data-testid="recipe-ingredient-oil-0"]').element as HTMLInputElement).value)).toBe(originalOil)
      expect(form.text()).toContain('先填写成品重量再调整油量')
    }
    await form.get('[data-testid="food-weight-0"]').setValue('300')
    expect((form.get('[data-testid="estimate-high-0"]').element as HTMLButtonElement).disabled).toBe(false)
    await form.get('[data-testid="estimate-high-0"]').trigger('click')
    expect(Number((form.get('[data-testid="recipe-ingredient-oil-0"]').element as HTMLInputElement).value)).toBeGreaterThan(originalOil)
    expect(form.get('[data-testid="estimate-high-0"]').attributes('aria-pressed')).toBe('true')
  })
  it('油档更新配料，整体重量缩放保留档位，手动油量则撤销区间', async () => {
    const entry = createRecipeEntry(findRecipe('蛋炒饭')!, 300)
    const recipeAssumptions = entry.estimateProfile!.options.flatMap(option => option.assumptions)
    const meal: MealRecord = { id: 'recipe-meal', date: '2026-10-14', mealType: 'lunch', mode: 'manual', createdAt: '2026-10-14T04:00:00.000Z', updatedAt: '2026-10-14T04:00:00.000Z', items: [entry] }
    wrapper = mount(FoodEditor, { attachTo: document.body, props: { date: meal.date, mealType: 'lunch', record: meal, start: 'edit', estimatedFoods: [], health: { status: 'ok', mode: 'live', provider: 'gemini', model: 'test-model' } }, global: { stubs: { teleport: true } } })
    const form = wrapper
    expect(form.get('[data-testid="estimate-medium-0"]').attributes('aria-pressed')).toBe('true')
    const originalOil = Number((form.get('[data-testid="recipe-ingredient-oil-0"]').element as HTMLInputElement).value)
    await form.get('[data-testid="estimate-high-0"]').trigger('click')
    const highOil = Number((form.get('[data-testid="recipe-ingredient-oil-0"]').element as HTMLInputElement).value)
    expect(highOil).toBeGreaterThan(originalOil)
    await form.get('[data-testid="food-weight-0"]').setValue('600')
    expect(form.get('[data-testid="estimate-high-0"]').attributes('aria-pressed')).toBe('true')
    expect(Number((form.get('[data-testid="recipe-ingredient-oil-0"]').element as HTMLInputElement).value)).toBeCloseTo(highOil * 2)
    await form.get('[data-testid="recipe-ingredient-oil-0"]').setValue('5')
    expect(form.find('[data-testid="food-range-0"]').exists()).toBe(false)
    await form.get('[data-testid="save-meal"]').trigger('click')
    const saved = form.emitted('save')![0]![0] as MealRecord
    const final = saved.items[0]!
    expect(final.estimateProfile).toBeUndefined()
    expect(final.recipeSnapshot!.ingredients.find(ingredient => ingredient.id === 'oil')!.weightG).toBe(5)
    for (const assumption of recipeAssumptions) expect(final.warnings).not.toContain(assumption)
    const ingredientEnergy = final.recipeSnapshot!.ingredients.reduce((sum, ingredient) => sum + (ingredient.nutrientsPer100g.energyKcal ?? 0) * ingredient.weightG / 100, 0)
    expect(calculateNutrients(final).energyKcal).toBeCloseTo(ingredientEnergy)
  })
})
