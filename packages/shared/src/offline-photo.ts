import { normalizeFoodName } from './schemas.js';

export const offlinePhotoPrompt = '只列照片中能确认的主要食物名称，每行一种，最多6种，每种一次。不写数量、重量、热量、配料或解释。不确定的不要猜；不是食物就只回答“未识别到食物”。';

/** 只接收完整短清单，不从长解释/截断/重复中抢救部分条目，更不提取模型编写的营养值。 */
export function parseOfflinePhotoNames(raw: string): string[] {
  const text = raw.trim();
  if (!text || text.length > 800) throw new Error('本机识图未返回完整的短清单，照片与原草稿已保留。');
  if (/^(?:未识别到食物|未发现食物|不是食物|无法确认食物)[。.!！]?$/.test(text)) return [];
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (lines.length > 6) throw new Error('本机识图清单过长，请换图或在测试页检查，原草稿已保留。');
  const names = lines.map(line => line.replace(/^(?:\d{1,2}[.、．)）]\s*|[-*•]\s*)/, '').trim());
  const seen = new Set<string>();
  for (const name of names) {
    if (!name || name.length > 40 || /[\d{}\[\]`<>:：。！？!?；;、,，]/.test(name)
      || /(?:不确定|无法|看不清|可能|照片|图片|主要食物|食物名称|热量|千卡|卡路里|kcal|克重|蛋白质|脂肪|碳水|建议|如下|数量|重量)/i.test(name)) {
      throw new Error('本机识图没有按名称清单返回，无法可靠转成餐食。照片与原草稿已保留，可重试或手动添加。');
    }
    const key = normalizeFoodName(name);
    if (seen.has(key)) throw new Error('本机识图出现重复食物，未替换原草稿；请重试或手动添加。');
    seen.add(key);
  }
  return names;
}
