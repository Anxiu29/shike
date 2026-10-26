// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { activatePersonalProfile, aiRoute, getPersonalState, personalHealth, recognizePersonalImage, savePersonalProfile, setAiRoute } from '../src/lib/personal-vision'
import { getHealth, recognizeImage } from '../src/lib/api'
import { personalStateSchema } from '@shike/shared'
import { describePersonalMeal } from '../src/lib/personal-vision'

const { bridge, capacitor } = vi.hoisted(() => ({
  bridge: { getState: vi.fn(), saveProfile: vi.fn(), activate: vi.fn(), recognize: vi.fn(), describeMeal: vi.fn() },
  capacitor: { isNativePlatform: vi.fn(() => true), getPlatform: () => 'android', isPluginAvailable: () => true },
}))
vi.mock('@capacitor/core', () => ({ Capacitor: capacitor, registerPlugin: () => bridge }))
const first = { id: '790650e2-3696-43d1-927a-596f3e69de84', label: '百炼日常', provider: 'qwen', model: 'qwen3.7-flash' }
const second = { id: 'b97d8144-3f4b-4e13-a0fa-92ffd85136eb', label: 'Gemini 备用', provider: 'gemini', model: 'gemini-3.5-flash-lite' }
const initial = { profiles: [first, second], activeId: first.id }
const noFood = { isFood: false, foods: [], uncertainties: ['不是食物'] }
const jpeg = () => new File(['fake-jpeg'], 'meal.jpg', { type: 'image/jpeg' })
beforeEach(() => { vi.stubEnv("VITE_ENABLE_SERVICE_CONNECTION", "true");
  localStorage.clear(); vi.clearAllMocks(); capacitor.isNativePlatform.mockReturnValue(true)
  bridge.getState.mockResolvedValue(initial)
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('不应走网页网络') }))
})
describe('安卓个人多模型直连', () => {
  it('GLM营养格式失败时保留基础食物并提示，单次调用且不保存坏数值', async () => {
    const profile = { ...first, provider: 'glm', model: 'glm-4.6v-flash' }
    bridge.getState.mockResolvedValue({ profiles: [profile], activeId: profile.id })
    const food = { name: '米饭', estimatedWeightG: 150, visibleIngredients: [], uncertainties: [], estimatedNutrientsPer100g: { energyKcal: 130 }, nutritionEstimateProfile: { factor: 'general', options: [] } }
    const content = { isFood: true, foods: [food], uncertainties: [] }
    bridge.recognize.mockResolvedValue({ provider: profile.provider, model: profile.model, data: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] }) })
    const response = await recognizePersonalImage(jpeg())
    expect(response.result.foods[0]).toMatchObject({ name: '米饭', estimatedWeightG: 150, estimatedNutrientsPer100g: null, nutritionEstimateProfile: null })
    expect(response.result.foods[0]!.uncertainties[0]).toContain('已舍弃')
    expect(bridge.recognize.mock.calls[0]![0].prompt).toContain('输出格式复核')
    expect(bridge.recognize).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled(); expect(localStorage.length).toBe(0)
    bridge.recognize.mockResolvedValue({ provider: profile.provider, model: profile.model, data: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ ...content, foods: [{ ...food, estimatedWeightG: '150克' }] }) } }] }) })
    await expect(recognizePersonalImage(jpeg())).rejects.toThrow('重量')
  })
  it('一组Key支持多个同平台模型，编辑留空保留Key，拒绝越界分组', async () => {
    bridge.saveProfile.mockResolvedValue(initial)
    const input = { id: first.id, label: '百炼视觉', provider: 'qwen' as const, model: 'qwen3.7-flash', models: ['qwen3.7-flash', 'qwen3-vl-plus'], apiKey: '' }
    await savePersonalProfile(input)
    expect(bridge.saveProfile).toHaveBeenCalledWith(input)
    expect(bridge.getState).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled(); expect(localStorage.length).toBe(0)
    bridge.saveProfile.mockClear()
    for (const models of [[], ['qwen3-vl-plus'], ['qwen3.7-flash', 'gemini-3.5-flash-lite'], ['qwen3.7-flash', 'qwen3.7-flash']]) await expect(savePersonalProfile({ ...input, models })).rejects.toThrow('选择支持')
    expect(bridge.saveProfile).not.toHaveBeenCalled()
    bridge.activate.mockResolvedValue({ ...initial, profiles: [{ ...first, models: input.models, model: 'qwen3-vl-plus' }, second] })
    await activatePersonalProfile(first.id, 'qwen3-vl-plus')
    expect(bridge.activate).toHaveBeenCalledWith({ id: first.id, model: 'qwen3-vl-plus' })
  })
  it('文字助手复用当前配置且不返回Key，拒绝错配模型与非法草稿', async () => {
    const draft = { date: '2026-10-20', mealType: 'breakfast', foods: [{ name: '肉包', amount: 2, unit: '个' }], message: '请确认保存。' };
    bridge.describeMeal.mockResolvedValue({ provider: first.provider, model: first.model, data: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(draft) } }] }) });
    expect((await describePersonalMeal({ text: '早餐两个肉包', date: '2026-10-20', mealType: 'breakfast' })).draft.foods[0]!.amount).toBe(2);
    expect(bridge.describeMeal.mock.calls[0]![0]).toMatchObject({ id: first.id, request: expect.stringContaining('早餐两个肉包') });
    expect(JSON.stringify(bridge.describeMeal.mock.calls)).not.toContain('apiKey'); expect(fetch).not.toHaveBeenCalled();
    bridge.describeMeal.mockResolvedValue({ provider: 'deepseek', model: 'deepseek-flash', data: '{}' });
    await expect(describePersonalMeal({ text: '同一餐', date: '2026-10-20', mealType: 'breakfast' })).rejects.toThrow('不一致');
  })
  it('停用自建服务时旧service偏好不会阻止安卓直连', () => {
    localStorage.setItem('shike-ai-route-v1', 'service'); vi.stubEnv('VITE_ENABLE_SERVICE_CONNECTION', 'false'); expect(aiRoute()).toBe('direct')
  })
  it('手机直连也读取包装原标签，不把净含量当成实际摄入', async () => {
    const content = { isFood: true, foods: [{ name: '测试牛奶', estimatedWeightG: 250, visibleIngredients: [], uncertainties: [], packageLabel: { basis: '100ml', energy: { value: 250, unit: 'kJ' }, proteinG: 3, fatG: 3, carbsG: 5, servingSize: null, netContent: { amount: 250, unit: 'ml' } } }], uncertainties: [] }
    bridge.recognize.mockResolvedValue({ provider: first.provider, model: first.model, data: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] }) })
    const result = await recognizePersonalImage(jpeg())
    expect(result.result.foods[0]!.packageLabel!.basis).toBe('100ml'); expect(result.result.foods[0]!.estimatedWeightG).toBeNull()
    expect(bridge.recognize.mock.calls[0]![0].prompt).toContain('包装'); expect(fetch).not.toHaveBeenCalled()
  })
  it('安卓默认直连，普通浏览器始终使用后端；连接方式不保存 Key', () => {
    expect(aiRoute()).toBe('direct')
    setAiRoute('service'); expect(aiRoute()).toBe('service')
    setAiRoute('direct'); capacitor.isNativePlatform.mockReturnValue(false); expect(aiRoute()).toBe('service')
    expect(localStorage.getItem('shike-ai-route-v1')).toBe('direct')
  })
  it('启动只读本机元数据，不测试、不发模型网络请求', async () => {
    expect(await getHealth()).toEqual({ status: 'ok', mode: 'live', provider: 'qwen', model: 'qwen3.7-flash' })
    expect(bridge.recognize).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled()
    bridge.getState.mockResolvedValue({ profiles: [], activeId: null })
    await expect(personalHealth()).rejects.toThrow('添加并选用')
  })
  it('多 Key 交给原生层保存，JS 存储中没有 Key；失败不写存储', async () => {
    bridge.saveProfile.mockResolvedValue(initial)
    const input = { label: '百炼日常', provider: 'qwen' as const, model: 'qwen3.7-flash', apiKey: 'example-test-key-only' }
    await savePersonalProfile(input)
    expect(bridge.saveProfile).toHaveBeenCalledWith(input)
    expect(localStorage.length).toBe(0)
    bridge.saveProfile.mockRejectedValue(new Error('API Key 无效'))
    await expect(savePersonalProfile(input)).rejects.toThrow('Key 无效')
    expect(localStorage.length).toBe(0)
    await expect(savePersonalProfile({ ...input, model: 'https://attacker.test' })).rejects.toThrow('选择支持')
    await expect(savePersonalProfile({ ...input, apiKey: 'bad\nkey' })).rejects.toThrow('有效')
  })
  it('切换配置仅选用指定 id，不自动轮换；拒绝含 Key 的桥接元数据', async () => {
    bridge.activate.mockResolvedValue({ ...initial, activeId: second.id })
    expect((await activatePersonalProfile(second.id)).activeId).toBe(second.id)
    expect(bridge.activate).toHaveBeenCalledWith({ id: second.id })
    bridge.getState.mockResolvedValue({ ...initial, profiles: [{ ...first, apiKey: 'must-not-return' }] })
    await expect(getPersonalState()).rejects.toThrow('配置无效')
    expect(personalStateSchema.safeParse({ ...initial, activeId: 'not-a-profile' }).success).toBe(false)
  })
  it('图片通过所选配置原生调用，完整 JSON 和 Zod 校验后返回通用结果', async () => {
    bridge.recognize.mockResolvedValue({ provider: first.provider, model: first.model, data: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(noFood) } }] }) })
    const result = await recognizeImage(jpeg())
    expect(result).toEqual({ mode: 'live', provider: first.provider, model: first.model, result: noFood })
    expect(bridge.recognize).toHaveBeenCalledWith(expect.objectContaining({ id: first.id, model: first.model, imageBase64: expect.any(String) }))
    expect(JSON.stringify(bridge.recognize.mock.calls)).not.toContain('apiKey')
    expect(fetch).not.toHaveBeenCalled()
  })
  it('Gemini 使用独立解析器，非 completed 不接受', async () => {
    bridge.getState.mockResolvedValue({ ...initial, activeId: second.id })
    bridge.recognize.mockResolvedValue({ provider: second.provider, model: second.model, data: JSON.stringify({ status: 'completed', output_text: JSON.stringify(noFood) }) })
    expect((await recognizePersonalImage(jpeg())).provider).toBe('gemini')
    bridge.recognize.mockResolvedValue({ provider: second.provider, model: second.model, data: JSON.stringify({ status: 'failed', output_text: JSON.stringify(noFood) }) })
    await expect(recognizePersonalImage(jpeg())).rejects.toThrow('完整完成')
  })
  it.each([
    ['siliconflow', 'Qwen/Qwen3.5-4B'],
    ['glm', 'glm-4.1v-thinking-flash'],
    ['glm', 'glm-4.6v-flashx'],
    ['glm', 'glm-5.3-flash'],
    ['glm', 'glm-5.3-flashx'],
    ['openrouter', 'nvidia/nemotron-3.5-super-vl:free'],
    ['openrouter', 'dots-studio/dots-3-note-preview:free'],
    ['qwen', 'qwen3-vl-plus'],
    ['deepseek', 'deepseek-flash'],
  ])('新增配置%s / %s保持来源、结构校验与单次调用', async (provider, model) => {
    const profile = { ...first, provider, model }
    bridge.getState.mockResolvedValue({ profiles: [profile], activeId: profile.id })
    expect(await personalHealth()).toMatchObject({ mode: 'live', provider, model })
    const content = { isFood: true, foods: [{ name: '米饭', estimatedWeightG: 150, visibleIngredients: [], uncertainties: [] }], uncertainties: [] }
    bridge.recognize.mockResolvedValue({ provider, model, data: JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(content) } }] }) })
    expect(await recognizePersonalImage(jpeg())).toMatchObject({ mode: 'live', provider, model, result: { foods: [{ name: '米饭', estimatedWeightG: 150 }] } })
    expect(bridge.recognize).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled()
    expect(localStorage.length).toBe(0)
    bridge.recognize.mockRejectedValue(new Error('模型限流429'))
    await expect(recognizePersonalImage(jpeg())).rejects.toThrow('429')
    expect(bridge.recognize).toHaveBeenCalledTimes(2)
  })
  it('拒绝截断、非法结构、错配模型和过大照片，不尝试另一 Key', async () => {
    for (const content of [JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: JSON.stringify(noFood) } }] }), JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{broken' } }] }), JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: '{"isFood":true,"foods":[{"name":"假食物","estimatedWeightG":-1}],"uncertainties":[]}' } }] })]) {
      bridge.recognize.mockResolvedValue({ provider: first.provider, model: first.model, data: content })
      await expect(recognizePersonalImage(jpeg())).rejects.toThrow()
    }
    bridge.recognize.mockResolvedValue({ provider: 'glm', model: 'glm-4.6v-flash', data: '{}' })
    await expect(recognizePersonalImage(jpeg())).rejects.toThrow('不一致')
    bridge.recognize.mockRejectedValue(new Error('模型限流 429'))
    await expect(recognizePersonalImage(jpeg())).rejects.toThrow('429')
    expect(bridge.recognize).toHaveBeenCalledTimes(5)
    await expect(recognizePersonalImage(new File([new Uint8Array(1024 * 1024 + 1)], 'large.jpg', { type: 'image/jpeg' }))).rejects.toThrow('1 MB')
    expect(bridge.recognize).toHaveBeenCalledTimes(5)
  })
})
