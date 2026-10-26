import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
// 只生成本机待配置的内测凭证，不打印凭证、不上传、也不改现有模型密钥。
const directory = new URL('../.data-cache/deploy/', import.meta.url);
await mkdir(directory, { recursive: true });
const output = new URL('access.env', directory);
try {
  await writeFile(output, `APP_ACCESS_CODE=${randomBytes(18).toString('base64url')}\nAPP_TOKEN_SECRET=${randomBytes(48).toString('base64url')}\n`, { flag: 'wx', mode: 0o600 });
  console.log(`内测凭证已生成，仅保存在：${fileURLToPath(output)}；请勿发送到聊天或提交 Git。`);
} catch (error) {
  if (error.code === 'EEXIST') console.log('内测凭证文件已存在，保留原值，没有覆盖。');
  else throw error;
}
