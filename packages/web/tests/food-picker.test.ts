import { describe, expect, it } from 'vitest'
import { applyEstimateLevel, createEstimatedFoodEntry, createRecipeEntry, findFood, findRecipe, foods, catalogFoods, builtinPackagedFoods, recipes, parseOffProduct, calculateNutrients } from '@shike/shared'
import { buildFoodChoices, entryForFoodChoice, isEverydayFood, recommendFoodChoices, searchFoodChoices } from '../src/lib/food-picker'
import { recognitionEstimate } from '../src/lib/entries'
import { porridgeProfile } from './range-fixture'

const choices = buildFoodChoices([])
describe('食物浏览与本地推荐', () => {
  it('中式包点默认可见，精确别名优先，肉包不会误命中无肉包子', () => {
    const everyday = choices.filter(isEverydayFood);
    for (const name of ['菜包', '肉包', '香菇青菜包', '豆沙包']) {
      const recipe = findRecipe(name)!;
      expect(searchFoodChoices(everyday, name, '主食')[0]!.id).toBe(recipe.id);
      expect(recommendFoodChoices(everyday, { name, visibleIngredients: [] })[0]!.choice.id).toBe(recipe.id);
    }
    expect(searchFoodChoices(everyday, '肉包').some(food => food.id === 'fdc-2708725')).toBe(false);
    expect(searchFoodChoices(everyday, '菜包').some(food => food.category === '蔬菜' || /蔬菜包含/.test(food.name))).toBe(false);
    expect(recommendFoodChoices(everyday, { name: '肉包', visibleIngredients: [] }).some(item => /无肉/.test(item.choice.name))).toBe(false);
    expect(searchFoodChoices(everyday, '白饅頭').some(food => food.id === 'tfda-R2400201')).toBe(true);
    expect(searchFoodChoices(everyday, '馒头', '主食').some(food => food.id === 'tfda-R2400201')).toBe(true);
  })
  it('近似米饭搜索推荐只展示代表项，旧ID和营养快照仍可编辑', () => {
    const rice = findFood('米饭')!, removed = ['fdc-168880', 'fdc-168882'];
    for (const query of ['中粒米饭', '短粒米饭']) {
      const result = searchFoodChoices(choices, query);
      expect(result.some(choice => choice.id === rice.id)).toBe(true);
      expect(result.some(choice => removed.includes(choice.id))).toBe(false);
      expect(recommendFoodChoices(choices, { name: query, visibleIngredients: [] })[0]!.choice.id).toBe(rice.id);
    }
    const original = foods.find(food => food.id === removed[1])!;
    const entry = entryForFoodChoice(original.id, 200, [], [])!;
    expect(entry.name).toBe(original.name); expect(entry.nutrientsPer100g).toEqual(original.nutrientsPer100g);
    const history = buildFoodChoices([], undefined, { entry, selectedId: original.id }).find(choice => choice.id === original.id)!;
    expect(history.origin).toBe('snapshot'); expect(history.nutrientsPer100g.proteinG).toBe(2.36);
  })
  it('同一选择器含包装分类，按品牌条码搜索；容量标签不展示或累计成克数', () => {
    const food = parseOffProduct({ status: 'success', product: { code: '3274080005003', product_name: '选库牛奶', brands: '包装品牌', quantity: '250 ml', nutriments: { 'energy-kcal_100g': 60 } } }, '3274080005003')!
    const all = buildFoodChoices([], undefined, undefined, [food]), id = `package:${food.id}`
    for (const query of ['牛奶', '包装品牌', '3274080005003']) expect(searchFoodChoices(all, query, '包装食品').map(item => item.id)).toContain(id)
    const choice = all.find(item => item.id === id)!; expect(choice.nutritionPerUnit).toMatchObject({ unitLabel: '每100 mL', value: { energyKcal: 60 } }); expect(choice.nutrientsPer100g.energyKcal).toBeNull()
    const entry = entryForFoodChoice(id, 200, [], [food])!; expect(entry.weightG).toBeNull(); expect(entry.packageSnapshot!.consumedAmount).toBe(250); expect(calculateNutrients(entry).energyKcal).toBe(150); expect(entry.warnings.join(' ')).toContain('常见份量估算')
    entry.packageSnapshot!.label.energy!.value = 1; expect(food.label.energy!.value).toBe(60)
  })
  it('日常筛选隐藏生肉、生蛋和待烹饪干料，保留水果、生菜、黄瓜和坚果', () => {
    const visible = choices.filter(isEverydayFood)
    for (const name of ['生鸡蛋', '生米', '干燕麦', '苦瓜（生）']) expect(visible.some(choice => choice.id === findFood(name)!.id)).toBe(false)
    for (const name of ['米饭', '鸡蛋', '苦瓜', '黄瓜', '生菜', '苹果', '核桃仁', '葡萄干']) expect(visible.some(choice => choice.id === findFood(name)!.id)).toBe(true)
    expect(searchFoodChoices(visible, '小米粥', '主食').some(choice => choice.origin === 'recipe')).toBe(true)
    expect(searchFoodChoices(visible, '三明治', '轻食早餐').length).toBeGreaterThanOrEqual(3)
    expect(searchFoodChoices(visible, '', '汤羹').length).toBeGreaterThan(0)
  })
  it('索引包含精简食物库和参考配方，分类与多个关键词共同过滤', () => {
    expect(choices).toHaveLength(catalogFoods.length + recipes.length + builtinPackagedFoods.length)
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
