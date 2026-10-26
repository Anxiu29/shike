/** 授权诊断：仅调用免费的4.1V，合成测试图和固定公开餐食样图各一次；无自动重试。 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { GlmVisionService } from '../packages/server/dist/vision/glm.js';
import { sanitizeImage } from '../packages/server/dist/image.js';
import { postJson } from '../packages/server/dist/vision/http.js';
import { glmOutputText } from '../packages/shared/dist/index.js';
const require = createRequire(new URL('../packages/server/package.json', import.meta.url));
if (!process.argv.includes('--live')) throw new Error('真实诊断需要显式--live');
const root = new URL('../', import.meta.url), model = 'glm-4.1v-thinking-flash';
require('dotenv').config({ path: fileURLToPath(new URL('.env', root)), quiet: true });
const key = process.env.ZHIPU_API_KEY?.trim();
if (!key) throw new Error('未配置智谱标准API Key；未发起请求');
const sharp = require('sharp'), rows = [];
let observation;
const observedFetch = async (...args) => {
  const response = await fetch(...args); observation.httpStatus = response.status;
  // 仅记录状态、数值用量和白名单业务码；不记录原始正文或请求。
  if (response.ok) {
    try { const data = await response.clone().json(); observation.inputTokens = data.usage?.prompt_tokens; observation.outputTokens = data.usage?.completion_tokens; } catch {}
  }
  return response;
};
for (const sample of (process.argv.includes('--probe-only') ? ['native-probe'] : ['native-probe', 'public-scones'])) {
  observation = { sample, model }; const started = Date.now();
  try {
    if (sample === 'native-probe') {
      const image = await sharp({ create: { width: 64, height: 64, channels: 3, background: '#2869a4' } }).png().toBuffer();
      const body = { model, temperature: 0.2, max_tokens: 1024, messages: [
        { role: 'system', content: 'Inspect the tiny image. Reply only with JSON: {"ok":true}' },
        { role: 'user', content: [{ type: 'text', text: '请观察这张测试图。连接测试：最终答案只输出 {"ok":true}，不要解释，不要添加Markdown。' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${image.toString('base64')}`, detail: 'high' } }] },
      ] };
      const data = await postJson('https://open.bigmodel.cn/api/paas/v4/chat/completions', body, { Authorization: `Bearer ${key}` }, 45000, observedFetch);
      const choice = data?.choices?.[0], content = choice?.message?.content;
      observation.probeShape = { finishStopped: choice?.finish_reason === 'stop', textContent: typeof content === 'string', contentLength: typeof content === 'string' ? content.length : null, startsJson: typeof content === 'string' && content.trim().startsWith('{'), hasThinkTag: typeof content === 'string' && content.includes('<think>'), hasAnswerTag: typeof content === 'string' && content.includes('<answer>'), hasJsonFence: typeof content === 'string' && content.includes('```'), hasOkField: typeof content === 'string' && /"ok"\s*:/.test(content) };
      const text = glmOutputText(data, model).trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
      let parsed; try { parsed = JSON.parse(text); } catch { observation.probeShape.jsonParseFailed = true; throw new Error('PROBE_CONTRACT'); }
      observation.probeShape.okType = typeof parsed?.ok;
      if (parsed.ok !== true) throw new Error('PROBE_CONTRACT');
      observation.validated = true;
    } else {
      const photo = await readFile(new URL('.data-cache/public-scones.jpg', root));
      const result = await new GlmVisionService(key, 45000, observedFetch, model).recognize(await sanitizeImage(photo, 'image/jpeg'));
      observation.validated = true; observation.isFood = result.isFood;
      observation.foods = result.foods.map(food => ({ name: food.name, estimatedWeightG: food.estimatedWeightG, hasRangeProfile: Boolean(food.nutritionEstimateProfile), discardedNutrition: food.uncertainties.some(note => note.includes('已舍弃')) }));
    }
  } catch (error) { observation.validated = false; observation.errorCode = /^[A-Z_]+$/.test(error?.code) ? error.code : 'CONTRACT_OR_NETWORK_FAILURE'; }
  observation.elapsedMs = Date.now() - started; rows.push(observation); console.log(JSON.stringify(observation));
  if (sample === 'native-probe' && !observation.validated) break;
  if ([401,403,429].includes(observation.httpStatus)) break;
}
const report = { testedAt: new Date().toISOString(), scope: '免费4.1V，原生连接探针与单张公开样图；不能代表餐食准确率、重量真值或平均延迟。', source: 'https://storage.googleapis.com/generativeai-downloads/images/scones.jpg', rows };
await mkdir(new URL('artifacts/vision/', root), { recursive: true });
await writeFile(new URL(process.argv.includes('--probe-only') ? 'artifacts/vision/glm41-probe-check.json' : 'artifacts/vision/glm41-contract-check.json', root), JSON.stringify(report, null, 2) + '\n');
if (rows.some(row => !row.validated)) process.exitCode = 1;
