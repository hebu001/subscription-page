import assert from 'node:assert/strict';
import test from 'node:test';

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { TypedConfigService } from '@common/config/app-config';

import { PaymentSessionGuard } from '@modules/payment-bff/payment-session.guard';

const payload = {
    sessionId: 'session-id',
    shortUuid: 'abcdefgh',
    su: 'encrypted-config-id',
};

const makeGuard = (allowedOrigins: string[] = []) =>
    new PaymentSessionGuard(
        {
            verifyAsync: async () => payload,
        } as unknown as JwtService,
        {
            get: (key: string) => (key === 'PAYMENT_ALLOWED_ORIGINS' ? allowedOrigins : undefined),
        } as unknown as TypedConfigService,
    );

const makeContext = (origin: string, fetchSite = 'same-origin') => {
    const headers: Record<string, string> = {
        host: 's.evovp.net',
        origin,
        'sec-fetch-site': fetchSite,
    };
    const request = {
        cookies: { session: 'valid-session' },
        params: { shortUuid: payload.shortUuid },
        method: 'POST',
        protocol: 'https',
        get: (name: string) => headers[name.toLowerCase()],
    };

    return {
        switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
};

test('accepts the backend-observed same origin by default', async () => {
    const guard = makeGuard();
    assert.equal(await guard.canActivate(makeContext('https://s.evovp.net')), true);
});

test('accepts an exact configured CDN origin', async () => {
    const guard = makeGuard(['https://selectel-test.evovp.net']);
    assert.equal(await guard.canActivate(makeContext('https://selectel-test.evovp.net')), true);
});

test('rejects an origin outside the configured allowlist', async () => {
    const guard = makeGuard(['https://selectel-test.evovp.net']);
    await assert.rejects(
        guard.canActivate(makeContext('https://evil.example')),
        ForbiddenException,
    );
});

test('rejects a cross-site fetch even for an allowed origin', async () => {
    const guard = makeGuard(['https://selectel-test.evovp.net']);
    await assert.rejects(
        guard.canActivate(makeContext('https://selectel-test.evovp.net', 'cross-site')),
        ForbiddenException,
    );
});
