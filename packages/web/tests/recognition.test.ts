import { describe, expect, it } from 'vitest'
import { calculateNutrients, findFood, findRecipe, recognitionResponseSchema, type RecognitionResponse } from '@shike/shared'
import { recognitionEstimate } from '../src/lib/entries'
import { prepareRecognition, recognitionMatchName } from '../src/lib/recognition'

function response(items: Array<{ name: string; weight: number | null; ingredients?: string[] }>): RecognitionResponse {
  return recognitionResponseSchema.parse({ mode: 'live', provider: 'gemini', model: 'test-model', result: { isFood: true, uncertainties: [], foods: items.map(item => ({ name: item.name, estimatedWeightG: item.weight, visibleIngredients: item.ingredients ?? [], uncertainties: [] })) } })
}

describe('多食物识别到逐项记录', () => {
  it('多项分别匹配食物库或配方，各自带入对应重量，不使用统一默认值', () => {
    const result = prepareRecognition(response([{ name: '一小碗白米饭', weight: 165.5 }, { name: '西红柿炒鸡蛋', weight: 240.25, ingredients: ['番茄', '鸡蛋'] }, { name: '一根香蕉', weight: 90 }]))
    expect(result.map(item => item.entry.referenceId)).toEqual([findFood('米饭')!.id, findRecipe('番茄炒蛋')!.id, findFood('香蕉')!.id])
    expect(result.map(item => item.entry.weightG)).toEqual([165.5, 240.25, 90])
    expect(result.map(item => item.estimatedWeightG)).toEqual([165.5, 240.25, 90])
    expect(result[0]!.entry.name).toBe(findFood('米饭')!.name)
    expect(result[0]!.context.name).toBe('一小碗白米饭')
    expect(calculateNutrients(result[0]!.entry).energyKcal).toBeCloseTo(130 * 165.5 / 100)
    expect(new Set(result.map(item => item.entry.id)).size).toBe(3)
  })
  it('配方已匹配但无法估重时保留 null，明确的零份量与未知重量分别处理', () => {
    const result = prepareRecognition(response([{ name: '番茄炒蛋', weight: null }, { name: '米饭', weight: 0 }]))
    expect(result[0]!.entry.kind).toBe('recipe')
    expect(result[0]!.entry.referenceId).toBe(findRecipe('番茄炒蛋')!.id)
    expect(result[0]!.entry.weightG).toBeNull()
    expect(calculateNutrients(result[0]!.entry).energyKcal).toBeNull()
    expect(result[1]!.entry.weightG).toBe(0)
    expect(calculateNutrients(result[1]!.entry).energyKcal).toBe(0)
  })
  it('只简化已知名称的量词，不删除生熟、糖油或酱料等关键区别', () => {
    expect(recognitionMatchName('一份米饭')).toBe('米饭')
    expect(recognitionMatchName('2个鸡蛋')).toBe('鸡蛋')
    for (const name of ['一杯半糖拿铁', '一碗蓝莓酱', '一盘米饭和鸡肉']) expect(recognitionMatchName(name)).toBe(name)
    // 新库有炸制蔬菜时可去量词，但不能把“油炸”也删掉后匹配水煮食物。
    expect(recognitionMatchName('一份油炸西兰花')).toBe('油炸西兰花')
    const fried = prepareRecognition(response([{ name: '一份油炸西兰花', weight: 130 }]))[0]!.entry
    expect(fried.referenceId).toBe(findFood('油炸西兰花')!.id)
    expect(fried.referenceId).not.toBe(findFood('西兰花')!.id)
    expect(fried.weightG).toBe(130)
    expect(findFood('油炸西兰花')!.source.description).toMatch(/fried/i)
    expect(recognitionMatchName('一份生鸡蛋')).toBe('生鸡蛋')
  })
  it('可见配料只作说明，不从同一道菜额外生成记录，无法匹配仍保留缺失', () => {
    const result = prepareRecognition(response([{ name: '自制混合菜', weight: null, ingredients: ['米饭', '鸡胸肉', '西兰花'] }]))
    expect(result).toHaveLength(1)
    expect(result[0]!.entry.kind).toBe('unknown')
    expect(result[0]!.entry.weightG).toBeNull()
    expect(calculateNutrients(result[0]!.entry).energyKcal).toBeNull()
    expect(result[0]!.warnings.some(warning => warning.includes('可见成分'))).toBe(true)
  })
  it('个人库也支持去掉量词匹配，真实记录不会复用模拟个人条目', () => {
    const estimate = recognitionEstimate('我的自制豆浆', { energyKcal: 40, proteinG: 2, fatG: 1, carbsG: 5 }, ['配比未知'], 'gemini', 'previous-model')!
    const input = response([{ name: '一杯我的自制豆浆', weight: 220 }])
    const result = prepareRecognition(input, [estimate])[0]!
    expect(result.entry.referenceId).toBe(estimate.id)
    expect(result.entry.provenance).toContain('个人估算库')
    expect(result.entry.weightG).toBe(220)
    expect(prepareRecognition(input, [{ ...estimate, provider: 'mock' }])[0]!.entry.kind).toBe('unknown')
  })
  it('独立条目的同名食物保留各自重量，编辑草稿不会改写原始模型数据', () => {
    const input = response([{ name: '米饭', weight: 100 }, { name: '米饭', weight: 200 }])
    const result = prepareRecognition(input)
    expect(result.map(item => item.entry.weightG)).toEqual([100, 200])
    result[0]!.entry.weightG = 300
    result[0]!.context.visibleIngredients.push('测试配料')
    expect(input.result.foods[0]!.estimatedWeightG).toBe(100)
    expect(input.result.foods[0]!.visibleIngredients).toEqual([])
    expect(result[1]!.entry.weightG).toBe(200)
  })
})
