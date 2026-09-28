import ejs from 'ejs';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request as httpRequest, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CookieJar } from 'tough-cookie';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';

import { APP_CONFIG_ROUTE_WO_LEADING_PATH } from '@remnawave/subscription-page-types';

import { AxiosService } from '@common/axios';
import { TypedConfigService } from '@common/config/app-config';
import { installRequestMiddleware } from '@common/middlewares/request-pipeline';
import { subscriptionSessionCookieName } from '@common/utils/subscription-session';

import { PaymentBffController } from '@modules/payment-bff/payment-bff.controller';
import { PaymentBffService } from '@modules/payment-bff/payment-bff.service';
import { SubscriptionController } from '@modules/subscription/subscription.controller';
import { SubscriptionService } from '@modules/subscription/subscription.service';
import { WebpageController } from '@modules/webpage/webpage.controller';
import { WebpageService } from '@modules/webpage/webpage.service';

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
    let lastClientIp: string | undefined;
    const options = (id: string) => ({ shortUuid: id, options: [] });
    @Module({
        controllers: [WebpageController, SubscriptionController, PaymentBffController],
        providers: [
            SubscriptionService,
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
                    getOrThrow: (key: string) => (key === 'TRUST_PROXY' ? true : secret),
                },
            },
            {
                provide: AxiosService,
                useValue: {
                    getSubscription: async () => ({
                        subscription: Buffer.from([0, 255, 65, 13, 10]),
                        headers: {
                            'content-type': 'application/octet-stream',
                            'cache-control': 'public, max-age=86400',
                            'subscription-userinfo': 'upload=0; download=1',
                        },
                    }),
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
                provide: WebpageService,
                inject: [TypedConfigService, AxiosService, JwtService],
                useFactory: (
                    config: TypedConfigService,
                    axios: AxiosService,
                    jwtService: JwtService,
                ) => {
                    const service = new WebpageService(config, axios, jwtService);
                    service.onApplicationBootstrap = async () => {};
                    service.getBaseSettings = () => ({ showConnectionKeys: true }) as never;
                    service.getEncryptedSubpageConfigUuid = (id: string | null) => id!;
                    service.getSubscriptionPageConfig = async (id: string) => ({ config: id });
                    (service as unknown as { indexTemplate: ejs.TemplateFunction }).indexTemplate =
                        ejs.compile('<div data-panel="<%= panelData %>"></div>');
                    return service;
                },
            },
            {
                provide: PaymentBffService,
                useValue: {
                    isEnabled: () => true,
                    getRenewalOptions: options,
                    getInvoiceStatus: (id: string, invoice: string) => ({ shortUuid: id, invoice }),
                    createInvoice: (id: string, _period: number, clientIp: string) => {
                        lastClientIp = clientIp;
                        invoices++;
                        return { shortUuid: id };
                    },
                },
            },
        ],
    })
    class FixtureModule {}
    const app = await NestFactory.create<NestExpressApplication>(FixtureModule, {
        logger: false,
        bodyParser: false,
    });
    installRequestMiddleware(app, app.get(TypedConfigService), { write: () => true } as never);
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
        new Promise<{
            status: number;
            body: string;
            bytes: Buffer;
            headers: import('node:http').IncomingHttpHeaders;
            cookies: string[];
        }>((resolve, reject) => {
            const req = httpRequest(
                {
                    host: '127.0.0.1',
                    port: (server.address() as AddressInfo).port,
                    path,
                    method,
                    headers: {
                        Host: 'subpage.example',
                        'X-Forwarded-Proto': 'https',
                        'X-Forwarded-For': '192.0.2.1',
                        'User-Agent': 'Mozilla',
                        Cookie: jar.getCookieStringSync(origin + path, {
                            sameSiteContext: 'strict',
                        }),
                        'Content-Type': 'application/json',
                        ...headers,
                    },
                },
                (res) => {
                    const chunks: Buffer[] = [];
                    const cookies = res.headers['set-cookie'] ?? [];
                    cookies.forEach((cookie) => jar.setCookieSync(cookie, origin + path));
                    res.on('data', (chunk: Buffer) => chunks.push(chunk));
                    res.on('end', () =>
                        resolve({
                            status: res.statusCode!,
                            body: Buffer.concat(chunks).toString(),
                            bytes: Buffer.concat(chunks),
                            headers: res.headers,
                            cookies,
                        }),
                    );
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
        lastClientIp: () => lastClientIp,
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

for (const prefix of ['', 'private/sub']) {
    test(`actual request pipeline preserves binary subscriptions, private cache and payment guards: ${prefix || 'default'}`, async (t) => {
        const f = await fixture(prefix);
        t.after(f.close);
        const jar = new CookieJar();
        const payment = `${f.base}/payment-api/${A}`;
        assert.equal((await f.send(jar, `${payment}/renewal-options`)).status, 401);
        assert.equal(
            (await f.send(jar, `${payment}/invoice`, { Origin: origin }, 'POST')).status,
            401,
        );
        const raw = await f.send(jar, `${f.base}/${A}`, { 'User-Agent': 'Happ/1.0' });
        assert.equal(raw.status, 200);
        assert.deepEqual(raw.bytes, Buffer.from([0, 255, 65, 13, 10]));
        assert.equal(raw.headers['subscription-userinfo'], 'upload=0; download=1');
        assert.equal(raw.headers['cache-control'], 'private, no-store, max-age=0, must-revalidate');
        assert.equal(raw.headers['surrogate-control'], 'no-store');
        assert.equal(raw.headers.vary, 'User-Agent');
        assert.equal(raw.cookies.length, 0);
        const html = await f.send(jar, `${f.base}/${A}`);
        assert.equal(html.status, 200);
        assert.match(html.headers['cache-control']!, /private, no-store/);
        const selected = await f.send(jar, '/assets/.app-config-v2.json', {
            'X-Subpage-Short-Uuid': A,
        });
        assert.equal(selected.status, 200);
        assert.match(selected.headers['cache-control']!, /private, no-store/);
        assert.equal(
            (
                await f.send(
                    jar,
                    `${payment}/invoice`,
                    { Origin: origin, 'Sec-Fetch-Site': 'same-origin' },
                    'POST',
                )
            ).status,
            201,
        );
        assert.equal(
            (await f.send(jar, `${payment}/invoice`, { Origin: 'https://foreign.invalid' }, 'POST'))
                .status,
            403,
        );
        assert.equal(f.invoices(), 1);
        assert.equal(f.lastClientIp(), '192.0.2.1');
        const health = await f.send(new CookieJar(), '/internal/health', { 'X-Forwarded-For': '' });
        assert.equal(health.status, 200);
        assert.equal(health.body, 'OK');
    });
}
