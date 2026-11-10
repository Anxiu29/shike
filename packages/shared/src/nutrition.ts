/**
 * 兼容原有营养模块入口：现有代码仍可从这里或@shike/shared导入。
 * snapshot只依赖记录内的快照；catalog才读取完整食品与配方数据。
 * 不在此处初始化索引，让构建器按实际使用的导出裁剪不需要的模块。
 */
export * from "./nutrition-snapshot.js";
export * from "./nutrition-catalog.js";
