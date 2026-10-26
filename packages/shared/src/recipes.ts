export interface RecipeIngredient {
  id: string;
  foodId: string;
  weightG: number;
  note: string;
}
export interface Recipe {
  id: string;
  name: string;
  aliases: string[];
  referenceWeightG: number;
  ingredients: RecipeIngredient[];
  warnings: string[];
  category?: '家常菜' | '主食' | '汤羹' | '饮品' | '轻食早餐';
}
const ingredient = (id: string, foodId: number | string, weightG: number, note: string): RecipeIngredient => ({
  id, foodId: typeof foodId === 'number' ? `fdc-${foodId}` : foodId, weightG, note,
});
const commonWarnings = [
  '这是参考配比，不是这道菜的测量结果；请按实际食物修改。',
  '配料重量均为最终可食部分。食用油只记录实际摄入量，不能把下锅量全部算作吃掉。',
  '酱汁、糖、额外配料需要另行补充；配方已含的食用油不要重复新增。',
];
/** 新配方只定义可编辑的配比，营养仍由引用的 USDA 食物逐项计算。 */
function referenceRecipe(id: string, name: string, aliases: string[], parts: Array<[string, number | string, number]>, warnings: string[] = [], category: Recipe['category'] = '家常菜'): Recipe {
  return { id, name, aliases, category, referenceWeightG: parts.reduce((sum, part) => sum + part[2], 0),
    ingredients: parts.map(([key, fdcId, weight]) => ingredient(key, fdcId, weight, key === 'water' ? '额外加入并实际喝下的水；不包含未计算的肉汤、糖或酱汁。' : key === 'oil' ? '参考实际摄入的食用油，不是下锅油量。' : '最终可食重量；采用条目注明的生熟／即食状态，不是生料投料重量。')),
    warnings: [...commonWarnings, ...warnings] };
}
/** 包子按成品皮馅熟重建模；馒头近似蒸熟面皮，绝不把生面粉重量当成品重量。 */
function bunRecipe(id: string, name: string, aliases: string[], parts: Array<[string, number | string, number, string]>): Recipe {
  return {
    id, name, aliases, category: '主食', referenceWeightG: parts.reduce((sum, part) => sum + part[2], 0),
    ingredients: parts.map(([key, foodId, weightG, note]) => ingredient(key, foodId, weightG, note)),
    warnings: [...commonWarnings,
      '包子参考配方：用TFDA白馒头近似蒸熟面皮，配合已熟馅料；不是包子店实测值。',
      '皮馅比例、肥瘦、糖油和含水量差异较大；请填写整份实际可食重量，再按实际调整配料。',
      '面皮和馅料已一并计入；不要再把整只包子或同一馅料重复新增。'],
  };
}
const bunSkin = (weight: number): [string, string, number, string] => ['skin', 'tfda-R2400201', weight, '蒸熟面皮参考重量：以TFDA白馒头近似，不是干面粉投料量。'];
const bunOil: [string, number, number, string] = ['oil', 171411, 5, '馅料额外实际吃下的油；肉本身脂肪已计入，不是下锅总油量。'];
// referenceWeightG 等于各最终可食配料重量之和，避免把生料总重直接当熟菜重量。
export const recipes: Recipe[] = [
  bunRecipe('vegetable-bao', '菜包', ['菜包子', '青菜包', '青菜包子', '白菜包', '素菜包'], [bunSkin(65), ['cabbage', 169980, 30, '水煮大白菜熟重近似菜馅；不同蔬菜与挤水量需要调整。'], bunOil]),
  bunRecipe('mushroom-vegetable-bao', '香菇青菜包', ['香菇菜包', '香菇素菜包'], [bunSkin(60), ['cabbage', 169980, 25, '熟大白菜近似青菜馅。'], ['mushroom', 168437, 10, '已煮熟香菇重量，不是干香菇。'], bunOil]),
  bunRecipe('pork-bao', '鲜肉包', ['肉包', '肉包子', '猪肉包', '鲜肉包子', '猪肉包子'], [bunSkin(65), ['pork', 167903, 30, 'USDA熟猪绞肉近似蒸肉馅；肥瘦及蒸煮失水与样本可能不同。'], ['onion', 170001, 5, '熟洋葱近似配菜；未包含额外油、糖或酱汁。']]),
  bunRecipe('cabbage-pork-bao', '菜肉包', ['白菜猪肉包', '白菜肉包', '猪肉白菜包'], [bunSkin(60), ['pork', 167903, 20, '熟猪肉末参考，需核对肥瘦。'], ['cabbage', 169980, 15, '熟大白菜可食重量。'], bunOil]),
  bunRecipe('mushroom-pork-bao', '香菇肉包', ['香菇猪肉包'], [bunSkin(60), ['pork', 167903, 25, '熟猪肉末参考，需核对肥瘦。'], ['mushroom', 168437, 10, '熟香菇重量。'], bunOil]),
  bunRecipe('beef-bao', '牛肉包', ['牛肉包子', '鲜牛肉包'], [bunSkin(65), ['beef', 171203, 30, '熟牛肉近似牛肉馅，核对部位及肥瘦。'], ['onion', 170001, 5, '熟洋葱重量；额外糖油酱料另补。']]),
  bunRecipe('chicken-bao', '鸡肉包', ['鸡肉包子'], [bunSkin(60), ['chicken', 171477, 30, '去皮熟鸡胸肉近似熟鸡肉馅。'], ['onion', 170001, 5, '熟洋葱重量。'], bunOil]),
  bunRecipe('char-siu-bao', '叉烧包', ['叉烧包子'], [bunSkin(65), ['pork', 'tfda-R5100101', 30, 'TFDA叉烧肉参考，已含样本糖油，不再重复加入同一调味。'], ['water', 2710707, 5, '馅汁中保留的水；额外酱汁另补。']]),
  bunRecipe('red-bean-bao', '豆沙包', ['红豆包', '红豆沙包', '豆沙包子'], [bunSkin(65), ['beans', 173728, 20, '煮熟红豆近似豆沙基础；并非干豆重量。'], ['sugar', 169655, 10, '假设额外10g白砂糖，甜度不确定，可按实际修改。'], bunOil]),
  bunRecipe('sesame-bao', '芝麻包', ['黑芝麻包', '芝麻包子'], [bunSkin(65), ['sesame', 170150, 15, '芝麻籽近似磨碎芝麻馅，不含另加的猪油。'], ['sugar', 169655, 10, '参考白砂糖重量，可按实际修改。'], ['water', 2710707, 10, '馅料中保留的水；另加油脂需补充。']]),
  {
    id: 'tomato-egg', name: '番茄炒蛋', aliases: ['西红柿炒鸡蛋', '番茄炒鸡蛋', '西红柿炒蛋'], referenceWeightG: 258,
    ingredients: [
      ingredient('tomato', 170050, 150, '熟番茄可食重量；使用 USDA 熟番茄数据。'),
      ingredient('egg', 173424, 100, '使用不含额外油的水煮全蛋作为熟蛋近似；不等同于炒蛋实测值。'),
      ingredient('oil', 171411, 8, '假设这份菜实际摄入 8 g 大豆油，可改成实际估计。'),
    ],
    warnings: [...commonWarnings, '熟蛋用水煮蛋数据近似炒蛋；不同烹饪失水量会改变每 100 g 数值。'],
  },
  {
    id: 'egg-fried-rice', name: '蛋炒饭', aliases: ['鸡蛋炒饭'], referenceWeightG: 310,
    ingredients: [
      ingredient('rice', 168878, 200, '熟白米饭重量，不能填干大米重量。'),
      ingredient('egg', 173424, 50, '使用水煮全蛋近似无额外油的熟蛋。'),
      ingredient('carrot', 170394, 25, '水煮胡萝卜熟重，作为未额外加油配料的近似。'),
      ingredient('peas', 170420, 25, '水煮青豌豆熟重。'),
      ingredient('oil', 171411, 10, '假设这份炒饭实际摄入 10 g 油。'),
    ],
    warnings: [...commonWarnings, '未包含火腿、肉类等额外配料；加料炒饭需补充。'],
  },
  {
    id: 'stir-fried-broccoli', name: '清炒西兰花', aliases: ['炒西兰花'], referenceWeightG: 208,
    ingredients: [
      ingredient('broccoli', 169967, 200, '水煮西兰花熟重，作为无额外油的熟菜近似。'),
      ingredient('oil', 171411, 8, '假设这份菜实际摄入 8 g 油。'),
    ],
    warnings: [...commonWarnings, '蒜蓉、蚝油等不包含在此参考配方中。'],
  },
  {
    id: 'pepper-pork', name: '青椒肉丝', aliases: ['青椒炒肉丝'], referenceWeightG: 208,
    ingredients: [
      ingredient('pepper', 170428, 100, '水煮青甜椒熟重，作为无额外油的熟菜近似。'),
      ingredient('pork', 168250, 100, '瘦猪里脊烤熟重量；不同部位及肥瘦比例差异明显。'),
      ingredient('oil', 171411, 8, '假设这份菜实际摄入 8 g 油。'),
    ],
    warnings: [...commonWarnings, '淀粉勾芡、糖和酱汁未计入；猪肉肥瘦比例需要确认。'],
  },
  {
    id: 'potato-beef', name: '土豆炖牛肉', aliases: ['牛肉炖土豆'], referenceWeightG: 258,
    ingredients: [
      ingredient('potato', 170440, 150, '去皮水煮土豆的最终可食重量。'),
      ingredient('beef', 171203, 100, 'USDA 炖肩胛牛肉，含可分离脂肪；不是生牛肉重量。'),
      ingredient('oil', 171411, 8, '假设这份菜实际摄入 8 g 额外食用油；牛肉本身脂肪已含在牛肉数据中。'),
    ],
    warnings: [...commonWarnings, '汤汁中的油、糖和额外食材未含在内；有汤汁时应称固体可食部分或另行补充。'],
  },
  {
    id: 'chicken-salad', name: '鸡胸肉沙拉', aliases: ['鸡肉沙拉'], referenceWeightG: 255,
    ingredients: [
      ingredient('chicken', 171477, 100, '去皮烤熟鸡胸肉重量。'),
      ingredient('lettuce', 169249, 60, '生菜即食生重，无烹饪失水。'),
      ingredient('cucumber', 168409, 50, '带皮生黄瓜即食重量。'),
      ingredient('tomato', 170457, 40, '生番茄即食重量。'),
      ingredient('oil', 171413, 5, '假设实际吃掉 5 g 橄榄油；其他沙拉酱需要另行输入。'),
    ],
    warnings: [...commonWarnings, '蔬菜为即食生重，鸡胸肉为熟重；未包含蛋黄酱、甜沙拉酱和坚果。'],
  },
  {
    id: 'kung-pao-chicken', name: '宫保鸡丁', aliases: ['宫保鸡'], referenceWeightG: 175,
    ingredients: [
      ingredient('chicken', 171477, 90, '去皮烤熟鸡胸肉，作为无额外油的熟鸡丁近似。'),
      ingredient('peanut', 173806, 25, '无盐干烤花生。'),
      ingredient('pepper', 170428, 40, '水煮青甜椒熟重。'),
      ingredient('sugar', 169655, 8, '假设这份菜实际吃掉 8 g 白砂糖；可改成 0。'),
      ingredient('oil', 171411, 12, '假设这份菜实际摄入 12 g 大豆油。'),
    ],
    warnings: [...commonWarnings, '醋、淀粉、干辣椒和花椒未计入；花生与糖请按实际改。'],
  },
  {
    id: 'yu-xiang-eggplant', name: '鱼香茄子', aliases: ['鱼香茄子煲'], referenceWeightG: 238,
    ingredients: [
      ingredient('eggplant', 169229, 180, '水煮茄子熟重，作为无额外油的熟茄子近似。'),
      ingredient('pork', 167903, 40, '熟猪肉末；肥瘦以 USDA 绞肉熟重为参考。'),
      ingredient('sugar', 169655, 6, '假设这份菜实际吃掉 6 g 白砂糖。'),
      ingredient('oil', 171411, 12, '假设这份菜实际摄入 12 g 大豆油。茄子很吸油，请按实际改。'),
    ],
    warnings: [...commonWarnings, '豆瓣酱、醋和淀粉未计入。茄子吸油差异很大。'],
  },
  {
    id: 'pepper-potato', name: '青椒土豆丝', aliases: ['炒土豆丝', '酸辣土豆丝'], referenceWeightG: 218,
    ingredients: [
      ingredient('potato', 170440, 150, '去皮水煮土豆的最终可食重量。'),
      ingredient('pepper', 170428, 60, '水煮青甜椒熟重。'),
      ingredient('oil', 171411, 8, '假设这份菜实际摄入 8 g 大豆油。'),
    ],
    warnings: [...commonWarnings, '醋和辣椒未计入；酸辣口味需另行补充。'],
  },
  {
    id: 'stir-fried-spinach', name: '清炒菠菜', aliases: ['炒菠菜'], referenceWeightG: 206,
    ingredients: [
      ingredient('spinach', 168463, 200, '水煮菠菜熟重，作为无额外油的熟菜近似。'),
      ingredient('oil', 171411, 6, '假设这份菜实际摄入 6 g 大豆油。'),
    ],
    warnings: [...commonWarnings, '蒜未计入。'],
  },
  {
    id: 'shrimp-egg', name: '虾仁炒蛋', aliases: ['滑蛋虾仁'], referenceWeightG: 188,
    ingredients: [
      ingredient('shrimp', 175180, 80, '熟虾仁重量。'),
      ingredient('egg', 173424, 100, '使用水煮全蛋近似无额外油的熟蛋。'),
      ingredient('oil', 171411, 8, '假设这份菜实际摄入 8 g 大豆油。'),
    ],
    warnings: [...commonWarnings, '熟蛋用水煮蛋数据近似。'],
  },
  {
    id: 'onion-egg', name: '洋葱炒蛋', aliases: ['洋葱炒鸡蛋'], referenceWeightG: 188,
    ingredients: [
      ingredient('onion', 170001, 80, '水煮洋葱熟重。'),
      ingredient('egg', 173424, 100, '使用水煮全蛋近似无额外油的熟蛋。'),
      ingredient('oil', 171411, 8, '假设这份菜实际摄入 8 g 大豆油。'),
    ],
    warnings: [...commonWarnings, '熟蛋用水煮蛋数据近似。'],
  },
  {
    id: 'broccoli-shrimp', name: '西兰花炒虾仁', aliases: ['虾仁西兰花'], referenceWeightG: 238,
    ingredients: [
      ingredient('broccoli', 169967, 150, '水煮西兰花熟重。'),
      ingredient('shrimp', 175180, 80, '熟虾仁重量。'),
      ingredient('oil', 171411, 8, '假设这份菜实际摄入 8 g 大豆油。'),
    ],
    warnings: [...commonWarnings],
  },
  {
    id: 'cabbage-tofu', name: '白菜炖豆腐', aliases: ['白菜豆腐'], referenceWeightG: 276,
    ingredients: [
      ingredient('cabbage', 169980, 150, '水煮大白菜熟重。'),
      ingredient('tofu', 172476, 120, '普通豆腐可食重量。'),
      ingredient('oil', 171411, 6, '假设这份菜实际摄入 6 g 大豆油。'),
    ],
    warnings: [...commonWarnings, '汤汁未单列；请按可食部分重量记录，不要把汤算进固体。'],
  },
  {
    id: 'celery-pork', name: '芹菜炒肉丝', aliases: ['芹菜肉丝'], referenceWeightG: 188,
    ingredients: [
      ingredient('celery', 169989, 100, '水煮芹菜熟重。'),
      ingredient('pork', 168250, 80, '瘦猪里脊烤熟重量。'),
      ingredient('oil', 171411, 8, '假设这份菜实际摄入 8 g 大豆油。'),
    ],
    warnings: [...commonWarnings, '猪肉肥瘦比例需要确认。'],
  },
  {
    id: 'mushroom-greens', name: '香菇炒小白菜', aliases: ['香菇青菜'], referenceWeightG: 206,
    ingredients: [
      ingredient('mushroom', 168437, 60, '无盐煮熟香菇。'),
      ingredient('greens', 170391, 140, '水煮小白菜熟重。'),
      ingredient('oil', 171411, 6, '假设这份菜实际摄入 6 g 大豆油。'),
    ],
    warnings: [...commonWarnings, '干香菇泡发后的重量才能使用这条熟香菇数据。'],
  },
  {
    id: 'mapo-tofu', name: '麻婆豆腐', aliases: ['麻辣豆腐'], referenceWeightG: 262,
    ingredients: [
      ingredient('tofu', 172476, 200, '普通豆腐可食重量。'),
      ingredient('pork', 167903, 50, '熟猪肉末。'),
      ingredient('oil', 171411, 12, '假设这份菜实际摄入 12 g 大豆油。'),
    ],
    warnings: [...commonWarnings, '豆瓣酱、花椒和淀粉未计入。'],
  },
  {
    id: 'tomato-noodle', name: '番茄鸡蛋面', aliases: ['西红柿鸡蛋面'], referenceWeightG: 336,
    ingredients: [
      ingredient('noodle', 168926, 200, '无盐熟鸡蛋面，不能填干面条重量。'),
      ingredient('tomato', 170050, 80, '熟番茄可食重量。'),
      ingredient('egg', 173424, 50, '使用水煮全蛋近似无额外油的熟蛋。'),
      ingredient('oil', 171411, 6, '假设这份面实际摄入 6 g 大豆油。'),
    ],
    warnings: [...commonWarnings, '面汤是否喝掉会明显改变份量；请只记录吃下的部分。'],
  },
  {
    id: 'beef-broccoli', name: '西兰花炒牛肉', aliases: ['牛肉炒西兰花'], referenceWeightG: 238,
    ingredients: [
      ingredient('beef', 171203, 80, '炖肩胛牛肉，含可分离脂肪。'),
      ingredient('broccoli', 169967, 150, '水煮西兰花熟重。'),
      ingredient('oil', 171411, 8, '假设这份菜实际摄入 8 g 额外食用油。'),
    ],
    warnings: [...commonWarnings, '牛肉本身脂肪已含在牛肉数据中，不要把肥油再算一次。'],
  },
  {
    id: 'snow-pea', name: '清炒荷兰豆', aliases: ['炒荷兰豆'], referenceWeightG: 186,
    ingredients: [
      ingredient('pea', 170011, 180, '水煮荷兰豆熟重。'),
      ingredient('oil', 171411, 6, '假设这份菜实际摄入 6 g 大豆油。'),
    ],
    warnings: [...commonWarnings, '蒜未计入。'],
  },
  {
    id: 'bitter-melon-egg', name: '苦瓜炒蛋', aliases: ['苦瓜炒鸡蛋'], referenceWeightG: 238,
    ingredients: [
      ingredient('melon', 168394, 150, '水煮苦瓜熟重。'),
      ingredient('egg', 173424, 80, '使用水煮全蛋近似无额外油的熟蛋。'),
      ingredient('oil', 171411, 8, '假设这份菜实际摄入 8 g 大豆油。'),
    ],
    warnings: [...commonWarnings, '熟蛋用水煮蛋数据近似。'],
  },
  {
    id: 'green-bean-pork', name: '四季豆炒肉末', aliases: ['四季豆炒肉'], referenceWeightG: 198,
    ingredients: [
      ingredient('bean', 169141, 150, '水煮四季豆熟重。'),
      ingredient('pork', 167903, 40, '熟猪肉末。'),
      ingredient('oil', 171411, 8, '假设这份菜实际摄入 8 g 大豆油。'),
    ],
    warnings: [...commonWarnings, '干煸做法的失水和用油都更高，这条只适合普通炒豆角。'],
  },
  {
    id: 'tomato-tofu', name: '番茄豆腐', aliases: ['西红柿豆腐', '番茄炒豆腐', '西红柿炒豆腐'], referenceWeightG: 276,
    ingredients: [
      ingredient('tomato', 170050, 120, '熟番茄可食重量。'),
      ingredient('tofu', 172476, 150, '普通豆腐可食重量。'),
      ingredient('oil', 171411, 6, '假设这份菜实际摄入 6 g 大豆油。'),
    ],
    warnings: [...commonWarnings, '糖和汤汁未计入。'],
  },
  {
    id: 'chicken-mushroom', name: '香菇炒鸡胸', aliases: ['香菇鸡丁'], referenceWeightG: 188,
    ingredients: [
      ingredient('chicken', 171477, 100, '去皮烤熟鸡胸肉。'),
      ingredient('mushroom', 168437, 80, '无盐煮熟香菇。'),
      ingredient('oil', 171411, 8, '假设这份菜实际摄入 8 g 大豆油。'),
    ],
    warnings: [...commonWarnings, '干香菇请按泡发后的熟重填写。'],
  },
  {
    id: 'corn-egg', name: '玉米炒蛋', aliases: ['玉米炒鸡蛋'], referenceWeightG: 188,
    ingredients: [
      ingredient('corn', 169999, 100, '无盐水煮甜玉米粒熟重。'),
      ingredient('egg', 173424, 80, '使用水煮全蛋近似无额外油的熟蛋。'),
      ingredient('oil', 171411, 8, '假设这份菜实际摄入 8 g 大豆油。'),
    ],
    warnings: [...commonWarnings, '罐头玉米若加糖，不能直接用这条。'],
  },
  {
    id: 'stir-fried-cauliflower', name: '清炒花菜', aliases: ['炒花菜', '清炒菜花'], referenceWeightG: 206,
    ingredients: [
      ingredient('cauliflower', 170397, 200, '水煮花菜熟重。'),
      ingredient('oil', 171411, 6, '假设这份菜实际摄入 6 g 大豆油。'),
    ],
    warnings: [...commonWarnings, '蒜和干辣椒未计入。'],
  },
  {
    id: 'carrot-pork', name: '胡萝卜炒肉丝', aliases: ['胡萝卜肉丝'], referenceWeightG: 168,
    ingredients: [
      ingredient('carrot', 170394, 80, '水煮胡萝卜熟重。'),
      ingredient('pork', 168250, 80, '瘦猪里脊烤熟重量。'),
      ingredient('oil', 171411, 8, '假设这份菜实际摄入 8 g 大豆油。'),
    ],
    warnings: [...commonWarnings, '猪肉肥瘦比例需要确认。'],
  },
  {
    id: 'salmon-salad', name: '三文鱼沙拉', aliases: ['三文鱼蔬菜沙拉'], referenceWeightG: 195,
    ingredients: [
      ingredient('salmon', 175168, 100, '养殖大西洋三文鱼烤熟重量。'),
      ingredient('lettuce', 169249, 50, '生菜即食生重。'),
      ingredient('cucumber', 168409, 40, '带皮生黄瓜即食重量。'),
      ingredient('oil', 171413, 5, '假设实际吃掉 5 g 橄榄油；其他沙拉酱需要另行输入。'),
    ],
    warnings: [...commonWarnings, '蔬菜为即食生重，三文鱼为熟重；生鱼片不能使用这条烤熟数据。'],
  },
  referenceRecipe('zucchini-egg', '西葫芦炒蛋', ['西葫芦炒鸡蛋'], [['zucchini', 169292, 150], ['egg', 173424, 100], ['oil', 171411, 8]], ['水煮全蛋近似无额外油的熟蛋，炒制失水差异需确认。']),
  referenceRecipe('cucumber-egg', '黄瓜炒蛋', ['黄瓜炒鸡蛋'], [['cucumber', 168409, 130], ['egg', 173424, 100], ['oil', 171411, 8]], ['黄瓜暂用生食数据近似轻炒；请确认失水量。熟蛋采用水煮全蛋近似。']),
  referenceRecipe('cabbage-egg', '卷心菜炒蛋', ['包菜炒蛋'], [['cabbage', 169976, 150], ['egg', 173424, 100], ['oil', 171411, 8]], ['水煮全蛋近似无额外油的熟蛋。']),
  referenceRecipe('stir-fried-bok-choy', '清炒小白菜', ['炒小白菜'], [['bok-choy', 170391, 200], ['oil', 171411, 7]], ['蒜、蚝油等未计入。']),
  referenceRecipe('stir-fried-gai-lan', '清炒芥兰', ['炒芥兰'], [['gai-lan', 169392, 200], ['oil', 171411, 7]], ['蒜、蚝油和糖未计入。']),
  referenceRecipe('stir-fried-cabbage', '手撕包菜', ['清炒包菜', '炒卷心菜'], [['cabbage', 169976, 200], ['oil', 171411, 8]], ['辣椒、糖和酱汁未计入。']),
  referenceRecipe('stir-fried-asparagus', '清炒芦笋', ['炒芦笋'], [['asparagus', 168390, 180], ['oil', 171411, 6]], ['采用无额外油的水煮芦笋近似。']),
  referenceRecipe('stir-fried-zucchini', '清炒西葫芦', ['炒西葫芦'], [['zucchini', 169292, 200], ['oil', 171411, 7]], ['采用无额外油的水煮西葫芦近似。']),
  referenceRecipe('mushroom-chicken-stew', '香菇炖鸡', ['香菇炖鸡肉'], [['chicken', 172388, 120], ['shiitake', 168437, 100], ['oil', 171411, 6]], ['去皮烤鸡腿近似炖熟鸡肉，不包含鸡皮和肉汤；调味糖另计。']),
  referenceRecipe('winter-melon-shrimp', '冬瓜炒虾仁', ['虾仁炒冬瓜'], [['winter-melon', 170475, 160], ['shrimp', 175180, 80], ['oil', 171411, 6]]),
  referenceRecipe('zucchini-pork', '西葫芦炒肉片', ['西葫芦炒肉'], [['zucchini', 169292, 140], ['pork', 168250, 80], ['oil', 171411, 8]], ['采用熟瘦猪里脊参考，肥肉及勾芡另计。']),
  referenceRecipe('potato-chicken', '土豆鸡丁', ['土豆炒鸡丁'], [['potato', 170440, 120], ['chicken', 171477, 100], ['pepper', 170428, 40], ['oil', 171411, 8]], ['鸡胸肉为熟重，酱料与勾芡另计。']),
  referenceRecipe('pepper-beef', '青椒炒牛肉', ['青椒牛肉'], [['pepper', 170428, 120], ['beef', 168634, 100], ['oil', 171411, 8]], ['烤熟瘦牛肉近似炒熟牛肉，勾芡和酱汁另计。']),
  referenceRecipe('onion-beef', '洋葱炒牛肉', ['洋葱牛肉'], [['onion', 170001, 120], ['beef', 168634, 100], ['oil', 171411, 8]], ['烤熟瘦牛肉近似炒熟牛肉，勾芡和酱汁另计。']),
  referenceRecipe('radish-beef-stew', '萝卜炖牛肉', ['白萝卜炖牛肉'], [['radish', 168452, 150], ['beef', 171203, 100], ['oil', 171411, 6]], ['采用炖牛肉含可分离脂肪的数据；此份按固体可食部分，不包含肉汤。']),
  referenceRecipe('cabbage-pork-stew', '白菜炖肉', ['白菜炖猪肉'], [['cabbage', 169980, 160], ['pork', 167846, 100], ['oil', 171411, 6]], ['采用熟瘦猪肩肉近似；肉汤、粉条和肥肉另计。']),
  referenceRecipe('tomato-egg-soup', '番茄鸡蛋汤', ['西红柿鸡蛋汤', '番茄蛋花汤'], [['tomato', 170050, 100], ['egg', 173424, 50], ['water', 173647, 200], ['oil', 171411, 3]], ['熟蛋采用水煮全蛋近似；水代表实际喝下的清水，不含浓汤、糖或勾芡。'], '汤羹'),
  referenceRecipe('winter-melon-tofu-soup', '冬瓜豆腐汤', [], [['winter-melon', 170475, 120], ['tofu', 172476, 80], ['water', 173647, 200], ['oil', 171411, 3]], ['不包含肉汤、虾皮等额外配料，豆腐数据按普通硫酸钙凝固豆腐参考。'], '汤羹'),
  referenceRecipe('lotus-pork-soup', '莲藕排骨汤', ['排骨莲藕汤'], [['lotus', 168430, 120], ['pork', 167854, 80], ['water', 173647, 200]], ['排骨采用炖熟可食肉重，不含骨重；清水不能反映肉汤溶出脂肪，喝汤时应补充实际油量。'], '汤羹'),
  referenceRecipe('millet-porridge-unsweetened', '小米粥（无糖参考）', ['小米粥', '无糖小米粥'], [['millet', 168871, 100], ['water', 173647, 200]], ['已煮熟小米饭与额外水按 1:2 混合，不是干小米与水的投料比例；无额外糖，稀稠请按实际调整。'], '主食'),
  referenceRecipe('rice-porridge-unsweetened', '白米粥（无糖参考）', ['白米粥', '白粥', '无糖白米粥'], [['rice', 168878, 100], ['water', 173647, 200]], ['已煮熟白米饭与额外水按 1:2 混合，不是干米配水；无额外糖，实际含水量可能不同。'], '主食'),
  referenceRecipe('pumpkin-millet-porridge', '南瓜小米粥（无糖参考）', ['南瓜小米粥'], [['millet', 168871, 80], ['pumpkin', 168449, 80], ['water', 173647, 140]], ['小米和南瓜均为熟重，不是干小米；没有添加糖，实际含水量请调整。'], '主食'),
  referenceRecipe('red-bean-millet-porridge', '红豆小米粥（无糖参考）', ['红豆小米粥'], [['millet', 168871, 70], ['red-bean', 173728, 70], ['water', 173647, 160]], ['红豆和小米均为熟重；没有添加糖，不代表所有红豆粥的通用配方。'], '主食'),
  referenceRecipe('milk-oatmeal', '牛奶燕麦粥（无糖参考）', ['牛奶燕麦粥'], [['oatmeal', 173905, 150], ['milk', 172217, 150]], ['燕麦采用已经水煮的燕麦粥，不能填干燕麦片重量；无额外糖，全脂牛奶可改包装数值。'], '轻食早餐'),
  referenceRecipe('egg-sandwich', '鸡蛋三明治', ['全麦鸡蛋三明治'], [['bread', 172688, 60], ['egg', 173424, 50], ['lettuce', 169249, 20], ['cucumber', 168409, 20]], ['全麦面包、水煮蛋及即食蔬菜；未计蛋黄酱、黄油或其他酱。'], '轻食早餐'),
  referenceRecipe('chicken-sandwich', '鸡胸肉三明治', ['鸡肉三明治'], [['bread', 172688, 60], ['chicken', 171477, 70], ['lettuce', 169249, 20], ['tomato', 170457, 30]], ['去皮熟鸡胸配即食蔬菜，不包含沙拉酱与黄油。'], '轻食早餐'),
  referenceRecipe('tuna-sandwich', '金枪鱼三明治', [], [['bread', 172688, 60], ['tuna', 171986, 60], ['lettuce', 169249, 20], ['cucumber', 168409, 20]], ['采用无盐水浸金枪鱼，不包含油浸罐头的油和蛋黄酱。'], '轻食早餐'),
  referenceRecipe('yogurt-fruit-bowl', '酸奶水果碗', ['水果酸奶碗'], [['yogurt', 171284, 150], ['banana', 173944, 60], ['blueberry', 171711, 30]], ['原味全脂酸奶搭配水果，未计蜂蜜、麦片或坚果；具体品牌酸奶需核对包装。'], '轻食早餐'),
  referenceRecipe('latte-unsweetened', '拿铁（无糖参考）', ['无糖拿铁', '拿铁咖啡'], [['coffee', 171890, 30], ['milk', 172217, 170]], ['黑咖啡近似咖啡基底；无额外糖、糖浆与奶油，按 g 而非杯数计算。'], '饮品'),
  referenceRecipe('shrimp-fried-rice', '虾仁炒饭', [], [['rice', 168878, 180], ['shrimp', 175180, 70], ['egg', 173424, 50], ['peas', 170420, 30], ['oil', 171411, 10]], ['配料均为熟重，熟蛋用水煮蛋近似；未计额外酱料。'], '主食'),
  referenceRecipe('chicken-vegetable-rice', '鸡肉蔬菜饭', ['鸡胸肉蔬菜饭'], [['rice', 168878, 180], ['chicken', 171477, 100], ['broccoli', 169967, 80], ['carrot', 170394, 40], ['oil', 171411, 8]], ['食材均按熟重，不含甜酱汁。'], '主食'),
  referenceRecipe('beef-vegetable-rice', '牛肉蔬菜盖饭', ['牛肉蔬菜饭'], [['rice', 168878, 180], ['beef', 168634, 100], ['onion', 170001, 60], ['broccoli', 169967, 50], ['oil', 171411, 8]], ['采用烤熟瘦牛肉近似炒熟牛肉；不含勾芡、甜酱汁和额外糖。'], '主食'),
  // 中式日常菜按已熟配料组合；这里是可调整的配比假设，不是数据库实测整道菜。
  referenceRecipe('pepper-egg', '青椒炒鸡蛋', ['青椒炒蛋'], [['pepper', 170428, 120], ['egg', 173424, 100], ['oil', 171411, 8]], ['熟鸡蛋用水煮蛋近似炒蛋；具体失水和酱料请核对。']),
  referenceRecipe('carrot-egg', '胡萝卜炒鸡蛋', ['胡萝卜炒蛋'], [['carrot', 170394, 150], ['egg', 173424, 100], ['oil', 171411, 8]], ['水煮胡萝卜及水煮蛋近似无额外油的熟食。']),
  referenceRecipe('onion-pork', '洋葱炒肉片', ['洋葱炒猪肉'], [['onion', 170001, 130], ['pork', 168250, 90], ['oil', 171411, 8]], ['以熟瘦猪里脊近似炒肉；肥肉、糖及勾芡另计。']),
  referenceRecipe('broccoli-tofu', '西兰花炒豆腐', [], [['broccoli', 169967, 150], ['tofu', 172476, 150], ['oil', 171411, 7]], ['采用水煮西兰花及普通豆腐近似无额外油熟食；非油炸豆腐，酱料另补。']),
  referenceRecipe('mushroom-tofu', '香菇烧豆腐', ['香菇炖豆腐'], [['shiitake', 168437, 80], ['tofu', 172476, 160], ['oil', 171411, 8]], ['香菇为熟重；蚝油、糖、淀粉勾芡另计。']),
  referenceRecipe('pepper-tofu', '青椒炒豆腐', [], [['pepper', 170428, 100], ['tofu', 172476, 150], ['oil', 171411, 8]], ['非油炸豆腐；如使用油豆腐请另选相符原料，避免重复计算油。']),
  referenceRecipe('tomato-beef', '番茄炒牛肉', ['西红柿炒牛肉'], [['tomato', 170050, 140], ['beef', 168634, 100], ['oil', 171411, 8]], ['烤熟瘦牛肉近似炒熟牛肉；糖、酱汁和勾芡另计。']),
  referenceRecipe('tomato-beef-stew', '番茄炖牛肉', ['西红柿炖牛肉'], [['tomato', 170050, 140], ['beef', 171203, 110], ['onion', 170001, 40], ['oil', 171411, 5]], ['采用炖熟牛肩肉，不包括汤汁；不同部位及肥瘦要确认。']),
  referenceRecipe('broccoli-chicken', '西兰花炒鸡丁', ['西兰花炒鸡肉'], [['broccoli', 169967, 150], ['chicken', 171477, 100], ['oil', 171411, 7]], ['去皮熟鸡胸肉参考，甜酱汁与勾芡另计。']),
  referenceRecipe('carrot-beef', '胡萝卜炒牛肉', ['牛肉炒胡萝卜'], [['carrot', 170394, 150], ['beef', 168634, 100], ['oil', 171411, 8]], ['烤熟瘦牛肉近似炒牛肉，糖、酱汁和勾芡另计。']),
  referenceRecipe('bok-choy-shrimp', '小白菜炒虾仁', ['虾仁炒小白菜'], [['bok-choy', 170391, 150], ['shrimp', 175180, 80], ['oil', 171411, 7]], ['采用已煮熟的小白菜和虾仁，调味酱另计。']),
  referenceRecipe('potato-pork', '土豆炒肉片', ['土豆炒猪肉'], [['potato', 170440, 140], ['pork', 168250, 90], ['oil', 171411, 8]], ['熟瘦猪里脊和水煮土豆近似炒菜；肥肉及额外酱汁另计。']),
  referenceRecipe('tofu-shrimp-soup', '豆腐虾仁汤', ['虾仁豆腐汤'], [['tofu', 172476, 100], ['shrimp', 175180, 60], ['water', 173647, 200], ['oil', 171411, 3]], ['水代表实际喝下的清水，不含浓缩高汤和勾芡。'], '汤羹'),
  referenceRecipe('tofu-egg-soup', '豆腐鸡蛋汤', ['豆腐蛋花汤'], [['tofu', 172476, 100], ['egg', 173424, 50], ['water', 173647, 200], ['oil', 171411, 3]], ['熟蛋以水煮蛋近似；肉汤或勾芡另计。'], '汤羹'),
  referenceRecipe('winter-melon-shrimp-soup', '冬瓜虾仁汤', ['虾仁冬瓜汤'], [['winter-melon', 170475, 150], ['shrimp', 175180, 70], ['water', 173647, 200], ['oil', 171411, 3]], ['不含虾皮、高汤或勾芡；清水只表示实际喝下的水量。'], '汤羹'),
  referenceRecipe('chicken-mushroom-porridge', '香菇鸡肉粥', ['香菇鸡丝粥'], [['rice', 168878, 100], ['chicken', 171477, 40], ['shiitake', 168437, 30], ['water', 173647, 180]], ['米饭、鸡肉、香菇均为熟重；无额外糖油，稀稠请按实际调整。'], '主食'),
  referenceRecipe('century-egg-pork-porridge', '皮蛋瘦肉粥', [], [['rice', 168878, 100], ['pork', 168250, 45], ['century-egg', 'tfda-K01131', 30], ['water', 173647, 180]], ['瘦里脊熟重近似肉丝；皮蛋采用TFDA平均样本。米为熟饭，不是干米投料；肉汤、香油或额外淀粉另计。'], '主食'),
  referenceRecipe('corn-chicken-rice', '玉米鸡肉饭', ['玉米鸡丁饭'], [['rice', 168878, 180], ['chicken', 171477, 90], ['corn', 169999, 60], ['oil', 171411, 7]], ['均为熟重；玉米粒不含芯，甜酱与黄油另计。'], '主食'),
  referenceRecipe('mushroom-chicken-rice', '香菇鸡肉盖饭', ['香菇鸡丁饭'], [['rice', 168878, 180], ['chicken', 171477, 90], ['shiitake', 168437, 60], ['oil', 171411, 8]], ['熟鸡胸肉近似鸡丁，含皮鸡腿肉不能直接套用；糖与勾芡另计。'], '主食'),
  referenceRecipe('tomato-egg-rice', '番茄鸡蛋盖饭', ['西红柿鸡蛋盖饭', '番茄炒蛋盖饭'], [['rice', 168878, 180], ['tomato', 170050, 100], ['egg', 173424, 70], ['oil', 171411, 8]], ['米饭和番茄炒蛋已一起计入，不要另加同一份米饭或整道炒蛋；不含额外糖。'], '主食'),
];
