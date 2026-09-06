import winston from 'winston';

import { safeErrorDiagnostics } from './safe-error';

const contextsToIgnore = ['InstanceLoader', 'RoutesResolver', 'RouterExplorer'];
const safeMetadata = [
    'operation',
    'errorType',
    'code',
    'status',
    'route',
    'method',
    'requestId',
    'responseTimeMs',
    'durationMs',
    'contentLength',
    'outcome',
];

function redactText(value: string): string {
    // Defense in depth for accidentally interpolated configured credentials. Never log
    // request values in the first place: unlabelled subscription links are bearer secrets.
    let result = value;
    for (const [key, secret] of Object.entries(process.env)) {
        if (!secret || !/(SECRET|TOKEN|PASSWORD|COOKIE|CLIENT_ID|API_KEY)/i.test(key)) continue;
        for (const part of secret
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)) {
            result = result.split(part).join('[REDACTED]');
        }
    }
    return result
        .replace(/https?:\/\/[^\s"'<>]+/gi, '[REDACTED_URL]')
        .replace(/\b(Bearer|Basic)\s+[^\s,"';]+/gi, '$1 [REDACTED]')
        .replace(
            /\b(authorization|cookie|set-cookie|x-api-key|cf-access-client-secret|cf-access-client-id|token|secret|password|shortUuid|invoiceToken)\s*[:=]\s*[^\r\n]+/gi,
            '$1=[REDACTED]',
        )
        .replace(/(?:^|\s)\/[^\s"'<>]+/g, ' [REDACTED_PATH]')
        .slice(0, 4000);
}

/** The final formatter must never serialize arbitrary Nest/Axios metadata. */
export const customLogFilter = winston.format((info) => {
    if (typeof info.context === 'string' && contextsToIgnore.includes(info.context)) return false;

    const rawError =
        info.error instanceof Error
            ? info.error
            : info instanceof Error || info.isAxiosError || info.config || info.request
              ? info
              : undefined;
    const clean = {
        level: info.level,
        [Symbol.for('level')]: info[Symbol.for('level')],
        message: rawError
            ? 'Operation failed'
            : typeof info.message === 'string'
              ? redactText(info.message)
              : 'Structured log event',
    } as typeof info;
    // Raw errors can carry enumerable fields that nest-winston spreads over trusted
    // metadata. Do not inherit an error's own context or other allowlisted fields.
    if (typeof info.context === 'string' && (!rawError || !Object.hasOwn(rawError, 'context'))) {
        clean.context = redactText(info.context);
    }

    for (const key of rawError ? [] : safeMetadata) {
        const value = info[key];
        if (typeof value === 'string') clean[key] = redactText(value);
        else if (typeof value === 'number' && Number.isFinite(value)) clean[key] = value;
    }
    if (rawError) Object.assign(clean, safeErrorDiagnostics(rawError));
    // Nest puts logger.error(message, error) in stack[0]. Only retain safe diagnostics.
    if (Array.isArray(info.stack)) {
        const error = info.stack.find(
            (value: unknown) => value instanceof Error || (value && typeof value === 'object'),
        );
        if (error) Object.assign(clean, safeErrorDiagnostics(error));
    }
    return clean;
});
