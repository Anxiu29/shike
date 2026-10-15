/**
 * 手机局域网预览入口：只开放 Vite；后端与密钥仍留在电脑本机。
 * PUBLIC_ORIGIN 只在此次子进程环境中生效，不修改用户的 .env。
 * 多个有效地址时要求明确选择，避免把 VPN / 虚拟网卡误当手机 Wi-Fi。
 */
import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const addresses = Object.entries(networkInterfaces()).flatMap(([name, list]) =>
  (list ?? []).filter(item => item.family === 'IPv4' && !item.internal).map(item => ({ name, ip: item.address })),
).filter(({ ip }) => /^(?:10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(ip));
const physical = addresses.filter(({ name }) => !/virtual|vethernet|vmware|virtualbox|docker|wsl|vpn|tailscale|zerotier/i.test(name));
const wifi = physical.filter(({ name }) => /wi-?fi|wlan|无线/i.test(name));
const candidates = wifi.length ? wifi : physical;
const requested = process.argv[2];
const address = requested ? addresses.find(item => item.ip === requested) : candidates.length === 1 ? candidates[0] : undefined;
if (process.argv.length > 3 || !address) {
  console.error(requested ? '指定地址不是此电脑当前的局域网 IPv4 地址。' : candidates.length ? '检测到多个局域网地址，请指定手机能连接的网卡地址。' : '未找到可自动选择的局域网 IPv4 地址，请确认网卡连接，或从下方明确指定地址。');
  for (const item of addresses) console.error(`  ${item.name}: npm run dev:lan -- ${item.ip}`);
  process.exitCode = 1;
} else {
  const origin = `http://${address.ip}:5180`;
  console.log(`\n手机与电脑连接同一 Wi-Fi 后，在浏览器打开：${origin}`);
  console.log('请等待前端与后端启动完成；如 5180 / 3001 已占用，先停止原来的 npm run dev。');
  console.log('局域网预览没有登录保护，仅在可信局域网使用；按 Ctrl+C 停止。\n');
  const npmCli = process.env.npm_execpath ?? join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  const child = spawn(process.execPath, [npmCli, 'run', 'dev'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), stdio: 'inherit', windowsHide: true,
    env: { ...process.env, SHIKE_DEV_LAN: '1', HOST: '127.0.0.1', PORT: '3001', NODE_ENV: 'development', PUBLIC_ORIGIN: origin },
  });
  child.once('error', error => { console.error(`启动失败：${error.message}`); process.exitCode = 1; });
  child.once('exit', (code, signal) => { process.exitCode = code ?? (signal ? 1 : 0); });
}
