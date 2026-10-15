import { describe, expect, it } from 'vitest'
import { calculateNutrients, createRecipeEntry, recipes } from '@shike/shared'
import { matchedEntry, recognitionEstimate, aggregateEnergyRanges, manualEntry, recalculateRecipe, resizeEntry } from '../src/lib/entries'
import { porridgeProfile } from './range-fixture'
import { localDate, shiftDate } from '../src/lib/dates'
import { MAX_ORIGINAL_BYTES, validateOriginal } from '../src/lib/image'

describe('编辑中的营养与重量', () => {
  it('陌生食物保留缺失，不伪造匹配或零热量', () => {
    const entry = matchedEntry('无法确定的私房混合菜', null)
    expect(entry.kind).toBe('unknown')
    expect(calculateNutrients(entry).energyKcal).toBeNull()
  })
  it('清空再填重量时，配方配料与营养仍保持同比缩放', () => {
    const recipe = recipes[0]!, entry = createRecipeEntry(recipe, recipe.referenceWeightG)
    const initial = calculateNutrients(entry).energyKcal!
    resizeEntry(entry, null)
    resizeEntry(entry, recipe.referenceWeightG / 2)
    expect(entry.recipeSnapshot!.referenceWeightG).toBe(recipe.referenceWeightG / 2)
    const ingredientsEnergy = entry.recipeSnapshot!.ingredients.reduce((sum, ingredient) => sum + (ingredient.nutrientsPer100g.energyKcal ?? 0) * ingredient.weightG / 100, 0)
    expect(calculateNutrients(entry).energyKcal).toBeCloseTo(initial / 2)
    expect(ingredientsEnergy).toBeCloseTo(initial / 2)
  })
  it('油用量调至零后仅去掉该配料热量，不重复累计整菜', () => {
    const recipe = recipes[0]!, entry = createRecipeEntry(recipe, recipe.referenceWeightG)
    const ingredient = entry.recipeSnapshot!.ingredients.find(item => item.name.includes('油'))!
    const removed = ingredient.nutrientsPer100g.energyKcal! * ingredient.weightG / 100
    const initial = calculateNutrients(entry).energyKcal!
    ingredient.weightG = 0; recalculateRecipe(entry)
    expect(calculateNutrients(entry).energyKcal).toBeCloseTo(initial - removed)
  })
  it('不食用的零克配料不传播缺失营养', () => {
    const entry = createRecipeEntry(recipes[0]!, recipes[0]!.referenceWeightG)
    entry.recipeSnapshot!.ingredients[0]!.weightG = 0
    entry.recipeSnapshot!.ingredients[0]!.nutrientsPer100g.energyKcal = null
    recalculateRecipe(entry)
    expect(calculateNutrients(entry).energyKcal).not.toBeNull()
  })
})

describe('AI 粗估与可靠数据优先级', () => {
  const estimate = (name: string, provider: 'gemini' | 'mock' = 'gemini') => recognitionEstimate(name, { energyKcal: 50, proteinG: 1.4, fatG: 0.6, carbsG: 10 }, ['假设清水稀粥、未加糖'], provider, 'test-model')!
  it('基础数据库和参考配方优先于模型候选或个人估算', () => {
    expect(matchedEntry('米饭', 150, [estimate('米饭')], estimate('米饭')).kind).toBe('database')
    expect(matchedEntry('番茄炒蛋', 200, [estimate('番茄炒蛋')], estimate('番茄炒蛋')).kind).toBe('recipe')
  })
  it('未知杂粮粥直接得到标明来源的 AI 热量，无需填写营养', () => {
    const entry = matchedEntry('杂粮粥', 200, [], estimate('杂粮粥'))
    expect(entry.kind).toBe('ai')
    expect(calculateNutrients(entry).energyKcal).toBe(100)
    expect(entry.aiEstimateSnapshot!.assumptions).toContain('假设清水稀粥、未加糖')
  })
  it('确认的同名个人估算优先于本次 AI 候选，仍明确是个人粗估', () => {
    const personal = estimate('杂粮粥'); personal.nutrientsPer100g.energyKcal = 60
    const entry = matchedEntry('杂粮粥', 200, [personal], estimate('杂粮粥'))
    expect(entry.nutrientsPer100g.energyKcal).toBe(60)
    expect(entry.provenance).toContain('个人估算库')
  })
  it('模型不能估计时保留 null，而模拟个人库不得复用成真实依据', () => {
    expect(recognitionEstimate('复杂菜', null, [], 'gemini', 'test')).toBeUndefined()
    expect(recognitionEstimate('复杂菜', { energyKcal: null, proteinG: null, fatG: null, carbsG: null }, [], 'gemini', 'test')).toBeUndefined()
    const missing = matchedEntry('复杂菜', 200)
    expect(calculateNutrients(missing).energyKcal).toBeNull()
    expect(matchedEntry('杂粮粥', 200, [estimate('杂粮粥', 'mock')]).kind).toBe('unknown')
  })
  it('新的有效三档升级旧个人单值，但已有有效三档仍优先', () => {
    const oldScalar = estimate('杂粮粥')
    const current = recognitionEstimate('杂粮粥', null, [], 'gemini', 'range-model', porridgeProfile)!
    const upgraded = matchedEntry('杂粮粥', 300, [oldScalar], current)
    expect(upgraded.estimateProfile).toEqual(porridgeProfile)
    expect(upgraded.estimateLevel).toBe('medium')
    expect(calculateNutrients(upgraded).energyKcal).toBe(225)
    expect(upgraded.aiEstimateSnapshot!.model).toBe('range-model')
    const existingProfile = structuredClone(current); existingProfile.model = 'previous-valid-range'
    expect(matchedEntry('杂粮粥', 300, [existingProfile], current).aiEstimateSnapshot!.model).toBe('previous-valid-range')
  })
  it('个人中档热量缺失时可用本次有效三档，但本次缺失热量不能替换旧单值', () => {
    const missingProfile = structuredClone(porridgeProfile)
    missingProfile.options.find(option => option.level === 'medium')!.rangesPer100g.energyKcal = null
    const partialPersonal = recognitionEstimate('杂粮粥', null, [], 'gemini', 'partial-model', missingProfile)!
    const current = recognitionEstimate('杂粮粥', null, [], 'gemini', 'complete-model', porridgeProfile)!
    expect(calculateNutrients(matchedEntry('杂粮粥', 300, [partialPersonal], current)).energyKcal).toBe(225)
    const oldScalar = estimate('杂粮粥')
    expect(matchedEntry('杂粮粥', 300, [oldScalar], partialPersonal).estimateProfile).toBeUndefined()
    expect(calculateNutrients(matchedEntry('杂粮粥', 300, [oldScalar], partialPersonal)).energyKcal).toBe(150)
  })
})

describe('图片输入边界与本地日期', () => {
  it('拒绝 HEIC、空文件和超限原图', () => {
    expect(() => validateOriginal({ size: 123, type: 'image/heic' })).toThrow('先转换')
    expect(() => validateOriginal({ size: 0, type: 'image/jpeg' })).toThrow('空文件')
    expect(() => validateOriginal({ size: MAX_ORIGINAL_BYTES + 1, type: 'image/jpeg' })).toThrow('20 MB')
    expect(() => validateOriginal({ size: MAX_ORIGINAL_BYTES, type: 'image/png' })).not.toThrow()
  })
  it('日历导航正确处理跨月与闰年，取本地日期', () => {
    expect(shiftDate('2024-03-01', -1)).toBe('2024-02-29')
    expect(shiftDate('2026-12-31', 1)).toBe('2027-01-01')
    expect(localDate(new Date(2026, 9, 14, 0, 5))).toBe('2026-10-14')
  })
})

describe('每日能量区间汇总', () => {
  it('范围、确定数与缺失并存时，仅汇总可计算部分', () => {
    const ai = recognitionEstimate('杂粮粥', null, [], 'gemini', 'test', porridgeProfile)!
    const ranged = matchedEntry('杂粮粥', 300, [], ai)
    const exact = manualEntry('包装食品', 100)
    exact.kind = 'manual'; exact.nutrientsPer100g.energyKcal = 80
    const missing = manualEntry('未知菜', null)
    expect(aggregateEnergyRanges([ranged, exact, missing])).toEqual({ min: 260, max: 350, missing: 1, hasProfile: true })
  })
})
