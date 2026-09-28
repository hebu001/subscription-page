import axios from 'axios';
import assert from 'node:assert/strict';
import test from 'node:test';

import { BadGatewayException } from '@nestjs/common';

import { TypedConfigService } from '@common/config/app-config';

import { PaymentBffService } from '@modules/payment-bff/payment-bff.service';

const base = { newExpiresAt: null, status: 'failed' };
const cases = [
    {
        name: 'credited-only',
        data: { ...base, balanceCredited: true, message: 'Оплата зачислена на баланс.' },
    },
    {
        name: 'manual review',
        data: { ...base, balanceCredited: false, message: 'Оплата требует проверки.' },
    },
    {
        name: 'succeeded',
        data: {
            status: 'succeeded',
            newExpiresAt: '2026-10-01T00:00:00+00:00',
            balanceCredited: false,
            message: null,
        },
    },
    { name: 'legacy response', data: base },
];

function service() {
    return new PaymentBffService({
        get: (key: string) =>
            ({
                PAYMENT_API_URL: 'https://bot.invalid/cabinet/subpage',
                PAYMENT_BFF_SECRET: 'test-only-secret',
            })[key],
    } as unknown as TypedConfigService);
}

for (const { name, data } of cases) {
    test(`BFF preserves ${name} through the signed upstream request`, async (t) => {
        const original = axios.defaults.adapter;
        t.after(() => {
            axios.defaults.adapter = original;
        });
        axios.defaults.adapter = async (config) => {
            assert.equal(config.url, '/invoice/invoice-token');
            assert.equal(config.method, 'get');
            assert.equal(config.headers['X-Subpage-Short-Uuid'], 'abcdefgh');
            assert.ok(config.headers['X-Subpage-Signature']);
            return {
                config,
                data: { ...data, internalSecret: 'must be removed' },
                status: 200,
                statusText: 'OK',
                headers: {},
            };
        };
        assert.deepEqual(
            await service().getInvoiceStatus('abcdefgh', 'invoice-token', '127.0.0.1'),
            {
                balanceCredited: false,
                message: null,
                ...data,
            },
        );
    });
}

for (const data of [
    { ...base, balanceCredited: 'true' },
    { ...base, message: 'a'.repeat(1025) },
]) {
    test('BFF rejects malformed status metadata instead of misreporting money', async (t) => {
        const original = axios.defaults.adapter;
        t.after(() => {
            axios.defaults.adapter = original;
        });
        axios.defaults.adapter = async (config) => ({
            config,
            data,
            status: 200,
            statusText: 'OK',
            headers: {},
        });
        await assert.rejects(
            service().getInvoiceStatus('abcdefgh', 'invoice-token', '127.0.0.1'),
            BadGatewayException,
        );
    });
}
