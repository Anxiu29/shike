import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// 开发者显式运行的公开数据下载器；应用启动、构建和测试均不会执行。
// 串行且每次间隔至少7秒，不发送个人饮食、照片、Key或设备资料。
const dir = new URL('../.data-cache/off-expansion/', import.meta.url);
await mkdir(dir, { recursive: true });
const fields = 'code,product_name,product_name_zh,brands,categories_tags,categories,quantity,nutriments';
const queries = [{ id: 'china', q: 'countries_tags:"en:china"', pages: 7 }, { id: 'prefix69', q: 'code:69*', pages: 35 }];
const requests = [], products = new Map();
let lastRequest = 0;
for (const query of queries) {
  for (let page = 1; page <= query.pages; page++) {
    const file = new URL(`${query.id}-${page}.json`, dir);
    const url = 'https://search.openfoodfacts.org/search?' + new URLSearchParams({ q: query.q, page_size: '200', page: String(page), fields, langs: 'zh,en' });
    let cached;
    try { cached = JSON.parse(await readFile(file, 'utf8')) } catch { /* 首次下载 */ }
    if (!cached) {
      const delay = Math.max(0, 7000 - (Date.now() - lastRequest));
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      lastRequest = Date.now();
      let response;
      for (let attempt = 0; attempt < 2; attempt++) {
        try { response = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'Shike/0.8.0 (https://github.com/Anxiu29/shike)' }, signal: AbortSignal.timeout(25000) }); break }
        catch (cause) { if (attempt) throw cause; console.log(`${query.id}/${page}连接失败，7秒后重试一次`); await new Promise(resolve => setTimeout(resolve, 7000)); lastRequest = Date.now() }
      }
      if (!response.ok) throw new Error(`${query.id}/${page}: HTTP ${response.status}；停止下载，已成功的页可断点复用。`);
      const raw = await response.text(), payload = JSON.parse(raw);
      if (!Array.isArray(payload.hits) || payload.timed_out || payload.errors?.length) throw new Error(`${query.id}/${page}: 搜索响应不完整，停止下载。`);
      cached = { url, retrievedAt: new Date().toISOString(), sha256: createHash('sha256').update(raw).digest('hex'), payload };
      await writeFile(file, JSON.stringify(cached));
    }
    requests.push({ url: cached.url, retrievedAt: cached.retrievedAt, sha256: cached.sha256, returned: cached.payload.hits.length, count: cached.payload.count, isCountExact: cached.payload.is_count_exact });
    for (const product of cached.payload.hits) if (!products.has(product.code)) products.set(product.code, { product, retrievedAt: cached.retrievedAt });
    console.log(`${query.id} ${page}/${query.pages}：${cached.payload.hits.length}条，累计去重${products.size}条`);
    if (cached.payload.hits.length < 200) break;
  }
}
await writeFile(new URL('collected.json', dir), JSON.stringify({ requests, products: [...products.values()].map(row => row.product), productRetrievedAt: Object.fromEntries([...products].map(([code, row]) => [code, row.retrievedAt])) }, null, 2));
console.log('公开数据已保存到.data-cache/off-expansion/collected.json；仍须筛选和校验，不能直接当作内置库。');
