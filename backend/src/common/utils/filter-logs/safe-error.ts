import axios from 'axios';

const errorNames = new Set([
    'Error',
    'JsonWebTokenError',
    'NotBeforeError',
    'RangeError',
    'ReferenceError',
    'SyntaxError',
    'TokenExpiredError',
    'TypeError',
    'ZodError',
]);
const errorCodes = new Set([
    'EAI_AGAIN',
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'EPIPE',
    'ERR_BAD_OPTION',
    'ERR_BAD_OPTION_VALUE',
    'ERR_BAD_REQUEST',
    'ERR_BAD_RESPONSE',
    'ERR_CANCELED',
    'ERR_DEPRECATED',
    'ERR_FR_TOO_MANY_REDIRECTS',
    'ERR_INVALID_URL',
    'ERR_NETWORK',
    'ERR_NOT_SUPPORT',
    'ETIMEDOUT',
]);

export interface SafeErrorDiagnostics {
    errorType: string;
    code?: string;
    status?: number;
}

/** Never expose message, stack, config, headers, request or response bodies from an error. */
export function safeErrorDiagnostics(error: unknown): SafeErrorDiagnostics {
    if (!error || typeof error !== 'object') return { errorType: 'UnknownError' };

    const value = error as Record<string, unknown>;
    const result: SafeErrorDiagnostics = {
        errorType: axios.isAxiosError(error)
            ? 'AxiosError'
            : typeof value.name === 'string' && errorNames.has(value.name)
              ? value.name
              : 'Error',
    };
    if (typeof value.code === 'string' && errorCodes.has(value.code)) {
        result.code = value.code;
    }
    const response = value.response as { status?: unknown } | undefined;
    const status = response?.status ?? value.status;
    if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599) {
        result.status = status;
    }
    return result;
}
