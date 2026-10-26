import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { barcodeSchema, parseOffProduct } from '../packages/shared/dist/index.js';

// 仅处理已取得的OFF公开JSON，不在构建或测试中批量联网，缺失值不补造。
const inputPath = process.argv[2];
if (!inputPath) throw new Error('用法：node scripts/import-packaged-catalog.mjs OFF搜索JSON文件');
const raw = await readFile(inputPath, 'utf8'), payload = JSON.parse(raw);
const selection = JSON.parse(await readFile(new URL('../packages/shared/data/packaged-catalog-selection.json', import.meta.url), 'utf8'));
const productsByBarcode = new Map();
for (const product of payload.products) {
  const code = barcodeSchema.safeParse(product.code);
  if (code.success && !productsByBarcode.has(code.data)) productsByBarcode.set(code.data, product);
}
// 从随仓快照再生成时保留原取得时间，避免把离线重建误记成重新联网核验。
const retrievedAt = payload.retrievedAt ?? new Date().toISOString(), output = [], sourceProducts = [];
for (const item of selection) {
  const product = productsByBarcode.get(item.barcode);
  if (!product) throw new Error(`来源文件缺少条码${item.barcode}`);
  const n = product.nutriments ?? {}, kcal = n['energy-kcal_100g'], kj = n['energy-kj_100g'] ?? n.energy_100g;
  if (typeof kcal === 'number' && typeof kj === 'number' && Math.abs(kcal - kj / 4.184) > Math.max(3, kcal * .1)) throw new Error(`能量单位冲突：${item.barcode}`);
  const food = parseOffProduct({ product }, item.barcode, payload.productRetrievedAt?.[product.code] ?? retrievedAt);
  if (!food || food.label.basis === 'unknown' || !food.label.energy) throw new Error(`缺少明确能量或计量单位：${item.barcode}`);
  food.name = item.displayName;
  output.push({ food, category: item.category, aliases: [...new Set([product.product_name, product.product_name_zh, ...item.aliases].filter(Boolean))],
    ...(item.nameTranslation ? { originalName: product.product_name ?? item.originalDisplayName, nameTranslation: item.nameTranslation } : {}) });
  sourceProducts.push(product);
}
const source = { ...payload, license: 'ODbL-1.0', retrievedAt, sourceUrl: payload.sourceUrl ?? 'https://world.openfoodfacts.org/api/v2/search?countries_tags=en%3Achina&page_size=100&sort_by=unique_scans_n',
  sourceSha256: payload.sourceSha256 ?? createHash('sha256').update(raw).digest('hex'), products: sourceProducts };
await writeFile(new URL('../packages/shared/data/packaged-catalog-source.json', import.meta.url), JSON.stringify(source, null, 2) + '\n');
await writeFile(new URL('../packages/shared/src/packaged-catalog.generated.ts', import.meta.url), '// 从OFF公开快照生成，数值勿手改；来源与ODbL许可见data/packaged-catalog-source.json。\nimport type { PublicPackagedFood } from \'./packaged-catalog.js\';\nexport const publicPackagedFoods: PublicPackagedFood[] = ' + JSON.stringify(output, null, 2) + ';\n');
console.log(`已生成${output.length}项公开包装食品，营养值保持来源原值。`);
