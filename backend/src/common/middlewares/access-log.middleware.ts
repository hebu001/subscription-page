import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import morgan from 'morgan';

import { APP_CONFIG_ROUTE_WO_LEADING_PATH } from '@remnawave/subscription-page-types';

const routes = new Set([
    '/:shortUuid',
    '/:shortUuid/:clientType',
    '/payment-api/:shortUuid/invoice',
    '/payment-api/:shortUuid/invoice/:invoiceToken',
    '/payment-api/:shortUuid/renewal-options',
    `/${APP_CONFIG_ROUTE_WO_LEADING_PATH}`,
]);
const methods = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT']);

export function safeAccessRoute(req: Request, customPrefix = ''): string {
    // Only Express's registered route template is trusted. Never fall back to url,
    // originalUrl, baseUrl, params or a request header, even for a 404 or aborted request.
    const route: unknown = req.route?.path;
    if (typeof route !== 'string') return '[unmatched]';
    if (routes.has(route)) return route;
    const prefix = customPrefix.replace(/^\/+|\/+$/g, '');
    if (prefix && route.startsWith(`/${prefix}/`)) {
        const unprefixed = route.slice(prefix.length + 1);
        if (routes.has(unprefixed)) return `/:customPrefix${unprefixed}`;
    }
    return '[unmatched]';
}

function timing(value: string | undefined): number | null {
    if (value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
}

export function createAccessLogMiddleware(stream: morgan.StreamOptions, customPrefix = '') {
    const requestIds = new WeakMap<Request, string>();
    const middleware = morgan<Request, Response>(
        (tokens, req, res) =>
            JSON.stringify({
                timestamp: new Date().toISOString(),
                method: methods.has(req.method) ? req.method : 'OTHER',
                route: safeAccessRoute(req, customPrefix),
                status: res.headersSent ? res.statusCode : null,
                outcome: res.writableFinished ? 'completed' : 'aborted',
                responseTimeMs: timing(tokens['response-time'](req, res)),
                durationMs: timing(tokens['total-time'](req, res)),
                requestId: requestIds.get(req),
            }),
        { stream },
    );

    return (req: Request, res: Response, next: NextFunction) => {
        // Generate locally instead of trusting an attacker-controlled X-Request-ID.
        const requestId = randomUUID();
        requestIds.set(req, requestId);
        res.setHeader('X-Request-ID', requestId);
        middleware(req, res, next);
    };
}
