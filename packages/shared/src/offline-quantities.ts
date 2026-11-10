import { normalizeFoodName } from './schemas.js';
import type { AssistantDraft, AssistantRequest } from './meal-assistant.js';

type Food = AssistantDraft['foods'][number];
type Quantity = Pick<Food, 'amount' | 'unit'>;
const numberSource = '(?:\\d+(?:\\.\\d+)?|[零〇一二两三四五六七八九十百千万点]+|半)';
const rawQuantitySource = `(${numberSource})\\s*(千克|公斤|kg|毫升|ml|升|克|g|个|根|块|碗|片|勺|杯|份)(半)?`;
const quantitySource = `(?<![\\da-zA-Z.零〇一二两三四五六七八九十百千万点负\\-~～至到/])${rawQuantitySource}`;
const changeSource = '(?:改成|改为|换成|调成|调整成|调整为)';
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const fail = () => new Error('未能核对食物的数量和单位，请写成“鸡蛋2个、米饭1碗”等明确描述，或详细编辑；原草稿已保留。');

function spokenNumber(text: string): number | null {
  if (text === '半') return 0.5;
  if (/^\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const [integer, fraction] = text.split('点');
  if (!integer || text.split('点').length > 2 || (fraction !== undefined && (!fraction || [...fraction].some(char => digits[char] === undefined)))) return null;
  // “一百二”有120/102两种口语解释，只接受完整位数或带零的写法。
  if (/[百千万][一二两三四五六七八九]$/.test(integer)) return null;
  let value = 0, digit = 0, lastScale = Infinity, precedingDigit = false;
  for (const char of integer) {
    if (digits[char] !== undefined) {
      if (precedingDigit && digit !== 0) return null;
      digit = digits[char]; precedingDigit = true; continue;
    }
    const scale = ({ 十: 10, 百: 100, 千: 1000, 万: 10000 } as Record<string, number>)[char];
    if (!scale || scale >= lastScale) return null;
    value += (digit || 1) * scale; digit = 0; lastScale = scale; precedingDigit = false;
  }
  value += digit;
  if (fraction) value += Number(`0.${[...fraction].map(char => digits[char]).join('')}`);
  return value;
}

function quantity(match: RegExpMatchArray): Quantity {
  const value = spokenNumber(match[1]!);
  const source = match[2]!.toLowerCase(), scale = /^(?:千克|公斤|kg|升)$/.test(source) ? 1000 : 1;
  const amount = value === null ? null : Math.round(((value + (match[3] ? 0.5 : 0)) * scale + Number.EPSILON) * 100) / 100;
  if (amount === null || amount <= 0 || amount > 20000) throw fail();
  const unit = /^(?:千克|公斤|kg|克|g)$/.test(source) ? 'g' : /^(?:毫升|ml|升)$/.test(source) ? 'ml' : source as Food['unit'];
  return { amount, unit };
}

/** 只纠正能紧邻食物名称定位的明确数量；绝不用常见克重反推个/碗/杯。 */
function statedQuantity(text: string, name: string): { mentioned: boolean; quantity?: Quantity } {
  const evidence: Quantity[] = [];
  let mentioned = false;
  for (const mention of text.matchAll(new RegExp(escapeRegex(name), 'gi'))) {
    mentioned = true;
    const before = text.slice(0, mention.index), after = text.slice(mention.index! + name.length);
    const prefix = before.match(new RegExp(`${quantitySource}\\s*(?:的\\s*)?$`, 'i'));
    const suffix = after.match(new RegExp(`^\\s*(?:${changeSource}|吃了|喝了|吃掉|喝掉|吃|喝|是|为|=|:|：)?\\s*${quantitySource}`, 'i'));
    // “两个鸡蛋改成一个”和“鸡蛋2个改成1个”以明确改后的值为准。
    const changed = after.match(new RegExp(`^\\s*${changeSource}\\s*${quantitySource}`, 'i'));
    const changedAfter = suffix && after.slice(suffix[0].length).match(new RegExp(`^\\s*${changeSource}\\s*${quantitySource}`, 'i'));
    const corrected = changed ?? changedAfter;
    if (corrected) { evidence.push(quantity(corrected)); continue; }
    if (prefix) evidence.push(quantity(prefix));
    if (suffix) evidence.push(quantity(suffix));
    // 瓶/盒等尚无统一换算依据，不能让模型悄悄改成g或默认一份。
    const unsupported = `${numberSource}\\s*(?:瓶|盒|袋|盘|串|只|支|罐|枚|斤|两)`;
    if (new RegExp(`${unsupported}\\s*(?:的\\s*)?$`, 'i').test(before) || new RegExp(`^\\s*(?:${changeSource})?\\s*${unsupported}`, 'i').test(after)) throw fail();
    // 同一食物后紧跟两个不同计量（例如“一杯250ml”）需核对，不能擅选其一。
    if (suffix && new RegExp(`^\\s*${quantitySource}`, 'i').test(after.slice(suffix[0].length))) throw fail();
    if (!prefix && !suffix) {
      const separators = /[，,、。；;！!\n]|以及|还有|和|及|与/;
      const local = `${before.split(separators).at(-1) ?? ''} ${after.split(separators)[0] ?? ''}`;
      if (new RegExp(rawQuantitySource, 'i').test(local) || /减半|翻倍|加倍/.test(local)) throw fail();
    }
  }
  const unique = [...new Map(evidence.map(item => [JSON.stringify(item), item])).values()];
  if (unique.length > 1) throw fail();
  return { mentioned, quantity: unique[0] };
}

export function reconcileOfflineQuantities(draft: AssistantDraft, input: AssistantRequest): Food[] {
  const sameMeal = input.previous?.date === draft.date && input.previous?.mealType === draft.mealType;
  const contextEdit = /(?:改成|改为|换成)(?:早餐|早饭|午餐|午饭|晚餐|晚饭|加餐|夜宵|宵夜|\d{4}-\d{2}-\d{2})/.test(input.text);
  const keepPrevious = (sameMeal || contextEdit) && !/新(?:的)?一餐|再记一餐|新记录|重新记录/.test(input.text);
  return draft.foods.map(food => {
    const stated = statedQuantity(input.text, food.name);
    const previous = keepPrevious ? input.previous?.foods.filter(item => normalizeFoodName(item.name) === normalizeFoodName(food.name)) ?? [] : [];
    if (stated.quantity) return { ...food, ...stated.quantity };
    if (previous.length === 1) {
      // “再来两个”等省略了食物名，不能把本轮数量误套到所有旧项。
      if (!stated.mentioned && !draft.foods.some(item => input.text.includes(item.name)) && (new RegExp(rawQuantitySource, 'i').test(input.text) || /减半|翻倍|加倍/.test(input.text))) throw fail();
      return { ...food, amount: previous[0]!.amount, unit: previous[0]!.unit };
    }
    if (!stated.mentioned) throw fail();
    // 没说数量就保持未知；后续界面可用带标记的常见份量，不采信模型猜出的g。
    return { ...food, amount: null, unit: '份' };
  });
}
