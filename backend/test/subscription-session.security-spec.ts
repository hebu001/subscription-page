import { request as httpRequest, Server } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { CookieJar } from 'tough-cookie';
import cookieParser from 'cookie-parser';
import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import * as ejs from 'ejs';

import { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Module } from '@nestjs/common';

import { APP_CONFIG_ROUTE_WO_LEADING_PATH } from '@remnawave/subscription-page-types';

import { checkAssetsCookieMiddleware } from '@common/middlewares/check-assets-cookie.middleware';
import { subscriptionSessionCookieName } from '@common/utils/subscription-session';
import { TypedConfigService } from '@common/config/app-config';
import { AxiosService } from '@common/axios';

import { PaymentBffController } from '@modules/payment-bff/payment-bff.controller';
import { PaymentBffService } from '@modules/payment-bff/payment-bff.service';
import { SubpageConfigService } from '@modules/root/subpage-config.service';
import { RootController } from '@modules/root/root.controller';
import { RootService } from '@modules/root/root.service';

const A = 'aaaaaaaa';
const B = 'bbbbbbbb';
const secret = 'dummy-local-session-secret-for-tests';
const jwt = new JwtService({ secret });
const origin = 'https://subpage.example';

async function fixture(prefix: string) {
    const oldSecret = process.env.INTERNAL_JWT_SECRET;
    const oldPrefix = process.env.CUSTOM_SUB_PREFIX;
    process.env.INTERNAL_JWT_SECRET = secret;
    process.env.CUSTOM_SUB_PREFIX = prefix;
    const directory = await mkdtemp(join(tmpdir(), 'subpage-session-'));
    await writeFile(join(directory, 'index.html'), '<div data-panel="<%= panelData %>"></div>');
    let slow = '';
    let invoices = 0;
    const options = (id: string) => ({ shortUuid: id, options: [] });
    @Module({
        controllers: [RootController, PaymentBffController],
        providers: [
            RootService,
            { provide: JwtService, useValue: jwt },
            {
                provide: TypedConfigService,
                useValue: {
                    get: (key: string) =>
                        ({
                            CUSTOM_SUB_PREFIX: prefix,
                            PAYMENT_API_URL: 'https://dummy.invalid',
                            PAYMENT_BFF_SECRET: 'dummy',
                        })[key],
                    getOrThrow: () => false,
                },
            },
            {
                provide: AxiosService,
                useValue: {
                    getSubscriptionInfo: async (_ip: string, id: string) => {
                        if (id === slow) await new Promise((resolve) => setTimeout(resolve, 30));
                        return {
                            isOk: true,
                            response: {
                                response: { user: { shortUuid: id }, links: [], ssConfLinks: {} },
                            },
                        };
                    },
                    getSubpageConfig: async (id: string) => ({
                        isOk: true,
                        response: { subpageConfigUuid: `config-${id}`, webpageAllowed: true },
                    }),
                },
            },
            {
                provide: SubpageConfigService,
                useValue: {
                    getBaseSettings: () => ({ showConnectionKeys: true }),
                    getEncryptedSubpageConfigUuid: (id: string) => id,
                    getSubscriptionPageConfig: (id: string) => ({ config: id }),
                },
            },
            {
                provide: PaymentBffService,
                useValue: {
                    isEnabled: () => true,
                    getRenewalOptions: options,
                    getInvoiceStatus: (id: string, invoice: string) => ({ shortUuid: id, invoice }),
                    createInvoice: (id: string) => {
                        invoices++;
                        return { shortUuid: id };
                    },
                },
            },
        ],
    })
    class FixtureModule {}
    const app = await NestFactory.create<NestExpressApplication>(FixtureModule, { logger: false });
    app.set('trust proxy', true);
    app.use(cookieParser(), checkAssetsCookieMiddleware);
    app.setBaseViewsDir(directory);
    app.engine('html', ejs.renderFile);
    app.setViewEngine('html');
    app.setGlobalPrefix(prefix, { exclude: [APP_CONFIG_ROUTE_WO_LEADING_PATH] });
    await app.listen(0, '127.0.0.1');
    const base = prefix ? `/${prefix}` : '';
    const server = app.getHttpServer() as Server;
    const send = (
        jar: CookieJar,
        path: string,
        headers: Record<string, string> = {},
        method = 'GET',
    ) =>
        new Promise<{ status: number; body: string; cookies: string[] }>((resolve, reject) => {
            const req = httpRequest(
                {
                    host: '127.0.0.1',
                    port: (server.address() as AddressInfo).port,
                    path,
                    method,
                    headers: {
                        Host: 'subpage.example',
                        'X-Forwarded-Proto': 'https',
                        'User-Agent': 'Mozilla',
                        Cookie: jar.getCookieStringSync(origin + path, {
                            sameSiteContext: 'strict',
                        }),
                        'Content-Type': 'application/json',
                        ...headers,
                    },
                },
                (res) => {
                    let body = '';
                    const cookies = res.headers['set-cookie'] ?? [];
                    cookies.forEach((cookie) => jar.setCookieSync(cookie, origin + path));
                    res.on('data', (chunk) => (body += chunk));
                    res.on('end', () => resolve({ status: res.statusCode!, body, cookies }));
                },
            );
            req.on('error', reject);
            req.end(method === 'POST' ? JSON.stringify({ periodDays: 30 }) : undefined);
        });
    return {
        base,
        send,
        setSlow: (id: string) => (slow = id),
        invoices: () => invoices,
        close: async () => {
            await app.close();
            await rm(directory, { recursive: true, force: true });
            if (oldSecret === undefined) delete process.env.INTERNAL_JWT_SECRET;
            else process.env.INTERNAL_JWT_SECRET = oldSecret;
            if (oldPrefix === undefined) delete process.env.CUSTOM_SUB_PREFIX;
            else process.env.CUSTOM_SUB_PREFIX = oldPrefix;
        },
    };
}

for (const prefix of ['', 'private/sub']) {
    test(`shared cookie jar isolates two subscriptions/configs, prefix=${prefix || '(default)'}`, async (t) => {
        const f = await fixture(prefix);
        t.after(f.close);
        const config = '/assets/.app-config-v2.json';
        const route = (id: string) => `${f.base}/payment-api/${id}`;
        for (const slow of [A, B]) {
            const jar = new CookieJar();
            f.setSlow(slow);
            const opened = await Promise.all([
                f.send(jar, `${f.base}/${A}`),
                f.send(jar, `${f.base}/${B}`),
            ]);
            opened.forEach((response) => {
                assert.equal(response.status, 200);
                assert.equal(response.cookies.length, 2);
                response.cookies.forEach((cookie) => {
                    for (const attribute of [
                        'HttpOnly',
                        'Secure',
                        'SameSite=Strict',
                        'Path=/',
                        'Max-Age=1800',
                    ])
                        assert.ok(cookie.includes(attribute));
                });
            });
            assert.equal(jar.getCookiesSync(origin).length, 3);
            assert.equal(jar.getCookieStringSync(origin, { http: false }), '');
            for (const id of [A, B]) {
                const cfg = await f.send(jar, config, { 'X-Subpage-Short-Uuid': id });
                assert.deepEqual(JSON.parse(cfg.body), { config: `config-${id}` });
                assert.equal(
                    JSON.parse((await f.send(jar, `${route(id)}/renewal-options`)).body).shortUuid,
                    id,
                );
                assert.equal(
                    JSON.parse((await f.send(jar, `${route(id)}/invoice/${'x'.repeat(24)}`)).body)
                        .shortUuid,
                    id,
                );
                assert.equal(
                    (
                        await f.send(
                            jar,
                            `${route(id)}/invoice`,
                            { Origin: origin, 'Sec-Fetch-Site': 'same-origin' },
                            'POST',
                        )
                    ).status,
                    201,
                );
            }
            // Only legacy selectorless config follows the last open's global cookie.
            assert.deepEqual(JSON.parse((await f.send(jar, config)).body), {
                config: `config-${slow}`,
            });
            const maliciousHeaders: Record<string, string>[] = [
                { Origin: 'https://evil.invalid' },
                { Origin: origin, 'Sec-Fetch-Site': 'cross-site' },
            ];
            for (const headers of maliciousHeaders) {
                assert.equal(
                    (await f.send(jar, `${route(A)}/invoice`, headers, 'POST')).status,
                    403,
                );
            }
            const name = subscriptionSessionCookieName(A, prefix);
            const saved = jar.getCookiesSync(origin).find((cookie) => cookie.key === name)!;
            // Missing A while B's global session is fresh is recoverable, not another owner's config.
            await f.send(jar, `${f.base}/${B}`);
            jar.setCookieSync(`${name}=deleted; Path=/; Max-Age=0; Secure; HttpOnly`, origin);
            assert.equal((await f.send(jar, `${route(A)}/renewal-options`)).status, 401);
            assert.equal((await f.send(jar, config, { 'X-Subpage-Short-Uuid': A })).status, 401);
            const before = f.invoices();
            await f.send(jar, `${f.base}/${A}?invoice=${'x'.repeat(24)}`);
            assert.equal((await f.send(jar, `${route(A)}/invoice/${'x'.repeat(24)}`)).status, 200);
            assert.equal(f.invoices(), before);
            // Matching legacy remains valid, but never masks present invalid scoped tokens.
            jar.setCookieSync(`${name}=deleted; Path=/; Max-Age=0; Secure; HttpOnly`, origin);
            assert.equal((await f.send(jar, `${route(A)}/renewal-options`)).status, 200);
            for (const value of [
                'invalid',
                '',
                jwt.sign({ sessionId: 'dummy', shortUuid: A, su: 'config-A' }, { expiresIn: -1 }),
                jwt.sign({ sessionId: 'dummy', su: 'config-A' }),
            ]) {
                jar.setCookieSync(`${name}=${value}; Path=/; Secure; HttpOnly`, origin);
                assert.equal((await f.send(jar, `${route(A)}/renewal-options`)).status, 401);
                assert.equal(
                    (await f.send(jar, config, { 'X-Subpage-Short-Uuid': A })).status,
                    401,
                );
            }
            const swapped = jwt.sign({ sessionId: 'dummy', shortUuid: B, su: 'config-B' });
            jar.setCookieSync(`${name}=${swapped}; Path=/; Secure; HttpOnly`, origin);
            assert.equal((await f.send(jar, `${route(A)}/renewal-options`)).status, 404);
            assert.equal((await f.send(jar, config, { 'X-Subpage-Short-Uuid': A })).status, 404);
            jar.setCookieSync(saved, origin);
            assert.equal(
                (await f.send(jar, config, { 'X-Subpage-Short-Uuid': 'bad' })).status,
                401,
            );
        }
    });
}

test('cookie names normalize prefixes and isolate prefix namespaces without exposing shortUuid', () => {
    assert.equal(
        subscriptionSessionCookieName(A, '/private/sub/'),
        subscriptionSessionCookieName(A, 'private/sub'),
    );
    assert.notEqual(
        subscriptionSessionCookieName(A),
        subscriptionSessionCookieName(A, 'private/sub'),
    );
    assert.notEqual(subscriptionSessionCookieName(A), subscriptionSessionCookieName(B));
    assert.ok(!subscriptionSessionCookieName(A).includes(A));
});
