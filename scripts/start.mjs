// 只设置本次 Node 进程的生产环境，不修改系统环境或用户的密钥文件。
// 必须在导入后端前设置，否则 Fastify 不会注册生产静态资源路由。
process.env.NODE_ENV = 'production';
await import('../packages/server/dist/index.js');
