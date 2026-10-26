import { barcodeSchema, packagedFoodSchema, type FoodEntry, type PackagedFood, type PackageLabel } from './schemas.js';
import { createPackageEntry } from './package-label.js';
import { createId } from './id.js';
export const OFF_FIELDS = 'code,product_name,product_name_zh,brands,product_quantity,product_quantity_unit,quantity,serving_size,serving_quantity,serving_quantity_unit,nutrition_data_per,nutriments';
export const offProductUrl = (barcode: string) => `https://world.openfoodfacts.org/api/v3.6/product/${barcodeSchema.parse(barcode)}.json?fields=${OFF_FIELDS}`;
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
function numeric(value: unknown, max: number): number | null { if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) return null; return value }
function measure(value: unknown, unit: unknown, text: unknown): PackageLabel['netContent'] {
  const amount = numeric(value, 20000);
  if (amount !== null && amount > 0 && (unit === 'g' || unit === 'ml')) return { amount, unit };
  // 只读明确的单个质量／体积，不猜多包装总重、密度或“杯／片”的大小。
  if (typeof text !== 'string') return null;
  const match = /^\s*(\d+(?:\.\d+)?)\s*(kg|g|ml|mL|l|L)\s*$/.exec(text);
  if (!match) return null;
  const n = Number(match[1]) * (/^(kg|l|L)$/.test(match[2]!) ? 1000 : 1);
  return n > 0 && n <= 20000 ? { amount: n, unit: /^(ml|mL|l|L)$/.test(match[2]!) ? 'ml' : 'g' } : null;
}
/** OFF 的 *_100g 表示质量或体积基准；用明确的计量字段判断，不能一律当100g。 */
export function parseOffProduct(payload: unknown, barcode: string, now = new Date().toISOString()): PackagedFood | null {
  barcode = barcodeSchema.parse(barcode);
  const root = object(payload), product = object(root.product);
  // v3以明确的错误ID表示未收录；HTML404、空JSON或字段损坏属于查询失败。
  const notFound = Array.isArray(root.errors) && root.errors.some(error => object(object(error).message).id === 'product_not_found');
  if (root.status === 0 || notFound) return null;
  if (!Object.keys(product).length) throw new Error('商品库返回无效结构。');
  if (product.code != null && barcodeSchema.safeParse(product.code).data !== barcode) throw new Error('商品条码与查询不一致，请重新查询。');
  const name = [product.product_name_zh, product.product_name].find(value => typeof value === 'string' && value.trim()) as string | undefined;
  if (!name) throw new Error('该商品缺少名称，请拍营养表或手动添加。');
  const net = measure(product.product_quantity, product.product_quantity_unit, product.quantity);
  const serving = measure(product.serving_quantity, product.serving_quantity_unit, product.serving_size);
  // 质量与体积的字段互相矛盾时，不能靠其中一个猜测基准，更不能暗中按密度1换算。
  const conflictingUnits = net !== null && serving !== null && net.unit !== serving.unit;
  const volume = net?.unit === 'ml' || (!net && serving?.unit === 'ml');
  const hasUnit = !conflictingUnits && (net !== null || serving !== null);
  const nutrients = object(product.nutriments);
  // 官方字段单位已标准化为kcal/kJ和g，不使用用户录入的 *_value、NRV或冲调后字段。
  const kcal = numeric(nutrients['energy-kcal_100g'], 2000), kj = numeric(nutrients['energy-kj_100g'] ?? nutrients.energy_100g, 8368);
  const label: PackageLabel = { basis: hasUnit ? volume ? '100ml' : '100g' : 'unknown',
    energy: kcal !== null ? { value: kcal, unit: 'kcal' } : kj !== null ? { value: kj, unit: 'kJ' } : null,
    proteinG: numeric(nutrients.proteins_100g, 200), fatG: numeric(nutrients.fat_100g, 200), carbsG: numeric(nutrients.carbohydrates_100g, 200), servingSize: serving, netContent: net };
  // 官方Search-a-licious搜索使用品牌数组，商品详情API使用逗号分隔字符串。
  const brand = typeof product.brands === 'string' ? product.brands : Array.isArray(product.brands) ? product.brands.filter(value => typeof value === 'string').join(', ') : '';
  return packagedFoodSchema.parse({ id: `off-${barcode}`, name: name.trim().slice(0, 200), brand: brand.slice(0, 200), barcode,
    label, provider: 'manual', model: 'Open Food Facts', manuallyEdited: false,
    source: { type: 'openfoodfacts', barcode, url: `https://world.openfoodfacts.org/product/${barcode}`, license: 'ODbL-1.0', retrievedAt: now }, createdAt: now, updatedAt: now });
}
export function packagedEntry(food: PackagedFood): FoodEntry {
  const entry = createPackageEntry(food.name, food.label, food.provider, food.model);
  Object.assign(entry.packageSnapshot!, { manuallyEdited: food.manuallyEdited, brand: food.brand, ...(food.barcode ? { barcode: food.barcode } : {}), ...(food.source ? { source: { ...food.source } } : {}) });
  if (food.source) { entry.provenance = `Open Food Facts · ${food.source.license} · ${food.source.url}；公开参考，需核对实物包装。`; entry.warnings.push('公开商品数据可能缺失或过期，请核对品牌、规格与当前包装标签。') }
  return entry;
}
export function packageFromEntry(entry: FoodEntry, brand: string, barcode: string | null): PackagedFood {
  barcode = barcode === null ? null : barcodeSchema.parse(barcode);
  const snapshot = entry.packageSnapshot;
  if (!snapshot || snapshot.provider === 'mock') throw new Error('模拟标签不能加入真实包装库。');
  if (snapshot.label.basis === 'unknown' || snapshot.label.energy === null) throw new Error('请先补全标签能量和计量基准，再保存到包装库。');
  if (snapshot.source && barcode !== snapshot.source.barcode) throw new Error('公开来源的条码不能改成其他商品，请重新查询对应商品或手动新建标签。');
  const now = new Date().toISOString();
  return packagedFoodSchema.parse({ id: createId(), name: entry.name, brand, barcode, label: JSON.parse(JSON.stringify(snapshot.label)), provider: snapshot.provider, model: snapshot.model, manuallyEdited: snapshot.manuallyEdited,
    ...(snapshot.source ? { source: { ...snapshot.source } } : {}), createdAt: now, updatedAt: now });
}
