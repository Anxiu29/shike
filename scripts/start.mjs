// 只设置本次 Node 进程的生产环境，不修改系统环境或用户的密钥文件。
// 必须在导入后端前设置，否则 Fastify 不会注册生产静态资源路由。
// 动态import在上面赋值之后执行模块；改成顶层静态import会先求值依赖，破坏这个时序。
// 这里启动的是已编译dist，修改TS源码后先npm run build；开发时使用npm run dev。
process.env.NODE_ENV = 'production';
await import('../packages/server/dist/index.js');
