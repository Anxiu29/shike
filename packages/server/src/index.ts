/**
 * Node进程入口：加载并验证环境配置→buildApp装配依赖和路由→listen监听端口。
 * app.ts不自行listen，测试可直接构建Fastify实例并inject请求，无需启动真实网络服务。
 * import使用.js后缀，因为tsc输出ES模块JavaScript；编辑的源文件仍为.ts。
 */
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
