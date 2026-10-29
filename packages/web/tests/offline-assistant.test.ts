// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
const { local, cloud, capacitor } = vi.hoisted(() => ({ local: { getState: vi.fn(), describeMeal: vi.fn() }, cloud: { getState: vi.fn(), describeMeal: vi.fn() }, capacitor: { isNativePlatform: vi.fn(() => true), getPlatform: () => 'android', isPluginAvailable: () => true } }));
vi.mock('@capacitor/core', () => ({ Capacitor: capacitor, registerPlugin: (name: string) => name === 'OfflineAi' ? local : cloud }));
import { configureOfflineAssistant } from '../src/lib/offline-ai';
import { describeMeal } from '../src/lib/api';
const request = { text: '午餐吃了两个鸡蛋', date: '2026-10-27', mealType: 'lunch' as const };
const draft = { intent: 'update', date: request.date, mealType: 'lunch', foods: [{ name: '鸡蛋', amount: 2, unit: '个' }], message: '草稿' };
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); capacitor.isNativePlatform.mockReturnValue(true); vi.stubGlobal('fetch', vi.fn(() => { throw new Error('离线不能联网'); })); configureOfflineAssistant(true, 'gpu'); local.getState.mockResolvedValue({ loaded: true, backend: 'gpu', busy: false }); local.describeMeal.mockResolvedValue({ model: 'Qwen2.5-1.5B-Q8', backend: 'gpu', text: JSON.stringify(draft) }); });
it('未准备、已释放或后端不同均要求手动准备，不触发推理或云端回退', async () => {
  for (const state of [{ loaded: false, backend: '', busy: false }, { loaded: false, backend: 'gpu', busy: false }, { loaded: true, backend: 'cpu', busy: false }]) {
    local.getState.mockResolvedValue(state);
    await expect(describeMeal(request)).rejects.toThrow('准备模型');
  }
  expect(local.describeMeal).not.toHaveBeenCalled(); expect(cloud.describeMeal).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it('只走本机桥，携带受约束JSON，响应可进入共享草稿契约', async () => {
  expect(await describeMeal(request)).toMatchObject({ provider: 'offline', mode: 'live', draft: { foods: draft.foods } });
  expect(local.describeMeal.mock.calls[0]![0]).toMatchObject({ backend: 'gpu', schema: { additionalProperties: false, properties: { date: { const: request.date } } } });
  expect(cloud.getState).not.toHaveBeenCalled(); expect(cloud.describeMeal).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it('模型失败/取消时不自动调用云端或改路由', async () => {
  local.describeMeal.mockRejectedValue(new Error('本机已停止'));
  await expect(describeMeal(request)).rejects.toThrow('停止');
  expect(cloud.getState).not.toHaveBeenCalled(); expect(cloud.describeMeal).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  expect(localStorage.getItem('shike-offline-assistant-v1')).toContain('"enabled":true');
});
it('错误或不完整输出不转成默认食物', async () => {
  for (const text of ['午餐吃了两个鸡蛋。', '{"intent":"update"', JSON.stringify({ ...draft, foods: [{ name: '鸡蛋', amount: -1, unit: '个' }] })]) {
    local.describeMeal.mockResolvedValue({ model: 'Qwen2.5-1.5B-Q8', backend: 'gpu', text });
    await expect(describeMeal(request)).rejects.toThrow();
  }
  expect(cloud.describeMeal).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it('照片或历史图片在调用本机/云端前拒绝', async () => {
  await expect(describeMeal({ ...request, imageBase64: '/9j/AA==' })).rejects.toThrow('只支持文字');
  await expect(describeMeal({ ...request, history: [{ role: 'user', text: '', imageBase64: '/9j/AA==' }] })).rejects.toThrow('只支持文字');
  expect(local.describeMeal).not.toHaveBeenCalled(); expect(cloud.describeMeal).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it('订单模式即使只有文字也明确拒绝，不自动发送到云端或本机模型', async () => {
  await expect(describeMeal({ ...request, inputKind: 'order', text: '肉包（2个装）×3' })).rejects.toThrow('订单识别需要在线模型');
  expect(local.describeMeal).not.toHaveBeenCalled(); expect(cloud.describeMeal).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
});
it('后端/型号不符时拒绝，不能误贴当前模型标签', async () => {
  for (const response of [{ model: 'other', backend: 'gpu' }, { model: 'Qwen2.5-1.5B-Q8', backend: 'cpu' }]) {
    local.describeMeal.mockResolvedValue({ ...response, text: JSON.stringify(draft) });
    await expect(describeMeal(request)).rejects.toThrow('不符');
  }
});
it('网页无法误启用手机本机路由', () => {
  capacitor.isNativePlatform.mockReturnValue(false);
  expect(() => configureOfflineAssistant(true)).toThrow('新版安卓');
});
