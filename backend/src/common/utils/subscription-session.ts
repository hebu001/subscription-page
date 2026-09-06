import { createHash } from 'node:crypto';
import { CookieOptions } from 'express';

import { IJwtPayload } from '@common/constants';

export const SHORT_UUID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const SUBSCRIPTION_SELECTOR_HEADER = 'X-Subpage-Short-Uuid';
export const SESSION_COOKIE_OPTIONS: CookieOptions = {
    httpOnly: true,
    maxAge: 1_800_000,
    path: '/',
    sameSite: 'strict',
    secure: true,
};

export function subscriptionSessionCookieName(shortUuid: string, customPrefix = ''): string {
    const prefix = customPrefix.replace(/^\/+|\/+$/g, '');
    const scope = createHash('sha256').update(`${prefix}\0${shortUuid}`).digest('hex').slice(0, 32);
    return `subpage_session_${scope}`;
}

export function selectSubscriptionSession(
    cookies: Record<string, unknown> | undefined,
    shortUuid: string,
    customPrefix = '',
): { token: unknown; scoped: boolean } {
    const name = subscriptionSessionCookieName(shortUuid, customPrefix);
    const scoped = cookies !== undefined && Object.hasOwn(cookies, name);
    // A malformed/expired scoped cookie must never downgrade to the legacy cookie.
    return { token: scoped ? cookies?.[name] : cookies?.session, scoped };
}

export function isSubscriptionSession(payload: unknown): payload is IJwtPayload {
    if (!payload || typeof payload !== 'object') return false;
    const value = payload as Partial<IJwtPayload>;
    return (
        typeof value.sessionId === 'string' &&
        typeof value.shortUuid === 'string' &&
        SHORT_UUID_RE.test(value.shortUuid) &&
        typeof value.su === 'string'
    );
}
