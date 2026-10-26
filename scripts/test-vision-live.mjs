/** 手动真实联调：只使用固定公开样图和程序生成的非食物图，不读取私人照片。
 * 运行 npm run test:vision:live -- --live；可能消耗供应商额度或余额。
 * 不自动重试，不打印 Key、图片 Base64、原始响应或供应商错误正文。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { loadConfig } from '../packages/server/dist/config.js';
import { QwenVisionService } from '../packages/server/dist/vision/qwen.js';
import { GeminiVisionService } from '../packages/server/dist/vision/gemini.js';
import { sanitizeImage } from '../packages/server/dist/image.js';
import { ApiError } from '../packages/server/dist/errors.js';

if (!process.argv.includes('--live')) {
  console.error('真实调用需要明确添加 --live；建议先查看控制台的免费额度及用完即停设置。');
  process.exit(1);
}
const root = new URL('../', import.meta.url);
const sharp = createRequire(new URL('../packages/server/package.json', import.meta.url))('sharp');
loadConfig(); // 只在内存加载根目录 .env，输出中不包含配置值。
const sampleUrl = 'https://storage.googleapis.com/generativeai-downloads/images/scones.jpg';
const samplePath = new URL('.data-cache/public-scones.jpg', root);
let photo;
try { photo = await readFile(samplePath); }
catch {
  const response = await fetch(sampleUrl, { signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`公开样图下载失败：HTTP ${response.status}`);
  photo = Buffer.from(await response.arrayBuffer());
  await mkdir(new URL('.data-cache/', root), { recursive: true });
  await writeFile(samplePath, photo);
}
// 用路径画数字，避免依赖操作系统字体或向用户字体缓存目录写文件。
const nonFood = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512"><rect width="512" height="512" fill="#2869a4"/><path d="M170 145 H345 L225 380" fill="none" stroke="white" stroke-width="45" stroke-linejoin="round"/></svg>')).jpeg().toBuffer();
const samples = [
  { id: 'public-scones', image: await sanitizeImage(photo, 'image/jpeg'), source: sampleUrl, expectedIsFood: true },
  { id: 'non-food-number', image: await sanitizeImage(nonFood, 'image/jpeg'), source: '程序生成：蓝底白色数字7，无食物', expectedIsFood: false },
];
const key = process.env.DASHSCOPE_API_KEY?.trim();
const geminiKey = process.env.GEMINI_API_KEY?.trim();
const candidates = key ? [
  { provider: 'qwen', model: 'qwen3.7-flash', rates: { input: 0.2, output: 0.8 }, make: f => new QwenVisionService(key, 45000, f, 'qwen3.7-flash') },
  { provider: 'qwen', model: 'qwen3.8-flash', rates: { input: 0.8, output: 2.7 }, make: f => new QwenVisionService(key, 45000, f, 'qwen3.8-flash') },
  { provider: 'qwen', model: 'qwen3.7-plus', rates: { input: 2, output: 8 }, make: f => new QwenVisionService(key, 45000, f, 'qwen3.7-plus') },
] : [];
if (geminiKey) candidates.push({ provider: 'gemini', model: 'gemini-3.5-flash-lite', make: f => new GeminiVisionService(geminiKey, 45000, f) });
if (!candidates.length) throw new Error('未配置可测试供应商的服务端密钥。');
const rows = [];
for (const candidate of candidates) {
  for (const sample of samples) {
    const start = Date.now();
    const info = {};
    // 注入 fetch 只观察 HTTP 状态与用量，不改变真实适配器请求和校验。
    const observedFetch = async (...args) => {
      const response = await fetch(...args);
      info.httpStatus = response.status;
      try {
        const data = await response.clone().json();
        if (data.usage) {
          const u = data.usage;
          info.inputTokens = u.prompt_tokens ?? u.total_input_tokens ?? null;
          info.outputTokens = u.completion_tokens ?? u.total_output_tokens ?? null;
          info.cachedInputTokens = u.prompt_tokens_details?.cached_tokens ?? u.total_cached_tokens ?? 0;
        }
        const errorCode = data.error?.code;
        if (typeof errorCode === 'string' && /^[A-Za-z0-9_.-]{1,100}$/.test(errorCode)) info.upstreamCode = errorCode;
      } catch { /* 上游无效 JSON 仍交给真实适配器处理。 */ }
      return response;
    };
    const row = { provider: candidate.provider, model: candidate.model, sample: sample.id };
    try {
      const result = await candidate.make(observedFetch).recognize(sample.image);
      Object.assign(row, info, {
        status: 'ok', elapsedMs: Date.now() - start, structuredValidation: true,
        expectedIsFood: sample.expectedIsFood, isFood: result.isFood,
        isFoodCheckPassed: result.isFood === sample.expectedIsFood,
        foods: result.foods.map(food => ({ name: food.name, estimatedWeightG: food.estimatedWeightG,
          hasRangeProfile: Boolean(food.nutritionEstimateProfile), uncertainties: food.uncertainties })),
      });
    } catch (error) {
      Object.assign(row, info, { status: 'error', elapsedMs: Date.now() - start, code: error?.code ?? 'UNEXPECTED' });
      // 仅输出本项目创建的中文安全消息，不转发未知异常的 message。
      if (error instanceof ApiError) row.message = error.message;
    }
    // HTTP 200 后结构失败也可能计费，不能只统计校验成功的请求。
    if (candidate.rates && Number.isFinite(info.inputTokens) && Number.isFinite(info.outputTokens)) {
      const tier = candidate.model === 'qwen3.7-flash' ? (info.inputTokens > 256000 ? 6 : info.inputTokens > 32000 ? 3 : 1)
        : candidate.model === 'qwen3.7-plus' && info.inputTokens > 256000 ? 3 : 1;
      row.uncachedListPriceEstimateCny = (info.inputTokens * candidate.rates.input + info.outputTokens * candidate.rates.output) * tier / 1000000;
    } else if (row.code === 'AI_TIMEOUT') {
      row.usageNote = '请求超时，供应商是否已消耗 tokens 以及具体用量未知，不能计为零费用。';
    }
    rows.push(row);
    console.log(JSON.stringify(row));
    // 鉴权失败时不继续对同一模型发送第二张图；不轮换 Key 绕过限制。
    if (info.httpStatus === 401 || info.httpStatus === 403) break;
  }
}
const report = {
  testedAt: new Date().toISOString(),
  pricingAsOf: '2026-10-15',
  scope: '固定公开多食物样图与生成的非食物图；每模型最多2次；不自动重试；没有称重真值，不能评定重量或营养准确率。',
  pricingBasis: '北京区普通 API 未命中缓存的挂牌价估算，不代表实际账单或免费额度抵扣后应付金额。',
  sources: samples.map(({ id, source }) => ({ id, source })), rows,
};
await mkdir(new URL('artifacts/vision/', root), { recursive: true });
const reportPath = new URL('artifacts/vision/model-smoke.json', root);
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n');
console.log(`脱敏测试报告：${fileURLToPath(reportPath)}`);
if (rows.some(row => row.status !== 'ok' || !row.isFoodCheckPassed)) process.exitCode = 1;
