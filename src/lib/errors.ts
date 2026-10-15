export type ApiErrorKind =
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'validation'
  | 'rate_limited'
  | 'network'
  | 'unknown';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly kind: ApiErrorKind,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const KIND_BY_CODE: Record<string, ApiErrorKind> = {
  HV401: 'unauthenticated',
  HV403: 'forbidden',
  HV404: 'not_found',
  HV409: 'conflict',
  HV422: 'validation',
  HV429: 'rate_limited',
};

interface RawError {
  code?: string;
  message?: string;
  name?: string;
  status?: number;
}

/**
 * Converte erros do Supabase/PostgREST em mensagens para o usuário.
 * Mensagens dos códigos HVxxx são escritas pelo banco para o usuário final;
 * qualquer outro erro vira uma mensagem genérica, sem expor detalhes internos.
 */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const raw = (error ?? {}) as RawError;
  const code = raw.code ?? '';
  const message = raw.message ?? '';

  if (KIND_BY_CODE[code]) return new ApiError(message, KIND_BY_CODE[code], code);
  if (code === '42501' || code === 'PGRST301' || raw.status === 401) {
    return new ApiError('Você não tem permissão para esta ação. Faça login e tente novamente.', 'forbidden', code);
  }
  if (code === '23505') return new ApiError('Este registro já existe.', 'conflict', code);
  if (code === '23514' || code === '22P02') {
    return new ApiError('Alguns dados enviados são inválidos.', 'validation', code);
  }
  if (/failed to fetch|networkerror|network request failed|load failed/i.test(message) || raw.name === 'TypeError') {
    return new ApiError('Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.', 'network', code);
  }
  console.error('[api] erro inesperado', error);
  return new ApiError('Ocorreu um erro inesperado. Tente novamente em instantes.', 'unknown', code);
}

export function errorMessage(error: unknown): string {
  return toApiError(error).message;
}
