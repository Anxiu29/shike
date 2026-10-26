import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Converter } from 'opencc-js';

// 仅在开发时运行。公开原始数据与选取规则一起留档，构建和手机运行不联网。
// 首次：node scripts/import-chinese-foods.mjs --source .data-cache/tfda/official/20_5.json
// 重现：node scripts/import-chinese-foods.mjs
const simplify = Converter({ from: 'tw', to: 'cn' });
const root = new URL('../packages/shared/', import.meta.url);
const url = 'https://data.fda.gov.tw/data/opendata/export/20/json';
const sourcePath = new URL('data/tfda-chinese-source.json', root);
const selection = {
  主食: `R2400201 R2400301 R2400401 R2400601 R2301101 R2301301 R2700401 R2700101 R3000101 R2800101 R2800301 R2800401 R2800501 R0300201 R0300101 R0300301 R0400101 R0400201 R0500401 R2100101 R2100401 R2201301 R2201401 R2201501 R2500101`,
  熟食菜肴: `R0700201 R3000301 R3000401 R3000501 R5900101`,
  汤羹: `R0100101`,
  蛋与豆制品: `R4700202 R4700301 R4700701 R4700801 R4700901 R4701101 R4701201 R4701301 R4700201 R4700203 R4900101 R4900201 R4900701`,
  肉类: `R5100101 R5101001 R5101101 R7300101 R7300501 R7300301 R7300401 R5900301`,
  水产: `R6900101 R6900201 R7500201`,
  坚果种子: `R7100101 R7100301 R7100401 R7100601 R7100701 R7101001 R7101201 R7101301 R7101401 R7101501 R7101601 R7101801 R7101901`,
  油脂调味: `R4400301 R4400101 R4400201 R4401301 R4401401`,
  水果: `D0100101 D0400101 D0600101 D0700101 D0700201 D1000101 D1200101 D1200201 D1300101 D1500301 D16001 D18001 D22001 D2300101 D2310101 D2500101 D2700501 D2800301 D3100201 D3400206 D3500102 D3500201 D3700101 D4400101 D4410101 D4500101 D4600201 D4800101 D4900101 D4300101 D4000101 D0300101 D0500101 D2110101`,
};
// 继续选取不同成品，避免把采样月份/同品种的微小差异全部堆进日常列表。
const additions = {
  主食: `B1000301 R2600101`,
  蛋与豆制品: `K01121 K01201 K01503 K01131 K02141 K0311101 K0320101 K0321101 K0110101 K0150101 K0122101 K0123101 K0123201 R4700501 R4700101 R4900401 R4900601 R5000501 R4701401`,
  饮品: `O0701301 O0700501 O0700801 O0702401 O0200301 O0200701 O0200201 O0702101 O0702001 O0702201 O0701701 O0701901 O0701801 O0701001 O0701101 O0701201 O0702801 O0702701 O0701501 O0702601 O0703301 O0200501 O0703401 O0700101 O0700201 O0700301 O0100501 O0101301 O0100201 O0100701 R5000301 R5000101 R5000201 R1300101 R1300601 R1300501`,
  奶类: `L01021 L0106101 L0104101 L1104101 L0312101 L0316101 L0314201 L0322101 L0314301 L0318301 L1000201 L0500101 L0500201 L0400101 L0400201`,
  坚果种子: `C1610101 C1610201 C2110101 C0110101`,
  肉类: `R5600101 R5600201 R5600301 R5100701 R5100401 R5100501 R5100301 R5200201 R5200301 R5200101`,
  水产: `R6800101 R6800301 R6800401 R6800501 R6800201`,
  蔬菜: `R1600101 R4500101 R4500201 R4500401 R4500501 R4500601 R4500701`,
};
for (const [category, ids] of Object.entries(additions)) selection[category] = `${selection[category] ?? ''} ${ids}`.trim();
// 别名只帮助检索，不把品牌产品、原料或近似菜式改成同一食物。
const extraAliases = {
  R2400201: ['白馒头', '馒头', '原味馒头'], R2400401: ['花卷'],
  R2400301: ['芋头馒头'], R2400601: ['黑糖馒头'],
  R2301101: ['小笼包', '小笼肉包'], R2301301: ['竹笋包', '笋包'],
  R2700401: ['烧饼'], R2700101: ['葱油饼'], R3000101: ['油条'],
  R2800301: ['水煎包', '煎包'], R2800101: ['韭菜盒子'],
  R2201501: ['白菜熟水饺', '白菜水饺'], R2201401: ['猪肉锅贴', '锅贴'],
  R0300201: ['糯米饭团'], Q0700301: ['蛋挞'], Q0700401: ['葡式蛋挞'],
  Q1000801: ['菠萝包'], Q1000501: ['肉松面包'], Q0500501: ['凤梨酥'],
  Q0400101: ['红豆车轮饼'], Q4900101: ['沙琪玛'],
  D18001: ['莲雾'], D16001: ['杨桃'], D1200101: ['释迦', '番荔枝'], D1200201: ['凤梨释迦'],
  D1500301: ['红心芭乐', '红心番石榴'], D0700101: ['白心火龙果'], D0700201: ['红心火龙果'],
  D2500101: ['枇杷'], D4800101: ['余甘子', '油柑'], D4900101: ['嘉宝果', '树葡萄'],
  K01121: ['茶叶蛋'], K01201: ['卤蛋'], K01503: ['蒸蛋', '鸡蛋羹', '水蒸蛋'], K01131: ['皮蛋', '松花蛋'], K02141: ['熟咸鸭蛋'],
  K0110101: ['温泉蛋'], K0311101: ['水煮鹌鹑蛋'], K0320101: ['卤鹌鹑蛋'], K0321101: ['鹌鹑铁蛋'],
  O0702001: ['珍珠奶茶微糖'], O0702101: ['珍珠奶茶半糖'], O0702201: ['珍珠奶茶全糖'],
  O0701501: ['鲜奶茶无糖'], O0701801: ['乌龙奶茶半糖'], O0701701: ['乌龙奶茶微糖'], O0701901: ['乌龙奶茶全糖'],
  O0702801: ['冬瓜茶'], O0100501: ['乌梅汁', '酸梅汁'], O0200201: ['仙草蜜'], R5000301: ['咸豆浆'],
  L01021: ['全脂鲜奶平均参考'], C1610201: ['熟黑芝麻'], B1000301: ['熟菱角'],
};
const fields = { energyKcal: ['熱量', 'kcal'], proteinG: ['粗蛋白', 'g'], fatG: ['粗脂肪', 'g'], carbsG: ['總碳水化合物', 'g'] };
const arg = process.argv.indexOf('--source');
let snapshot;
if (arg >= 0) {
  const bytes = await readFile(process.argv[arg + 1]);
  const rows = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
  const grouped = new Map();
  for (const row of rows) {
    const id = row['整合編號'];
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(row);
  }
  const chosen = new Map(Object.entries(selection).flatMap(([category, ids]) => ids.split(/\s+/).map(id => [id, category])));
  // 糕点/甜点为成品类。粉料、未烘焙起酥片、冷冻/冷藏半成品和营养补充品不混入即食列表。
  for (const [id, values] of grouped) {
    const row = values[0];
    if (/^Q/.test(id) && !/粉|起酥片|咀嚼錠|口含錠/.test(row['樣品名稱']) && !/樣品狀態:生|半成品|冷凍|冷藏/.test(row['樣品名稱'] + row['內容物描述'])) chosen.set(id, '零食');
  }
  snapshot = {
    dataset: 'TFDA 食品营养成分', provider: '衛生福利部食品藥物管理署',
    datasetUrl: 'https://data.gov.tw/dataset/8543', downloadUrl: url,
    license: '政府資料開放授權條款-第1版', licenseUrl: 'https://data.gov.tw/license',
    retrievedAt: new Date().toISOString(), snapshotDate: '2026-10-19',
    originalRows: rows.length, originalFoods: grouped.size,
    sourceJsonSha256: createHash('sha256').update(bytes).digest('hex'),
    foods: [...chosen].sort(([a], [b]) => a.localeCompare(b)).map(([id, category]) => {
      const values = grouped.get(id);
      if (!values) throw Error(`缺少指定原始条目 ${id}`);
      const first = values[0];
      if ((category !== '水果' && /樣品狀態:生/.test(first['內容物描述'])) || /半成品|未烹調|冷凍|冷藏/.test(first['內容物描述'] + first['樣品名稱'])) throw Error(`不能把待烹调样本当成品 ${id}`);
      return { id, category, originalName: first['樣品名稱'], originalCommonName: first['俗名'], originalDescription: first['內容物描述'],
        originalCategory: first['食品分類'], originalEnglishName: first['樣品英文名稱'],
        // 保留选中食品的官方营养行：单位、样本数和原始文本均保留，不抄第三方热量表。
        rows: values.filter(row => Object.values(fields).some(([name]) => name === row['分析項'])) };
    }),
  };
  await writeFile(sourcePath, JSON.stringify(snapshot, null, 2) + '\n');
} else snapshot = JSON.parse(await readFile(sourcePath, 'utf8'));

// 现有精确别名保持其含义；新样本有重名时加“TFDA参考”，不替换旧条目/历史记录。
const { usdaFoods } = await import('../packages/shared/dist/usda-foods.generated.js');
const { surveyFoods } = await import('../packages/shared/dist/fndds-foods.generated.js');
const key = value => value.trim().toLowerCase().replace(/[\s（）()]/g, '');
const seen = new Set([...usdaFoods, ...surveyFoods].flatMap(food => [food.name, ...food.aliases].map(key)));
const result = snapshot.foods.map(food => {
  let name = simplify(food.originalName).replace(/\(/g, '（').replace(/\)/g, '）');
  if (seen.has(key(name))) name += '（TFDA参考）';
  seen.add(key(name));
  const aliases = [];
  const common = (food.originalCommonName ?? '').split(/[,，、;]/);
  for (const value of [...(extraAliases[food.id] ?? []), simplify(food.originalName), food.originalName, ...common.flatMap(v => [v, simplify(v)])]) {
    if (value.trim() && !seen.has(key(value))) { aliases.push(value.trim()); seen.add(key(value)); }
  }
  const nutrientsPer100g = Object.fromEntries(Object.entries(fields).map(([nutrient, [label, unit]]) => {
    const rows = food.rows.filter(row => row['分析項'] === label);
    if (rows.length > 1) throw Error(`重复营养行 ${food.id} ${label}`);
    const row = rows[0], text = row?.['每100克含量']?.trim();
    if (text == null || text === '') return [nutrient, null];
    // “未测得/微量”等非数值保持缺失，不能 Number('') 误补为0。
    if (row['含量單位'] !== unit || !/^\d+(?:\.\d+)?$/.test(text)) throw Error(`单位或数值不可解释 ${food.id} ${label}`);
    const value = Number(text);
    if (value > (nutrient === 'energyKcal' ? 1000 : 100)) throw Error(`数值超界 ${food.id} ${label}`);
    return [nutrient, value];
  }));
  return { id: `tfda-${food.id}`, name, aliases, category: food.category, state: 'ready', nutrientsPer100g,
    source: { dataset: snapshot.dataset, sampleCode: food.id, description: food.originalName,
      sampleDescription: food.originalDescription, version: `${snapshot.snapshotDate} 快照`, publicationDate: '未提供',
      url: snapshot.datasetUrl, downloadUrl: snapshot.downloadUrl, license: 'OGDL-Taiwan-1.0' } };
});
const output = '// 由 scripts/import-chinese-foods.mjs 生成；原始值与许可见 data/tfda-chinese-source.json。\n'
  + "import type { FoodDefinition } from './food-data.js';\n"
  + `export const chineseFoods: FoodDefinition[] = ${JSON.stringify(result, null, 2)};\n`;
await writeFile(new URL('src/chinese-foods.generated.ts', root), output);
console.log(`已导入${result.length}条中式成品参考；没有采用冷冻/生料重量冒充熟重。`);
