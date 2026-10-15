import { buildApp } from './app.js';
import { loadConfig } from './config.js';

try {
  const config = loadConfig();
  const app = await buildApp({ config });
  await app.listen({ port: config.port, host: config.host });
  console.log(`食刻服务已启动：http://${config.host}:${config.port}`);
  const close = async () => { await app.close(); process.exit(0); };
  process.on('SIGINT', close);
  process.on('SIGTERM', close);
} catch (error) {
  // 配置校验错误来自本项目，且不会包含环境变量值。
  console.error(error instanceof Error ? error.message : '服务启动失败。');
  process.exit(1);
}
