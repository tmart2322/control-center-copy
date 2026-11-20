import { API_ERROR_STATUS, type ApiErrorBody, type ApiErrorCode } from '@/contract';

const RETRYABLE: Record<ApiErrorCode, boolean> = {
  conflict: true, // refetch, rebase, retry
  validation: false,
  not_found: false,
  upstream_unavailable: true,
  budget_exceeded: false,
  dry_run: false,
  internal: true,
};

/** Typed server error. Route handlers map it to the ApiError envelope. */
export class AppError extends Error {
  readonly code: ApiErrorCode;
  readonly details?: unknown;
  readonly retryable: boolean;

  constructor(code: ApiErrorCode, message: string, details?: unknown, retryable?: boolean) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
    this.retryable = retryable ?? RETRYABLE[code];
  }

  get status(): number {
    return API_ERROR_STATUS[this.code];
  }

  toBody(): ApiErrorBody {
    return { code: this.code, message: this.message, retryable: this.retryable, ...(this.details === undefined ? {} : { details: this.details }) };
  }
}

export const notFound = (what: string, id: string) => new AppError('not_found', `${what} ${id} not found`, { id });
export const conflict = (what: string, current: unknown) =>
  new AppError('conflict', `${what} changed elsewhere; refetch and re-apply`, { current });
export const invalid = (message: string, details?: unknown) => new AppError('validation', message, details);

/**
 * Cross-bundle-safe check. In `next dev` each route is its own bundle, so an AppError thrown by the
 * mock store (created by whichever bundle loaded first, kept on globalThis) fails `instanceof`.
 */
export function isAppError(err: unknown): err is AppError {
  if (err instanceof AppError) return true;
  return (
    !!err && typeof err === 'object' && (err as { name?: unknown }).name === 'AppError' &&
    typeof (err as { code?: unknown }).code === 'string' && typeof (err as { toBody?: unknown }).toBody === 'function'
  );
}
