import { describe, expect, it } from 'vitest'
import { applyEstimateLevel, createEstimatedFoodEntry, createRecipeEntry, findFood, findRecipe, foods, recipes } from '@shike/shared'
import { buildFoodChoices, isEverydayFood, recommendFoodChoices, searchFoodChoices } from '../src/lib/food-picker'
import { recognitionEstimate } from '../src/lib/entries'
import { porridgeProfile } from './range-fixture'

const choices = buildFoodChoices([])
describe('食物浏览与本地推荐', () => {
  it('日常筛选隐藏生肉、生蛋和待烹饪干料，保留水果、生菜、黄瓜和坚果', () => {
    const visible = choices.filter(isEverydayFood)
    for (const name of ['生鸡蛋', '生米', '干燕麦', '苦瓜（生）']) expect(visible.some(choice => choice.id === findFood(name)!.id)).toBe(false)
    for (const name of ['米饭', '鸡蛋', '苦瓜', '黄瓜', '生菜', '苹果', '核桃仁', '葡萄干']) expect(visible.some(choice => choice.id === findFood(name)!.id)).toBe(true)
    expect(searchFoodChoices(visible, '小米粥', '主食').some(choice => choice.origin === 'recipe')).toBe(true)
    expect(searchFoodChoices(visible, '三明治', '轻食早餐').length).toBeGreaterThanOrEqual(3)
    expect(searchFoodChoices(visible, '', '汤羹').length).toBeGreaterThan(0)
  })
  it('索引包含完整基础库和参考配方，分类与多个关键词共同过滤', () => {
    expect(choices).toHaveLength(foods.length + recipes.length)
    expect(new Set(choices.map(choice => choice.id)).size).toBe(choices.length)
    const tomatoEgg = findRecipe('番茄炒蛋')!
    expect(searchFoodChoices(choices, '西红柿 鸡蛋', '家常菜').map(choice => choice.id)).toContain(tomatoEgg.id)
    expect(searchFoodChoices(choices, '西红柿', '水果')).toEqual([])
    const raw = foods.find(food => food.name.includes('苦瓜') && food.state === 'raw')!
    const cooked = findFood('苦瓜')!
    const filtered = searchFoodChoices(choices, '苦瓜', '蔬菜')
    expect(filtered.map(choice => choice.id)).toEqual(expect.arrayContaining([raw.id, cooked.id]))
    expect(filtered.find(choice => choice.id === raw.id)!.description).toContain('生重')
    expect(filtered.find(choice => choice.id === cooked.id)!.description).toContain('熟重')
  })
  it('五千条以上的膳食参考支持中文、原文和同义词搜索，做法限定不丢失', () => {
    const visible = choices.filter(isEverydayFood)
    expect(visible.length).toBeGreaterThan(5000)
    for (const query of ['包子', 'Bao bun']) expect(searchFoodChoices(visible, query).some(choice => choice.id === 'fdc-2708724')).toBe(true)
    expect(searchFoodChoices(visible, '蒸饺', '熟食菜肴').some(choice => choice.id === 'fdc-2708708')).toBe(true)
    expect(searchFoodChoices(visible, '司康').length).toBeGreaterThan(1)
    expect(searchFoodChoices(visible, '寿司').length).toBeGreaterThan(5)
    expect(searchFoodChoices(visible, '马铃薯').map(choice => choice.id)).toEqual(searchFoodChoices(visible, '土豆').map(choice => choice.id))
    expect(searchFoodChoices(visible, '西红柿').map(choice => choice.id)).toEqual(searchFoodChoices(visible, '番茄').map(choice => choice.id))
    const bao = visible.find(choice => choice.id === 'fdc-2708724')!
    expect(bao.description).toContain('膳食参考')
    expect(bao.description).toContain('请核对做法')
    expect(bao.nutrientsPer100g.energyKcal).toBe(273)
  })
  it('识别名称的别名可推荐相应配方，可见配料提高相符候选的排名', () => {
    const result = recommendFoodChoices(choices, { name: '西红柿炒鸡蛋', visibleIngredients: ['番茄', '鸡蛋'] })
    expect(result[0]!.choice.id).toBe(findRecipe('番茄炒蛋')!.id)
    const fromIngredients = recommendFoodChoices(choices, { name: '一盘炒菜', visibleIngredients: ['西红柿', '鸡蛋'] })
    expect(fromIngredients.some(item => item.choice.id === findRecipe('番茄炒蛋')!.id)).toBe(true)
    expect(fromIngredients.find(item => item.choice.id === findRecipe('番茄炒蛋')!.id)!.reason).toContain('配料接近')
  })
  it('粥和熟食不推荐干谷物或生肉，无足够线索时不凑推荐', () => {
    const porridge = recommendFoodChoices(choices, { name: '红豆杂粮粥', visibleIngredients: ['燕麦', '红豆'] })
    expect(porridge.length).toBeGreaterThan(0)
    expect(porridge.some(item => item.choice.name.includes('粥'))).toBe(true)
    expect(porridge.every(item => item.choice.state !== 'dry' && item.choice.state !== 'raw')).toBe(true)
    const chicken = recommendFoodChoices(choices, { name: '蒸鸡胸肉', visibleIngredients: ['鸡肉'] })
    expect(chicken.length).toBeGreaterThan(0)
    expect(chicken.every(item => item.choice.state !== 'raw')).toBe(true)
    expect(recommendFoodChoices(choices, { name: '无法判断', visibleIngredients: [] })).toEqual([])
    expect(recommendFoodChoices(choices, { name: '', visibleIngredients: ['番茄'] })).toEqual([])
  })
  it('个人条目默认中档并排除模拟数据，当前历史仍显示原选档快照', () => {
    const estimate = recognitionEstimate('杂粮粥', null, ['仅测试情景'], 'gemini', 'test-model', porridgeProfile)!
    const high = applyEstimateLevel(createEstimatedFoodEntry(estimate, 300), 'high')
    const result = buildFoodChoices([estimate, { ...estimate, id: 'mock-example', provider: 'mock' }], high)
    expect(result.some(choice => choice.id === 'personal:mock-example')).toBe(false)
    expect(result.find(choice => choice.id === `personal:${estimate.id}`)!.energyRange).toEqual({ min: 60, max: 90 })
    expect(result.find(choice => choice.id === 'ai-current')!.energyRange).toEqual({ min: 90, max: 120 })
    const mock = createEstimatedFoodEntry({ ...estimate, provider: 'mock' }, 300)
    expect(buildFoodChoices([], mock)[0]!.description).toContain('模拟 AI 估算')
    const recipe = applyEstimateLevel(createRecipeEntry(findRecipe('蛋炒饭')!, 300), 'low')
    const current = buildFoodChoices([], undefined, { entry: recipe, selectedId: recipe.referenceId! }).find(choice => choice.id === recipe.referenceId)!
    expect(current.nutrientsPer100g).toEqual(recipe.nutrientsPer100g)
    expect(current.energyRange!.max).toBeLessThan(choices.find(choice => choice.id === recipe.referenceId)!.energyRange!.max)
  })
  it('库中条目移除后保留历史快照选项，不丢失已选数据', () => {
    const entry = createRecipeEntry(findRecipe('蛋炒饭')!, 300)
    const snapshot = buildFoodChoices([], undefined, { entry, selectedId: 'removed-reference' }).find(choice => choice.id === 'removed-reference')!
    expect(snapshot.category).toBe('当前记录')
    expect(snapshot.nutrientsPer100g).toEqual(entry.nutrientsPer100g)
  })
})
