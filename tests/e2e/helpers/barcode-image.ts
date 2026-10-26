import sharp from 'sharp';
/** 公共EAN13数字生成纯黑白测试条纹，不使用用户商品照片。 */
export async function barcodeImage(code: string) {
  const left = ['0001101','0011001','0010011','0111101','0100011','0110001','0101111','0111011','0110111','0001011'];
  const odd = ['0100111','0110011','0011011','0100001','0011101','0111001','0000101','0010001','0001001','0010111'];
  const parity = ['LLLLLL','LLGLGG','LLGGLG','LLGGGL','LGLLGG','LGGLLG','LGGGLL','LGLGLG','LGLGGL','LGGLGL'][Number(code[0])]!;
  let bits = '101'; for (let i = 1; i <= 6; i++) bits += (parity[i - 1] === 'L' ? left : odd)[Number(code[i])]; bits += '01010'; for (let i = 7; i <= 12; i++) bits += left[Number(code[i])]!.replace(/[01]/g, value => value === '1' ? '0' : '1'); bits += '101';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="460" height="220"><rect width="460" height="220" fill="white"/>${[...bits].map((bit, i) => bit === '1' ? `<rect x="${40 + i * 4}" y="20" width="4" height="180"/>` : '').join('')}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}
