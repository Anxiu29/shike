/** 当前只使用手机自配Key；保留自建服务实现，后续显式构建才重新开放。 */
export const serviceConnectionsEnabled = () => import.meta.env.VITE_ENABLE_SERVICE_CONNECTION === 'true'
