import { offlinePhotoEnabled, offlinePhotoEstimates } from "./offline-photo-settings";
export { offlinePhotoEnabled, offlinePhotoEstimates, configureOfflinePhoto } from "./offline-photo-settings";
import { offlinePhotoPrompt, parseOfflinePhotoNames, offlineWeightPrompt, offlineLabelPrompt, parseOfflineWeights, parseOfflineLabel, createPackageEntry, type OfflineImageResult, type EstimatedFood } from '@shike/shared'
import { offlineVision, offlineVisionImage, offlineVisionModel, offlineVisionSupported } from './offline-vision'
import type { OfflineAiState } from './offline-ai'
import { matchedEntry } from './entries'
import { recognitionMatchName, type RecognizedFoodDraft } from './recognition'

export function prepareOfflineImage(result: OfflineImageResult, personalFoods: EstimatedFood[] = []): RecognizedFoodDraft[] {
  if (result.kind === 'label') {
    const entry = createPackageEntry(result.name, result.label, 'offline', offlineVisionModel.name)
    entry.warnings = [...entry.warnings, ...result.warnings]
    return [{ entry, context: { name: result.name, visibleIngredients: [] }, estimatedWeightG: null, warnings: result.warnings }]
  }
  return result.foods.map(food => {
    const entry = matchedEntry(recognitionMatchName(food.name, personalFoods), food.estimatedWeightG, personalFoods)
    const warnings = [...result.warnings, food.estimatedWeightG === null ? '这一项未能估重，请填写实际可食重量。' : `本机照片估重约 ${food.estimatedWeightG} g，核对后可修改。`]
    entry.warnings = [...new Set([...entry.warnings, ...warnings])]
    entry.provenance += `；名称与估重：本机 ${offlineVisionModel.name}（试验）。`
    return { entry, context: { name: food.name, visibleIngredients: [] }, estimatedWeightG: food.estimatedWeightG, warnings }
  })
}
type ImageOptions = { signal?: AbortSignal; onProgress?: (message: string) => void }
export async function recognizeOfflineImage(file: File, kind: 'food' | 'label', options: ImageOptions = {}): Promise<OfflineImageResult> {
  if (kind === 'food' && !offlinePhotoEstimates()) return { kind: 'food', foods: (await recognizeOfflinePhoto(file, options)).map(name => ({ name, estimatedWeightG: null })), warnings: ['本机仅识别名称，重量与份量待填写；营养来自所选食物库或配方。'] }
  const task = kind === 'label' ? 'package_label' : 'food_estimate'
  const text = await runImage(file, { task, prompt: kind === 'label' ? offlineLabelPrompt : offlineWeightPrompt }, options)
  return kind === 'label' ? parseOfflineLabel(text) : parseOfflineWeights(text)
}
export function prepareOfflinePhoto(names: string[], personalFoods: EstimatedFood[] = []): RecognizedFoodDraft[] {
  return names.map(name => {
    const entry = matchedEntry(recognitionMatchName(name, personalFoods), null, personalFoods)
    const warnings = ['名称由本机识图生成，请核对；未估重量，请按实际份量填写。']
    entry.warnings = [...new Set([...entry.warnings, ...warnings])]
    entry.provenance += `；名称识别：本机 ${offlineVisionModel.name}。`
    return { entry, context: { name, visibleIngredients: [] }, estimatedWeightG: null, warnings }
  })
}
export function offlinePhotoStage(state: OfflineAiState) {
  return ({ loading: '正在加载本机识图模型…', generating: '正在手机本地识图…', completed: '识图生成结束，正在核对清单…' } as Record<string, string>)[state.stage] ?? '正在等待本机模型…'
}
let running = false
export async function recognizeOfflinePhoto(file: File, options: { signal?: AbortSignal; onProgress?: (message: string) => void } = {}): Promise<string[]> {
  return parseOfflinePhotoNames(await runImage(file, { prompt: offlinePhotoPrompt, namesOnly: true }, options))
}
async function runImage(file: File, input: { prompt: string; namesOnly?: boolean; task?: 'food_estimate' | 'package_label' }, options: ImageOptions): Promise<string> {
  if (!offlineVisionSupported()) throw new Error('当前设备不支持本机离线识图。')
  if (running) throw new Error('已有本机识图任务，请等待完成。')
  running = true
  let started = false, cancelled = false, finished = false
  const abortError = () => new Error('本机识图已停止，照片与原草稿保留。')
  const abort = () => { cancelled = true; if (started) void offlineVision.cancel().catch(() => {}) }
  options.signal?.addEventListener('abort', abort, { once: true })
  try {
    if (options.signal?.aborted) throw abortError()
    const state = await offlineVision.getState()
    if (state.busy) throw new Error('本机模型正在操作，请等待完成或到设置停止。')
    if (!state.ready) throw new Error('请先到设置 → 离线识图下载或导入视觉模型；已有完整模型无需重下。')
    options.onProgress?.('正在手机上处理照片…')
    const image = await offlineVisionImage(file)
    if (cancelled || options.signal?.aborted) throw abortError()
    await offlineVision.generateImage({ imageBase64: image.base64, ...input })
    started = true
    if (cancelled || options.signal?.aborted) { abort(); throw abortError() }
    const deadline = Date.now() + 180_000
    while (true) {
      if (cancelled || options.signal?.aborted) throw abortError()
      const current = await offlineVision.getState()
      if (cancelled || options.signal?.aborted) throw abortError()
      options.onProgress?.(offlinePhotoStage(current))
      if (!current.busy) {
        finished = true
        if (current.stage !== 'completed' || current.stopReason) throw new Error(current.error || '本机识图未完整结束，原草稿已保留。请重试或到设置检查。')
        return current.text
      }
      if (Date.now() > deadline) { abort(); throw new Error('本机识图等待超时，已请求停止；照片与原草稿保留。') }
      await new Promise(resolve => setTimeout(resolve, 350))
    }
  } finally {
    options.signal?.removeEventListener('abort', abort)
    if (started && !finished && !cancelled) void offlineVision.cancel().catch(() => {})
    running = false
  }
}
