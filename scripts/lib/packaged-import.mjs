// 只整理名称检索与分类，不生成营养数值。条码前缀不是产地证明。
export const brandAliases = [
  [/nongfu|农夫山泉/i, '农夫山泉'], [/kang\s*shi\s*fu|master\s*kong|康師傅|康师傅/i, '康师傅'],
  [/uni[- ]?president|統一|统一/i, '统一'], [/yili|伊利/i, '伊利'], [/mengniu|蒙牛/i, '蒙牛'],
  [/wahaha|娃哈哈/i, '娃哈哈'], [/want\s*want|wang\s*wang|旺旺/i, '旺旺'], [/glico|格力高/i, '格力高'],
  [/lay'?s|乐事|樂事/i, '乐事'], [/oreo|奥利奥|奧利奧/i, '奥利奥'], [/nestl[eé]|雀巢/i, '雀巢'],
  [/dove|德芙/i, '德芙'], [/ferrero|费列罗/i, '费列罗'], [/hsu\s*fu\s*chi|徐福记/i, '徐福记'],
  [/we[iy]\s*long|卫龙/i, '卫龙'], [/three\s*squirrels|三只松鼠/i, '三只松鼠'], [/bestore|良品铺子/i, '良品铺子'],
  [/qia\s*qia|cha\s*cheer|洽洽/i, '洽洽'], [/\bpepsi\b|百事/i, '百事'], [/coca[- ]?cola|可口可乐/i, '可口可乐'],
  [/sprite|雪碧/i, '雪碧'], [/fanta|芬达/i, '芬达'], [/red\s*bull|红牛/i, '红牛'], [/ovaltine|阿华田/i, '阿华田'],
  [/vitasoy|维他奶|維他奶/i, '维他奶'], [/nissin|日清/i, '日清'], [/nongshim|农心/i, '农心'],
  [/samyang|三养|三養/i, '三养'], [/lee\s*kum\s*kee|李锦记|李錦記/i, '李锦记'], [/haitian|haday|海天/i, '海天'],
  [/lao\s*gan\s*ma|老干妈/i, '老干妈'], [/ajinomoto|味之素/i, '味之素'], [/kewpie|丘比/i, '丘比'],
  [/orion|好丽友/i, '好丽友'], [/lotte|乐天|樂天/i, '乐天'], [/meiji|明治/i, '明治'], [/yakult|养乐多|益力多/i, '养乐多'],
  [/danone|达能/i, '达能'], [/quaker|桂格/i, '桂格'], [/skippy|四季宝/i, '四季宝'], [/hormel|荷美尔/i, '荷美尔'],
  [/heinz|亨氏/i, '亨氏'], [/ma\s*ling|梅林/i, '梅林'], [/jin\s*mai\s*lang|今麦郎/i, '今麦郎'],
  [/mizone|脉动|脈動/i, '脉动'], [/tsingtao|青岛啤酒/i, '青岛啤酒'], [/genki\s*forest|chi\s*forest|元气森林|元氣森林/i, '元气森林'],
];

const contains = (tags, values) => values.some(value => tags.includes(`en:${value}`));
export function packagedCategory(product, name) {
  const tags = product.categories_tags ?? [], text = name.toLowerCase();
  // 官方具体分类先于名称关键词；“牛奶巧克力”不能因为含“牛奶”归入奶类。
  const explicit = [
    ['零食与坚果', ['chocolates', 'biscuits', 'confectioneries', 'crisps', 'nuts']],
    ['谷物与蛋白粉', ['protein-powders', 'breakfast-cereals', 'cereal-flakes', 'mueslis', 'flours', 'rice']],
    ['奶与植物奶', ['milks', 'plant-milks', 'yogurts', 'dairy-drinks', 'fermented-milks', 'plant-based-milks', 'milk-substitutes']],
    ['面包与糕点', ['breads', 'cakes', 'pastries', 'croissants', 'buns', 'muffins']],
    ['冷冻与罐头', ['frozen-foods', 'canned-foods', 'canned-fishes', 'canned-meals']],
    ['方便食品', ['instant-noodles', 'instant-soups', 'instant-meals', 'dried-noodles', 'noodles']],
    ['调味品', ['sauces', 'spices', 'salts', 'vinegars', 'vegetable-oils', 'honeys']],
    ['肉蛋与即食', ['prepared-meats', 'eggs', 'sausages', 'hams', 'tofu', 'dried-meats']],
    ['饮料', ['beverages']], ['零食与坚果', ['snacks']],
  ].find(([, values]) => contains(tags, values));
  if (explicit) return explicit[0];
  if (/蛋白粉|麦片|燕麦片|面粉|淀粉|大米|whey protein|muesli|porridge oat|\bflour\b|\bstarch\b/.test(text) || contains(tags, ['protein-powders', 'breakfast-cereals', 'cereal-flakes', 'mueslis', 'flours', 'rice', 'cereals'])) return '谷物与蛋白粉';
  if (!/milk chocolate|牛奶巧克力|biscuit|cookie|cake|饼干|蛋糕/.test(text) && /牛奶|酸奶|乳饮|豆奶|豆浆|燕麦奶|椰奶|奶粉|\bmilk\b|\blait\b|yogurt|yoghurt/.test(text)) return '奶与植物奶';
  if (contains(tags, ['beverages']) || /可乐|果汁|汽水|冰红茶|茶饮|苏打水|椰子水|饮用水|运动饮料|汁饮料|咖啡饮料|和其正|健力宝|\bwater\b|\bjuice\b|\bsoda\b|\bcola\b|\bboisson\b|\beau\b/.test(text)) return '饮料';
  if (contains(tags, ['condiments', 'sauces', 'spices', 'salts', 'vinegars', 'vegetable-oils', 'honeys']) || /酱油|辣椒酱|蚝油|醋|十三香|芝麻油|生抽|老抽|豆豉|花生醬|花生酱|蜂蜜|冰糖|白糖|食盐|\bsauce\b|\bvinegar\b|\bhoney\b|\bsalt\b|\bsugar\b|\bsucre\b|\bketchup\b|peanut butter/.test(text)) return '调味品';
  if (contains(tags, ['instant-noodles', 'instant-soups', 'instant-meals', 'dried-noodles', 'noodles']) || /方便面|拌面|泡面|拉面|速食|甜水面|粉丝|\bnoodles?\b|\bnouilles?\b|\bramen\b|\bvermicelli\b|\bsoup\b/.test(text)) return '方便食品';
  if (contains(tags, ['breads', 'cakes', 'pastries', 'croissants', 'buns', 'muffins']) || /面包|吐司|蛋糕|可颂|蛋黄酥|\bbread\b|\bcake\b|\bbrioche\b|croissant|madeleine/.test(text)) return '面包与糕点';
  if (contains(tags, ['frozen-foods', 'canned-foods', 'canned-fishes', 'canned-meals']) || /罐头|冷冻|速冻|\bfrozen\b|\bcanned\b|\btinned\b/.test(text)) return '冷冻与罐头';
  if (contains(tags, ['snacks', 'nuts', 'seeds', 'biscuits', 'chocolates', 'confectioneries', 'crisps']) || /饼干|薯片|巧克力|糖果|坚果|蛋卷|曲奇|威化|米饼|海苔|辣片|果冻|薄荷糖|\bbiscuit|\bchocolate|\bcookie|\bcandy\b|\bcracker|\bcrisps?\b|\bchips\b|\bnuts?\b|\bpeanut|\bpocky\b|\bpretz\b/.test(text)) return '零食与坚果';
  if (contains(tags, ['meats', 'prepared-meats', 'eggs', 'sausages', 'hams', 'tofu', 'dried-meats']) || /火腿|香肠|牛肉干|鸡胸肉|卤蛋|豆干|午餐肉|\bsausage|\bham\b|\btofu\b|\bjerky\b/.test(text)) return '肉蛋与即食';
  return '其他包装';
}

export function importProblem(product, food) {
  if (!food || !food.name || /^(unknown|product|n\/a|无名|未知)$/i.test(food.name)) return '缺少有效名称';
  if (!['100g', '100ml'].includes(food.label.basis)) return '缺少明确质量或体积基准';
  if (!food.label.energy) return '缺少能量';
  const n = product.nutriments ?? {}, kcal = n['energy-kcal_100g'], kj = n['energy-kj_100g'] ?? n.energy_100g;
  if (typeof kcal === 'number' && typeof kj === 'number' && Math.abs(kcal - kj / 4.184) > Math.max(3, kcal * .1)) return 'kcal与kJ冲突';
  const energy = food.label.energy.value / (food.label.energy.unit === 'kJ' ? 4.184 : 1);
  if (energy > 950) return '能量超出保守筛选范围';
  const { proteinG: p, fatG: f, carbsG: c } = food.label;
  if ([p, f, c].some(value => value !== null && value > (food.label.basis === '100g' ? 100 : 150))) return '宏量营养素超出基准范围';
  if ([p, f, c].every(value => value !== null)) {
    if (p + f + c > (food.label.basis === '100g' ? 105 : 150)) return '宏量营养素总量异常';
    // 仅做宽松异常筛选，不能据此纠正标签；酒精、糖醇等可能导致被保守排除。
    if (Math.abs(energy - (4 * p + 9 * f + 4 * c)) > Math.max(25, energy * .35)) return '能量与宏量营养素明显不一致';
  }
  if (typeof n.sugars_100g === 'number' && c !== null && n.sugars_100g > c + 2) return '糖高于碳水且差异明显';
  if (typeof n['saturated-fat_100g'] === 'number' && f !== null && n['saturated-fat_100g'] > f + 2) return '饱和脂肪高于总脂肪';
  if (/瓜子|sunflower seed/i.test(food.name) && !/瓜子仁|去壳|shelled|kernel/i.test(food.name)) return '带壳食物可食部计量不明确';
  return null;
}

export function selectionFor(product, food) {
  const brands = brandAliases.filter(([pattern]) => pattern.test(food.brand)).map(([, name]) => name);
  if (/\bmizone\b/i.test(food.name) && !brands.includes('脉动')) brands.push('脉动');
  const category = packagedCategory(product, food.name);
  const displayName = !/[\u3400-\u9fff]/u.test(food.name) && brands.length ? `${brands[0]} ${food.name}`.slice(0, 200) : food.name;
  return { barcode: food.barcode, category, displayName, aliases: [...new Set([food.name, ...brands, category].filter(Boolean))] };
}
