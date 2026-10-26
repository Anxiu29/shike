import { describe, expect, it } from 'vitest';
import { parseRecognition, validateRecognition } from '../src/vision-parse.js';

const options = { requireProfile: true, discardInvalidNutrition: true };
const food = () => ({ name: '米饭', estimatedWeightG: 150, visibleIngredients: [], uncertainties: ['份量仅为照片估算'],
  estimatedNutrientsPer100g: { energyKcal: 130, proteinG: null, fatG: null, carbsG: null },
  nutritionAssumptions: ['普通白米饭'], nutritionEstimateProfile: { factor: 'general', options: [
    { level: 'low', label: '较湿', rangesPer100g: { energyKcal: { min: 100, max: 120 }, proteinG: null, fatG: null, carbsG: null }, assumptions: ['较高含水量'] },
    { level: 'medium', label: '普通', rangesPer100g: { energyKcal: { min: 120, max: 140 }, proteinG: null, fatG: null, carbsG: null }, assumptions: ['普通含水量'] },
    { level: 'high', label: '较干', rangesPer100g: { energyKcal: { min: 140, max: 160 }, proteinG: null, fatG: null, carbsG: null }, assumptions: ['较低含水量'] },
  ] } });
const response = (foods: unknown[]) => ({ isFood: true, foods, uncertainties: [] });

describe('GLM 不完整营养估算的保守处理', () => {
  it('同一张照片只舍弃错误条目的营养，保留有效名称、重量、警告和其他条目的完整估算', () => {
    const invalid = { ...food(), name: '青菜', nutritionEstimateProfile: { factor: 'oil', options: [] } };
    const raw = response([food(), invalid]); const snapshot = JSON.stringify(raw);
    const parsed = validateRecognition(raw, options);
    expect(parsed.foods[0]!.estimatedNutrientsPer100g!.energyKcal).toBe(130);
    expect(parsed.foods[0]!.nutritionEstimateProfile!.options).toHaveLength(3);
    expect(parsed.foods[1]).toMatchObject({ name: '青菜', estimatedWeightG: 150, estimatedNutrientsPer100g: null, nutritionEstimateProfile: null, nutritionAssumptions: [] });
    expect(parsed.foods[1]!.uncertainties).toEqual(['份量仅为照片估算', expect.stringContaining('已舍弃该项AI营养数值')]);
    expect(JSON.stringify(raw)).toBe(snapshot);
    expect(() => validateRecognition(raw, { requireProfile: true })).toThrow('三档营养范围');
  });
  it.each([
    { nutritionEstimateProfile: null },
    { estimatedNutrientsPer100g: { energyKcal: '130kcal' } },
    { nutritionAssumptions: '普通米饭' },
    { nutritionEstimateProfile: { factor: 'general', options: [{ level: 'medium' }] } },
  ])('错误可选字段不会变成可信营养数值：%j', changes => {
    const parsed = parseRecognition(JSON.stringify(response([{ ...food(), ...changes }])), options);
    expect(parsed.foods[0]!.estimatedNutrientsPer100g).toBeNull();
    expect(parsed.foods[0]!.nutritionEstimateProfile).toBeNull();
    expect(parsed.foods[0]!.uncertainties.at(-1)).toContain('食物库');
  });
  it.each([
    { name: '' }, { estimatedWeightG: -1 }, { estimatedWeightG: '150g' }, { visibleIngredients: null }, { uncertainties: '无' }, { calories: 400 },
  ])('核心字段错误仍拒绝，不能通过舍弃营养绕过：%j', changes => {
    expect(() => validateRecognition(response([{ ...food(), nutritionEstimateProfile: null, ...changes }]), options)).toThrow('结构');
  });
  it('不吞掉包装标签错误或包装与粗估混用，也不把包装变成普通餐食', () => {
    const label = { basis: '100g', energy: { value: 100, unit: 'kcal' }, proteinG: null, fatG: null, carbsG: null, servingSize: null, netContent: null };
    expect(() => validateRecognition(response([{ ...food(), packageLabel: label }]), options)).toThrow('包装标注');
    expect(() => validateRecognition(response([{ ...food(), packageLabel: { ...label, energy: { value: 100, unit: 'unknown' } } }]), options)).toThrow('包装标签');
  });
  it('食物判断、条数、根字段、原有警告及完整JSON边界仍有效', () => {
    const invalid = { ...food(), nutritionEstimateProfile: null };
    expect(() => validateRecognition({ ...response([invalid]), isFood: false }, options)).toThrow('结构');
    expect(() => validateRecognition(response(Array.from({ length: 11 }, () => invalid)), options)).toThrow('10 项');
    expect(() => validateRecognition({ ...response([invalid]), unexpected: true }, options)).toThrow('结构');
    expect(() => validateRecognition(response([{ ...invalid, uncertainties: Array(30).fill('需要保留的警告') }]), options)).toThrow();
    expect(() => parseRecognition(`说明：${JSON.stringify(response([invalid]))}`, options)).toThrow('JSON');
  });
  it('结构错误只报告固定字段名，不回显原始内容', () => {
    try { validateRecognition(response([{ ...food(), estimatedWeightG: 'example-private-response' }]), options); }
    catch (error) { expect((error as Error).message).toContain('第1项食物的重量'); expect((error as Error).message).not.toContain('example-private-response'); return; }
    throw new Error('应拒绝非法重量');
  });
});
