import { readFile, writeFile } from 'node:fs/promises';
import { barcodeSchema, parseOffProduct } from '../packages/shared/dist/index.js';
import { importProblem, selectionFor } from './lib/packaged-import.mjs';

// 只处理已下载的公开JSON；已发布参考优先，避免扩库时悄悄覆盖历史来源。
const baseUrl = new URL('../packages/shared/data/', import.meta.url);
const oldSource = JSON.parse(await readFile(new URL('packaged-catalog-source.json', baseUrl), 'utf8'));
const selection = JSON.parse(await readFile(new URL('packaged-catalog-selection.json', baseUrl), 'utf8'));
const collected = JSON.parse(await readFile(process.argv[2] ?? '.data-cache/off-expansion/collected.json', 'utf8'));
const byCode = new Map(oldSource.products.map(product => [barcodeSchema.parse(product.code), product]));
const timestamps = { ...Object.fromEntries(oldSource.products.map(product => [product.code, oldSource.productRetrievedAt?.[product.code] ?? oldSource.retrievedAt])) };
const excluded = new Set(['6928804011142', '6917878044729', '6920584471017', '6902265360018', '6970819492317', '6971453932641']);
const rejected = [], additions = [];
for (const product of collected.products) {
  if (barcodeSchema.safeParse(product.code).success && byCode.has(barcodeSchema.parse(product.code))) continue;
  let food, reason;
  try { food = parseOffProduct({ product }, product.code, collected.productRetrievedAt[product.code]); reason = excluded.has(product.code) ? '已知标签异常' : importProblem(product, food) }
  catch { reason = '条码、结构或数值校验失败' }
  if (reason) { rejected.push({ barcode: product.code, reason }); continue }
  const item = selectionFor(product, food);
  // 以解析器规范化的条码去重，UPC补零形式不能生成第二个商品。
  if (selection.some(entry => entry.barcode === item.barcode) || additions.some(entry => entry.barcode === item.barcode)) continue;
  additions.push(item); byCode.set(item.barcode, product); timestamps[product.code] = collected.productRetrievedAt[product.code];
}
additions.sort((a, b) => Number(/[\u3400-\u9fff]/u.test(b.displayName)) - Number(/[\u3400-\u9fff]/u.test(a.displayName)) || a.displayName.localeCompare(b.displayName, 'zh-CN') || a.barcode.localeCompare(b.barcode));
selection.push(...additions);
// 原33项人工整理名称不变；自动整理的分组和检索别名可重建，营养值保持来源原值。
const curatedBaseCount = oldSource.curatedBaseCount ?? 33;
for (let i = curatedBaseCount; i < selection.length; i++) {
  const product = byCode.get(selection[i].barcode);
  const current = selection[i], refreshed = selectionFor(product, parseOffProduct({ product }, current.barcode, timestamps[product.code]));
  selection[i] = current.originalDisplayName ? { ...refreshed, displayName: current.displayName, originalDisplayName: current.originalDisplayName, nameTranslation: current.nameTranslation, aliases: [...new Set([...refreshed.aliases, ...current.aliases])] } : refreshed;
}
const source = { ...oldSource, curatedBaseCount, requests: [...(oldSource.requests ?? []), ...collected.requests].filter((row, index, all) => all.findIndex(other => other.sha256 === row.sha256) === index), productRetrievedAt: timestamps, products: [...byCode.values()] };
const report = { generatedAt: new Date().toISOString(), fetchedUnique: collected.products.length, previousCount: curatedBaseCount, added: selection.length - curatedBaseCount, total: selection.length,
  chineseDisplayNames: selection.filter(item => /[\u3400-\u9fff]/u.test(item.displayName)).length,
  categories: Object.fromEntries([...new Set(selection.map(item => item.category))].map(category => [category, selection.filter(item => item.category === category).length])),
  exclusions: Object.fromEntries([...new Set(rejected.map(item => item.reason))].map(reason => [reason, rejected.filter(item => item.reason === reason).length])), rejected };
await writeFile(new URL('packaged-catalog-source.json', baseUrl), JSON.stringify(source, null, 2) + '\n');
await writeFile(new URL('packaged-catalog-selection.json', baseUrl), JSON.stringify(selection, null, 2) + '\n');
await writeFile(new URL('packaged-catalog-import-report.json', baseUrl), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, rejected: undefined }));
