import { glmBusinessErrorMessage } from '@shike/shared';
export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400, public readonly retryAfterSeconds?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export function upstreamError(status: number, retryAfter: string | null, glmCode?: string): ApiError {
  const glmMessage = glmCode ? glmBusinessErrorMessage(status, glmCode) : null;
  if (glmMessage && status !== 429) return new ApiError('AI_MODEL_UNAVAILABLE', glmMessage, 502);
  if (status === 401) return new ApiError('AI_UNAUTHORIZED', '模型密钥无效，请检查服务端 API Key。', 502);
  if (status === 402) return new ApiError('AI_BALANCE_INSUFFICIENT', '模型账户余额或额度不足，请到提供商控制台检查。', 502);
  if (status === 403) return new ApiError('AI_FORBIDDEN', '模型服务拒绝访问，请检查地区、项目权限、服务开通状态或免费额度用完即停设置。', 502);
  if (status === 429) {
    const parsed = Number(retryAfter);
    const seconds = Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.ceil(parsed), 3600) : 30;
    return new ApiError('AI_RATE_LIMITED', glmMessage ?? '模型请求受限（429），请稍后重试或到提供商查看具体原因。', 429, seconds);
  }
  return new ApiError('AI_UPSTREAM_ERROR', `模型服务暂时不可用（HTTP ${status}），请稍后重试。`, 502);
}
