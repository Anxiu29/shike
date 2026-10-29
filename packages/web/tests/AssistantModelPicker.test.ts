// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AssistantModelPicker from '../src/components/AssistantModelPicker.vue';
const { ai, configure } = vi.hoisted(() => ({ ai: { getState: vi.fn(), prepareAssistant: vi.fn(), unload: vi.fn(), cancel: vi.fn() }, configure: vi.fn() }));
vi.mock('../src/lib/offline-ai', () => ({ offlineAi: ai, offlineAiSupported: () => true, offlineAssistantEnabled: () => true, offlineAssistantBackend: () => 'gpu', configureOfflineAssistant: configure }));
vi.mock('../src/components/ModelPicker.vue', () => ({ default: { template: '<div />' } }));
let wrapper: ReturnType<typeof mount> | undefined;
beforeEach(() => { vi.clearAllMocks(); ai.getState.mockResolvedValue({ ready: true, loaded: false, busy: false, backend: '' }); ai.prepareAssistant.mockResolvedValue(undefined); ai.unload.mockResolvedValue(undefined); });
afterEach(() => { wrapper?.unmount(); wrapper = undefined; });
it('打开、切后端、切到离线均不加载，只有明确点击准备才调用', async () => {
  wrapper = mount(AssistantModelPicker); await flushPromises();
  expect(ai.getState).not.toHaveBeenCalled(); expect(ai.prepareAssistant).not.toHaveBeenCalled();
  await wrapper.get('[data-testid="assistant-offline-backend"]').setValue('cpu');
  expect(configure).toHaveBeenLastCalledWith(true, 'cpu'); expect(ai.prepareAssistant).not.toHaveBeenCalled();
  await wrapper.get('[data-testid="assistant-ai-route"]').setValue('online'); await flushPromises();
  await wrapper.get('[data-testid="assistant-ai-route"]').setValue('offline'); await flushPromises();
  expect(ai.prepareAssistant).not.toHaveBeenCalled();
  await wrapper.get('[data-testid="assistant-offline-prepare"]').trigger('click'); await flushPromises();
  expect(ai.prepareAssistant).toHaveBeenCalledExactlyOnceWith({ backend: 'cpu' });
  expect(wrapper.get('[data-testid="assistant-offline-ready"]').text()).toContain('已准备');
});
it('手动准备缺模型时只提示，不启动推理', async () => {
  ai.getState.mockResolvedValue({ ready: false, loaded: false, busy: false });
  wrapper = mount(AssistantModelPicker); await wrapper.get('[data-testid="assistant-offline-prepare"]').trigger('click'); await flushPromises();
  expect(wrapper.get('[data-testid="assistant-offline-model-error"]').text()).toContain('下载或导入');
  expect(ai.prepareAssistant).not.toHaveBeenCalled();
});
