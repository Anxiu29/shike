// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
const bridge = vi.hoisted(() => ({ getState: vi.fn(), generateImage: vi.fn(), cancel: vi.fn() }));
const support = vi.hoisted(() => ({ value: true }));
vi.mock('../src/lib/offline-vision', () => ({ offlineVision: bridge, offlineVisionSupported: () => support.value, offlineVisionImage: vi.fn(async () => ({ base64: '/9j/AA==', preview: '' })), offlineVisionModel: { name: 'Qwen3.5-0.8B · INT8 视觉版' } }));
import { configureOfflinePhoto, offlinePhotoEnabled, offlinePhotoEstimates, prepareOfflinePhoto, recognizeOfflinePhoto, recognizeOfflineImage, prepareOfflineImage } from '../src/lib/offline-photo';
import { parseOfflineWeights, parseOfflineLabel } from '@shike/shared';
import { recognizeImage } from '../src/lib/api';
const ready = { ready: true, busy: false, stage: 'ready', stopReason: '', error: '' };
const file = new File(['jpeg'], 'meal.jpg', { type: 'image/jpeg' });
beforeEach(() => {
  vi.clearAllMocks(); support.value = true; localStorage.clear(); vi.stubGlobal('fetch', vi.fn());
  bridge.getState.mockReset().mockResolvedValue(ready); bridge.generateImage.mockResolvedValue(undefined); bridge.cancel.mockResolvedValue(undefined);
});
it('只识别名称；匹配数据库后重量仍未知，不自动补常见份量或AI营养', () => {
  const drafts = prepareOfflinePhoto(['米饭', '西兰花', '陌生的火星菜']);
  expect(drafts).toHaveLength(3);
  for (const { entry, estimatedWeightG, candidate } of drafts) { expect(entry.weightG).toBeNull(); expect(estimatedWeightG).toBeNull(); expect(entry.portionSnapshot).toBeUndefined(); expect(candidate).toBeUndefined(); }
  expect(drafts[2]!.entry.kind).toBe('unknown'); expect(drafts[2]!.entry.nutrientsPer100g.energyKcal).toBeNull();
});
it('发送512处理结果与仅名称要求，读取完成状态后解析，无网络调用', async () => {
  bridge.getState.mockResolvedValueOnce(ready).mockResolvedValue({ ...ready, stage: 'completed', text: '1. 米饭\n2. 鸡蛋' });
  expect(await recognizeOfflinePhoto(file)).toEqual(['米饭', '鸡蛋']);
  expect(bridge.generateImage).toHaveBeenCalledWith(expect.objectContaining({ imageBase64: '/9j/AA==', namesOnly: true })); expect(fetch).not.toHaveBeenCalled();
});
it('缺少模型或已有任务在图像调用前拒绝', async () => {
  for (const state of [{ ...ready, ready: false }, { ...ready, busy: true }]) { bridge.getState.mockResolvedValue(state); await expect(recognizeOfflinePhoto(file)).rejects.toThrow(); }
  expect(bridge.generateImage).not.toHaveBeenCalled(); expect(bridge.cancel).not.toHaveBeenCalled();
});
it('异常截停、错误和不完整回答不转成可用名称或上云', async () => {
  for (const result of [{ stage: 'limited', stopReason: 'repetition', error: '检测到循环重复' }, { stage: 'error', error: '运行失败' }, { stage: 'completed', text: '米饭\n米饭' }]) {
    bridge.getState.mockReset().mockResolvedValueOnce(ready).mockResolvedValue({ ...ready, ...result });
    await expect(recognizeOfflinePhoto(file)).rejects.toThrow();
  }
  expect(fetch).not.toHaveBeenCalled();
});
it('启动前取消不碰其他任务，已启动的取消只请求本机停止', async () => {
  const early = new AbortController(); early.abort();
  await expect(recognizeOfflinePhoto(file, { signal: early.signal })).rejects.toThrow('停止'); expect(bridge.cancel).not.toHaveBeenCalled();
  const active = new AbortController(); bridge.generateImage.mockImplementationOnce(async () => { active.abort(); });
  await expect(recognizeOfflinePhoto(file, { signal: active.signal })).rejects.toThrow('停止'); expect(bridge.cancel).toHaveBeenCalledTimes(1);
});
it('本机照片选择持久保存，拦住任何误入在线图片入口的调用', async () => {
  configureOfflinePhoto(true); expect(offlinePhotoEnabled()).toBe(true);
  await expect(recognizeImage(file)).rejects.toThrow('未上传'); expect(fetch).not.toHaveBeenCalled();
  support.value = false; expect(offlinePhotoEnabled()).toBe(false); expect(() => configureOfflinePhoto(true)).toThrow('安卓');
});
it('启动后的桥接读取失败会请求停止，不遗留无人管理的生成', async () => {
  bridge.getState.mockResolvedValueOnce(ready).mockRejectedValueOnce(new Error('桥接读取失败'));
  await expect(recognizeOfflinePhoto(file)).rejects.toThrow('桥接读取失败');
  expect(bridge.cancel).toHaveBeenCalledTimes(1); expect(fetch).not.toHaveBeenCalled();
});
it('默认试估重，发送固定任务，保留未知和数据库营养来源', async () => {
  const text = '{"foods":[{"name":"米饭","estimatedWeightG":150},{"name":"火星独有菜","estimatedWeightG":null}]}';
  bridge.getState.mockResolvedValueOnce(ready).mockResolvedValue({ ...ready, stage: 'completed', text });
  const result = await recognizeOfflineImage(file, 'food'); expect(result).toEqual(parseOfflineWeights(text));
  expect(bridge.generateImage).toHaveBeenCalledWith(expect.objectContaining({ task: 'food_estimate' }));
  const drafts = prepareOfflineImage(result); expect(drafts[0]!.entry.weightG).toBe(150); expect(drafts[0]!.entry.kind).toBe('database');
  expect(drafts[1]!.entry.weightG).toBeNull(); expect(drafts[1]!.entry.nutrientsPer100g.energyKcal).toBeNull();
  expect(drafts[0]!.entry.warnings.join()).toContain('不是称重'); expect(fetch).not.toHaveBeenCalled();
});
it('仅名称设置跨启用切换保留，不补重量；标签任务独立于此设置', async () => {
  configureOfflinePhoto(true, false); configureOfflinePhoto(false); configureOfflinePhoto(true); expect(offlinePhotoEstimates()).toBe(false);
  bridge.getState.mockResolvedValueOnce(ready).mockResolvedValue({ ...ready, stage: 'completed', text: '米饭' });
  const result = await recognizeOfflineImage(file, 'food'); expect(result.kind).toBe('food');
  expect(bridge.generateImage).toHaveBeenLastCalledWith(expect.objectContaining({ namesOnly: true }));
  expect(prepareOfflineImage(result)[0]!.entry.weightG).toBeNull();
  const text = JSON.stringify({ name: '牛奶', basis: '100ml', energyValue: 280, energyUnit: 'kJ', proteinG: 3.5, fatG: 0, carbsG: null, servingAmount: null, servingUnit: null, netAmount: 250, netUnit: 'ml', evidence: '每100毫升' });
  bridge.getState.mockReset().mockResolvedValueOnce(ready).mockResolvedValue({ ...ready, stage: 'completed', text });
  const label = await recognizeOfflineImage(file, 'label'); expect(label).toEqual(parseOfflineLabel(text));
  expect(bridge.generateImage).toHaveBeenLastCalledWith(expect.objectContaining({ task: 'package_label' }));
  const entry = prepareOfflineImage(label)[0]!.entry;
  expect(entry.packageSnapshot!.provider).toBe('offline'); expect(entry.packageSnapshot!.consumedAmount).toBeNull(); expect(entry.portionSnapshot).toBeUndefined();
  expect(entry.packageSnapshot!.label.fatG).toBe(0); expect(fetch).not.toHaveBeenCalled();
});
