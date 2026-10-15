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
}
const ingredient = (id: string, fdcId: number, weightG: number, note: string): RecipeIngredient => ({
  id, foodId: `fdc-${fdcId}`, weightG, note,
});
const commonWarnings = [
  '这是参考配比，不是这道菜的测量结果；请按实际食物修改。',
  '配料重量均为最终可食部分。食用油只记录实际摄入量，不能把下锅量全部算作吃掉。',
  '酱汁、糖、额外配料需要另行补充；配方已含的食用油不要重复新增。',
];
// referenceWeightG 等于各最终可食配料重量之和，避免把生料总重直接当熟菜重量。
export const recipes: Recipe[] = [
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
    id: 'tomato-tofu', name: '番茄豆腐', aliases: ['西红柿豆腐'], referenceWeightG: 276,
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
];
