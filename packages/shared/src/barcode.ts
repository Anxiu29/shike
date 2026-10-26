/** GS1校验位，条码始终保留为字符串，不能丢前导零。 */
export function validBarcode(code: string): boolean {
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(code)) return false;
  let sum = 0, factor = 3;
  for (let i = code.length - 2; i >= 0; i--) { sum += Number(code[i]) * factor; factor = factor === 3 ? 1 : 3; }
  return (10 - sum % 10) % 10 === Number(code.at(-1));
}
/** OFF用统一长度的条码作主键：EAN-8、UPC-A及带补零的GTIN可能代表同一商品。 */
export function normalizeBarcode(code: string): string {
  if (!validBarcode(code)) throw new Error('商品条码无效');
  const significant = code.replace(/^0+/, '') || '0';
  return significant.padStart(significant.length <= 8 ? 8 : significant.length <= 13 ? 13 : 14, '0');
}
