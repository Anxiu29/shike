import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

// 不经 cmd/npm 再生成一层服务进程，避免 Windows 测试结束时子进程树无法退出。
// 只启动隔离的 Mock 服务，不修改 .env，也不会消耗真实模型的额度。
const env = { ...process.env, PORT: '3101', HOST: '127.0.0.1', AI_MODE: 'mock', AI_REQUESTS_PER_MINUTE: '100', AI_REQUESTS_PER_DAY: '10000' };
const server = spawn(process.execPath, ['scripts/start.mjs'], { env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let serverError = '';
server.stderr.on('data', chunk => { serverError += String(chunk); });
server.stdout.resume();
let runner;
const cleanup = () => { runner?.kill(); server.kill(); };
process.once('SIGINT', cleanup);
process.once('SIGTERM', cleanup);

try {
  let ready = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode !== null) throw new Error(serverError.trim() || 'Mock 测试服务启动失败。请确认 3101 端口空闲。');
    try {
      const response = await fetch('http://127.0.0.1:3101/api/health', { signal: AbortSignal.timeout(500) });
      const health = await response.json();
      if (response.ok && health.mode === 'mock') { ready = true; break; }
    } catch { /* 服务启动期间短暂不可达，继续等待。 */ }
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  if (!ready) throw new Error('Mock 测试服务未能就绪。');
  const cli = fileURLToPath(new URL('../node_modules/@playwright/test/cli.js', import.meta.url));
  runner = spawn(process.execPath, [cli, 'test', ...process.argv.slice(2)], { stdio: 'inherit', env, windowsHide: true });
  const [code] = await once(runner, 'exit');
  process.exitCode = typeof code === 'number' ? code : 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : '浏览器测试启动失败。');
  process.exitCode = 1;
} finally {
  server.kill();
}
