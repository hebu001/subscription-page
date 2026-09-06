import { createLogger, transports } from 'winston';
import { AxiosError, AxiosHeaders } from 'axios';
import { TestContext, test } from 'node:test';
import { WinstonModule } from 'nest-winston';
import assert from 'node:assert/strict';
import { Writable } from 'node:stream';

import { ConsoleLogger, Logger } from '@nestjs/common';

import { createLogFormat } from '@common/utils/filter-logs/logger-format';
import { TypedConfigService } from '@common/config/app-config';
import { AxiosService } from '@common/axios/axios.service';

function capture(t: TestContext) {
    const lines: string[] = [];
    const stream = new Writable({
        write(chunk, _encoding, done) {
            lines.push(String(chunk));
            done();
        },
    });
    const instance = createLogger({
        level: 'debug',
        format: createLogFormat('test', false),
        transports: [new transports.Stream({ stream })],
    });
    Logger.overrideLogger(WinstonModule.createLogger({ instance }));
    t.after(() => {
        Logger.overrideLogger(new ConsoleLogger());
        instance.close();
    });
    return { output: () => lines.join(''), logger: new Logger('SecurityRegression') };
}

function failingRequest() {
    const config = {
        url: '/api/sub/DUMMY_SHORT_UUID?invoice=DUMMY_INVOICE',
        baseURL: 'https://DUMMY_USER:DUMMY_PASSWORD@panel.invalid/DUMMY_BASE_PATH',
        headers: new AxiosHeaders({
            Authorization: 'Bearer DUMMY_API_SECRET',
            'X-Api-Key': 'DUMMY_CADDY_KEY',
            'CF-Access-Client-Id': 'DUMMY_CF_ID',
            'CF-Access-Client-Secret': 'DUMMY_CF_SECRET',
            Cookie: 'session=DUMMY_SESSION',
        }),
        data: { requestHeaders: { referer: 'https://sub.invalid/DUMMY_REFERER' } },
    };
    return new AxiosError(
        'DUMMY_UNLABELLED_ERROR /DUMMY_ERROR_PATH?token=DUMMY_QUERY',
        'ERR_BAD_RESPONSE',
        config,
        { rawRequest: 'DUMMY_REQUEST' },
        {
            config,
            status: 503,
            statusText: 'DUMMY_STATUS_TEXT',
            headers: { 'set-cookie': ['DUMMY_RESPONSE_COOKIE'] },
            data: 'DUMMY_RESPONSE_BODY',
        },
    );
}

function assertNoSecrets(output: string) {
    assert.doesNotMatch(output, /DUMMY_/);
    assert.doesNotMatch(output, /Authorization|rawRequest|requestHeaders|set-cookie/i);
}

test('all panel operations keep diagnostics without serializing Axios request/response secrets', async (t) => {
    const { output, logger } = capture(t);
    const service = new AxiosService({
        get: () => undefined,
        getOrThrow: (key: string) =>
            key === 'REMNAWAVE_PANEL_URL' ? 'https://panel.invalid' : 'DUMMY_API_SECRET',
    } as unknown as TypedConfigService);
    service.axiosInstance.defaults.adapter = async () => {
        throw failingRequest();
    };
    logger.error({
        message: 'Metadata failed',
        operation: 'GetMetadata',
        ...(await service.getRemnawaveMetadata()).error,
    });
    await service.getUserByUsername('127.0.0.1', 'DUMMY_USERNAME');
    await service.getSubscriptionPageConfigByUuid('DUMMY_CONFIG_UUID');
    await service.getSubscriptionPageConfigList();
    await service.getSubscriptionInfo('127.0.0.1', 'DUMMY_SHORT_UUID');
    await service.getSubpageConfig('DUMMY_SHORT_UUID', { cookie: 'DUMMY_COOKIE' });
    await service.getSubscription('127.0.0.1', 'DUMMY_SHORT_UUID', {});
    assertNoSecrets(output());
    for (const operation of [
        'GetMetadata',
        'GetUserByUsername',
        'GetSubscriptionPageConfigByUuid',
        'GetSubscriptionPageConfigList',
        'GetSubscriptionInfo',
        'GetSubpageConfig',
        'GetSubscription',
    ]) {
        assert.ok(output().includes(`operation: '${operation}'`), operation);
    }
    assert.match(output(), /AxiosService/);
    assert.match(output(), /ERR_BAD_RESPONSE/);
    assert.match(output(), /status: 503/);
});

test('final Nest/Winston output rejects raw error objects, stack arguments, and arbitrary metadata', (t) => {
    const { output, logger } = capture(t);
    logger.error(failingRequest());
    logger.error('Safe operation failed', failingRequest());
    logger.error(new Error('DUMMY_PLAIN_ERROR /DUMMY_PRIVATE_PATH'));
    logger.error('Safe plain operation failed', new Error('DUMMY_PLAIN_STACK'));
    logger.error({
        message: 'Structured operation failed',
        operation: 'GetSubpageConfig',
        headers: { Authorization: 'Bearer DUMMY_NESTED' },
        body: 'DUMMY_BODY',
        nested: { token: 'DUMMY_NESTED_TOKEN' },
        [Symbol.for('splat')]: ['DUMMY_SPLAT'],
    });
    assertNoSecrets(output());
    assert.match(output(), /SecurityRegression/);
    assert.match(output(), /Safe operation failed/);
    assert.match(output(), /GetSubpageConfig/);
    assert.match(output(), /status: 503/);
    assert.match(output(), /ERR_BAD_RESPONSE/);
});

test('central defense masks configured secrets and URLs in accidentally interpolated strings', (t) => {
    const { output, logger } = capture(t);
    const previous = process.env.REMNAWAVE_API_TOKEN;
    process.env.REMNAWAVE_API_TOKEN = 'DUMMY_INTERPOLATED_SECRET';
    t.after(() => {
        if (previous === undefined) delete process.env.REMNAWAVE_API_TOKEN;
        else process.env.REMNAWAVE_API_TOKEN = previous;
    });
    logger.error(
        `Panel request failed: ${new Error('https://sub.invalid/DUMMY_LINK?invoice=DUMMY_INVOICE')}`,
    );
    logger.error('Configured client failed with DUMMY_INTERPOLATED_SECRET');
    logger.error('Fetch failed /DUMMY_RELATIVE_PATH?token=DUMMY_TOKEN');
    logger.error('Token rejected: Bearer DUMMY_BEARER');
    logger.debug('Cookie: session=DUMMY_COOKIE');
    assert.doesNotMatch(output(), /DUMMY_/);
    assert.match(output(), /Panel request failed/);
    assert.match(output(), /REDACTED/);
});

test('raw errors cannot smuggle rejected diagnostics or context through enumerable fields', (t) => {
    const { output, logger } = capture(t);
    const error = Object.assign(new Error('DUMMY_MESSAGE'), {
        name: 'DUMMY_NAME',
        code: 'DUMMY_SECRET_CODE',
        operation: 'DUMMY_OPERATION',
        context: 'DUMMY_CONTEXT',
        requestId: 'DUMMY_REQUEST_ID',
        route: 'DUMMY_ROUTE',
        config: { headers: { authorization: 'DUMMY_HEADER' } },
        response: { status: 502 },
    });
    logger.error(error);
    logger.warn(error);
    logger.debug(error);
    logger.log(error);
    assert.doesNotMatch(output(), /DUMMY_/);
    assert.match(output(), /status: 502/);
    assert.match(output(), /errorType: 'Error'/);
});
