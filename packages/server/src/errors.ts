export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400, public readonly retryAfterSeconds?: number) {
    super(message);
    this.name = 'ApiError';
  }
}

export function upstreamError(status: number, retryAfter: string | null): ApiError {
  if (status === 401) return new ApiError('AI_UNAUTHORIZED', '模型密钥无效，请检查服务端 API Key。', 502);
  if (status === 403) return new ApiError('AI_FORBIDDEN', '模型服务拒绝访问，请检查地区、项目权限或服务开通状态。', 502);
  if (status === 429) {
    const parsed = Number(retryAfter);
    const seconds = Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.ceil(parsed), 3600) : 30;
    return new ApiError('AI_RATE_LIMITED', '模型服务繁忙或免费额度已用尽，请稍后重试。', 429, seconds);
  }
  return new ApiError('AI_UPSTREAM_ERROR', `模型服务暂时不可用（HTTP ${status}），请稍后重试。`, 502);
}
