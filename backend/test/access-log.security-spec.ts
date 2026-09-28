import { Request, Response } from 'express';
import express from 'express';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest, Server } from 'node:http';
import { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { NestExpressApplication } from '@nestjs/platform-express';

import { REQUEST_TEMPLATE_TYPE_VALUES } from '@remnawave/backend-contract';
import { APP_CONFIG_ROUTE_WO_LEADING_PATH } from '@remnawave/subscription-page-types';

import { TypedConfigService } from '@common/config/app-config';
import { createAccessLogMiddleware } from '@common/middlewares/access-log.middleware';

import { PaymentBffController } from '@modules/payment-bff/payment-bff.controller';
import { PaymentBffService } from '@modules/payment-bff/payment-bff.service';
import { SubscriptionController } from '@modules/subscription/subscription.controller';
import { SubscriptionService } from '@modules/subscription/subscription.service';
import { WebpageController } from '@modules/webpage/webpage.controller';
import { WebpageService } from '@modules/webpage/webpage.service';

function request(
    server: Server,
    path: string,
    method = 'GET',
): Promise<{ status: number | undefined; requestId: string | undefined }> {
    return new Promise((resolve, reject) => {
        const req = httpRequest(
            {
                host: '127.0.0.1',
                port: (server.address() as AddressInfo).port,
                path,
                method,
                headers: {
                    Referer: 'https://sub.invalid/DUMMY_REFERER',
                    'User-Agent': 'DUMMY_USER_AGENT',
                    Cookie: 'session=DUMMY_COOKIE',
                    Authorization: 'Bearer DUMMY_AUTH',
                    'X-Request-ID': 'DUMMY_REQUEST_ID',
                    'X-Forwarded-For': 'DUMMY_FORWARDED_IP',
                },
            },
            (res) => {
                res.resume();
                res.on('end', () =>
                    resolve({
                        status: res.statusCode,
                        requestId: res.headers['x-request-id'] as string,
                    }),
                );
            },
        );
        req.on('error', reject);
        req.end();
    });
}

for (const prefix of ['', '/DUMMY_CUSTOM_PREFIX']) {
    test(`Morgan final output masks all HTTP input with ${prefix ? 'custom' : 'default'} prefix`, async (t) => {
        const lines: string[] = [];
        const app = express();
        app.use(
            createAccessLogMiddleware(
                {
                    write: (line) => {
                        lines.push(line);
                    },
                },
                prefix,
            ),
        );
        // Rejections before route matching, static responses and unmatched URLs must also be safe.
        app.use('/reject', (_req, res) => {
            res.status(403).end();
        });
        app.use('/abort', (_req, res) => {
            res.socket?.destroy();
        });
        const directory = await mkdtemp(join(tmpdir(), 'subpage-access-log-'));
        await writeFile(join(directory, 'DUMMY_STATIC_ASSET.txt'), 'ok');
        t.after(() => rm(directory, { recursive: true, force: true }));
        app.use('/assets', express.static(directory));
        app.get('/assets/.app-config-v2.json', (_req, res) => res.status(200).end());
        const templates = [
            '/:shortUuid',
            '/:shortUuid/:clientType',
            '/payment-api/:shortUuid/renewal-options',
            '/payment-api/:shortUuid/invoice',
            '/payment-api/:shortUuid/invoice/:invoiceToken',
        ];
        for (const template of templates)
            app.all(`${prefix}${template}`, (_req, res) => res.status(200).end());
        const server = createServer(app);
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
        t.after(
            () =>
                new Promise<void>((resolve, reject) =>
                    server.close((error) => (error ? reject(error) : resolve())),
                ),
        );
        for (const template of templates) {
            const path = template
                .replace(':shortUuid', 'DUMMY_SUBSCRIPTION')
                .replace(':clientType', 'DUMMY_CLIENT_TYPE')
                .replace(':invoiceToken', 'DUMMY_INVOICE');
            const result = await request(server, `${prefix}${path}?invoice=DUMMY_QUERY`);
            assert.equal(result.status, 200);
            assert.match(result.requestId ?? '', /^[\da-f-]{36}$/);
        }
        await request(server, '/assets/.app-config-v2.json?token=DUMMY_QUERY');
        await request(server, '/assets/DUMMY_STATIC_ASSET.txt?token=DUMMY_QUERY');
        await request(server, '/unmatched/DUMMY_PRIVATE_PATH/extra?invoice=DUMMY_QUERY');
        await request(server, '/reject/DUMMY_SECRET?invoice=DUMMY_QUERY');
        await assert.rejects(request(server, '/abort/DUMMY_SECRET'));
        // on-finished logs the aborted socket asynchronously.
        await new Promise((resolve) => setImmediate(resolve));
        const output = lines.join('');
        assert.doesNotMatch(output, /DUMMY_/);
        const events = lines.map((line) => JSON.parse(line));
        assert.equal(events.length, 10);
        for (const [index, template] of templates.entries()) {
            assert.equal(events[index].route, `${prefix ? '/:customPrefix' : ''}${template}`);
            assert.equal(events[index].status, 200);
            assert.equal(events[index].method, 'GET');
            assert.equal(events[index].outcome, 'completed');
            assert.equal(typeof events[index].durationMs, 'number');
        }
        assert.equal(events[5].route, '/assets/.app-config-v2.json');
        assert.equal(events[6].route, '[unmatched]');
        assert.equal(events[7].route, '[unmatched]');
        assert.equal(events[7].status, 404);
        assert.equal(events[8].status, 403);
        assert.equal(events[9].outcome, 'aborted');
        assert.equal(events[9].status, null);
        assert.equal(new Set(events.map((event) => event.requestId)).size, events.length);
    });
}

@Module({
    controllers: [PaymentBffController, WebpageController, SubscriptionController],
    providers: [
        {
            provide: SubscriptionService,
            useValue: {
                serveSubscriptionPage: (_ip: string, _req: Request, res: Response) =>
                    res.status(200).end(),
            },
        },
        { provide: WebpageService, useValue: { getSubscriptionPageConfig: () => ({}) } },
        { provide: PaymentBffService, useValue: { isEnabled: () => true } },
        { provide: JwtService, useValue: {} },
        { provide: TypedConfigService, useValue: { get: () => undefined } },
    ],
})
class RouteTestModule {}

for (const prefix of ['', 'DUMMY_CUSTOM_PREFIX']) {
    test(`registered Nest controller routes keep safe templates with ${prefix ? 'custom' : 'default'} prefix`, async (t) => {
        const lines: string[] = [];
        const app = await NestFactory.create<NestExpressApplication>(RouteTestModule, {
            logger: false,
        });
        t.after(() => app.close());
        app.use(
            createAccessLogMiddleware(
                {
                    write: (line) => {
                        lines.push(line);
                    },
                },
                prefix,
            ),
        );
        app.use((req: { user?: object } & Request, _res: Response, next: () => void) => {
            req.user = { su: 'DUMMY_CONFIG' };
            next();
        });
        app.setGlobalPrefix(prefix, { exclude: [APP_CONFIG_ROUTE_WO_LEADING_PATH] });
        await app.listen(0, '127.0.0.1');
        const base = prefix ? `/${prefix}` : '';
        const server = app.getHttpServer() as Server;
        assert.equal(
            (await request(server, `${base}/DUMMY_SUBSCRIPTION?invoice=DUMMY_QUERY`)).status,
            200,
        );
        assert.equal(
            (await request(server, `${base}/DUMMY_SUBSCRIPTION/${REQUEST_TEMPLATE_TYPE_VALUES[0]}`))
                .status,
            200,
        );
        // Real payment guard rejects missing parsed session; the log must still show the registered template.
        assert.equal(
            (await request(server, `${base}/payment-api/DUMMY_SUBSCRIPTION/renewal-options`))
                .status,
            401,
        );
        assert.equal(
            (await request(server, `${base}/payment-api/DUMMY_SUBSCRIPTION/invoice`, 'POST'))
                .status,
            401,
        );
        assert.equal(
            (await request(server, `${base}/payment-api/DUMMY_SUBSCRIPTION/invoice/DUMMY_INVOICE`))
                .status,
            401,
        );
        assert.equal(
            (await request(server, `/${APP_CONFIG_ROUTE_WO_LEADING_PATH}?token=DUMMY_QUERY`))
                .status,
            200,
        );
        assert.doesNotMatch(lines.join(''), /DUMMY_/);
        const events = lines.map((line) => JSON.parse(line));
        assert.deepEqual(
            events.map((event) => event.route),
            [
                '/:shortUuid',
                '/:shortUuid/:clientType',
                '/payment-api/:shortUuid/renewal-options',
                '/payment-api/:shortUuid/invoice',
                '/payment-api/:shortUuid/invoice/:invoiceToken',
            ]
                .map((route) => `${prefix ? '/:customPrefix' : ''}${route}`)
                .concat(`/${APP_CONFIG_ROUTE_WO_LEADING_PATH}`),
        );
        assert.equal(events[3].method, 'POST');
    });
}
