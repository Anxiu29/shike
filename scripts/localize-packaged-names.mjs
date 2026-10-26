import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { localizedPackageName } from './lib/packaged-name-zh.mjs';

const dir = new URL('../packages/shared/data/', import.meta.url);
const source = JSON.parse(await readFile(new URL('packaged-catalog-source.json', dir), 'utf8'));
const candidates = JSON.parse(await readFile(new URL('packaged-catalog-selection.json', dir), 'utf8'));
const byCode = new Map(source.products.map(product => [product.code, product]));
// 名称整理发现无法确认是可记录食品的条目时，退出新餐选择而非猜一个中文食品名。
// 公开原始行另存供核对；用户已经保存的标签快照不变。
const rejectedNames = { '6970819492317': 'Castor oil：无法确认此条目为食用级食品', '6971453932641': 'Ggghg：缺少可辨认的食品名称' };
const reviewPath = new URL('packaged-name-review.json', dir);
let reviewed = [];
try { reviewed = JSON.parse(await readFile(reviewPath, 'utf8')); } catch { /* 首次名称复核 */ }
for (const item of candidates) if (rejectedNames[item.barcode] && !reviewed.some(row => row.barcode === item.barcode)) reviewed.push({ barcode: item.barcode, reason: rejectedNames[item.barcode], originalProduct: byCode.get(item.barcode) });
await writeFile(reviewPath, JSON.stringify(reviewed, null, 2) + '\n');
const selection = candidates.filter(item => !rejectedNames[item.barcode]);
let taxonomySnapshot;
const taxonomyArg = process.argv.indexOf('--taxonomy');
if (taxonomyArg >= 0) {
  const raw = await readFile(process.argv[taxonomyArg + 1]);
  const taxonomy = JSON.parse(raw.toString('utf8'));
  const used = new Set(source.products.flatMap(product => product.categories_tags ?? []));
  taxonomySnapshot = { sourceUrl: 'https://static.openfoodfacts.org/data/taxonomies/categories.json',
    retrievedAt: new Date().toISOString(), license: 'ODbL-1.0', sha256: createHash('sha256').update(raw).digest('hex'),
    entries: Object.fromEntries([...used].filter(tag => taxonomy[tag]?.name?.zh).sort().map(tag => [tag, { name: { zh: taxonomy[tag].name.zh, en: taxonomy[tag].name.en } }])) };
  await writeFile(new URL('packaged-taxonomy-zh.json', dir), JSON.stringify(taxonomySnapshot, null, 2) + '\n');
} else taxonomySnapshot = JSON.parse(await readFile(new URL('packaged-taxonomy-zh.json', dir), 'utf8'));
const report = { before: { chinese: 0 }, after: { chinese: 0 }, methods: {}, examples: [], total: selection.length, retiredCount: reviewed.length };
for (const [index, item] of selection.entries()) {
  const product = byCode.get(item.barcode);
  if (!product) throw Error(`缺少原始商品${item.barcode}`);
  const originalDisplayName = item.originalDisplayName ?? item.displayName;
  if (/[\u3400-\u9fff]/.test(originalDisplayName)) report.before.chinese++;
  const result = index < (source.curatedBaseCount ?? 33) && /[\u3400-\u9fff]/.test(originalDisplayName)
    ? { name: originalDisplayName, originalName: product.product_name, kind: 'existing', aliases: localizedPackageName(product, originalDisplayName, taxonomySnapshot.entries).aliases }
    : localizedPackageName(product, originalDisplayName, taxonomySnapshot.entries);
  item.originalDisplayName = originalDisplayName;
  item.displayName = result.name;
  item.nameTranslation = result.kind;
  // 原名可检索，官方分类译名只作为类别词，不变造标签或品牌。
  item.aliases = [...new Set([...item.aliases, originalDisplayName, result.originalName, ...result.aliases].filter(Boolean))];
  if (/[\u3400-\u9fff]/.test(item.displayName)) report.after.chinese++;
  report.methods[result.kind] = (report.methods[result.kind] ?? 0) + 1;
  if (result.name !== originalDisplayName && report.examples.length < 24) report.examples.push({ barcode: item.barcode, before: originalDisplayName, after: item.displayName, method: result.kind });
}
await writeFile(new URL('packaged-catalog-selection.json', dir), JSON.stringify(selection, null, 2) + '\n');
await writeFile(new URL('packaged-translation-report.json', dir), JSON.stringify(report, null, 2) + '\n');
const importReportPath = new URL('packaged-catalog-import-report.json', dir);
const oldReport = JSON.parse(await readFile(importReportPath, 'utf8'));
oldReport.chineseDisplayNames = report.after.chinese;
oldReport.total = selection.length;
oldReport.added = selection.length - oldReport.previousCount;
oldReport.categories = Object.fromEntries([...new Set(selection.map(item => item.category))].map(category => [category, selection.filter(item => item.category === category).length]));
oldReport.nameLocalization = { methods: report.methods, taxonomySource: taxonomySnapshot.sourceUrl };
await writeFile(importReportPath, JSON.stringify(oldReport, null, 2) + '\n');
console.log(JSON.stringify({ ...report, examples: report.examples.slice(0, 5) }));
