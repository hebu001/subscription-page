/* eslint-disable no-script-url -- Deliberately malicious navigation fixtures. */
import { setImmediate } from 'node:timers/promises'
import assert from 'node:assert/strict'
import test from 'node:test'

import {
    classifyInvoiceStatus,
    invoiceStatusSchema,
    pollInvoice,
    safeCabinetUrl
} from '../src/widgets/main/renew-subscription/payment-status.ts'

const response = (data = {}) => ({ newExpiresAt: null, status: 'pending', ...data })
const flush = () => setImmediate()

for (const [data, result] of [
    [response(), null],
    [response({ status: 'succeeded', newExpiresAt: '2026-10-01T00:00:00+00:00' }), 'succeeded'],
    [response({ status: 'succeeded', balanceCredited: true }), 'succeeded'],
    [response({ status: 'failed' }), 'failed'],
    [response({ status: 'expired' }), 'failed'],
    [response({ status: 'failed', message: '  ' }), 'failed'],
    [
        response({
            status: 'failed',
            balanceCredited: true,
            message: 'Оплата зачислена на баланс.'
        }),
        'credited'
    ],
    [
        response({ status: 'failed', balanceCredited: false, message: 'Оплата требует проверки.' }),
        'review'
    ]
]) {
    test(`invoice ${JSON.stringify(data)} => ${result}`, () => {
        assert.equal(classifyInvoiceStatus(invoiceStatusSchema.parse(data)), result)
    })
}

test('legacy replies receive safe defaults; malformed financial flags are rejected', () => {
    assert.deepEqual(invoiceStatusSchema.parse(response()), {
        ...response(),
        balanceCredited: false,
        message: null
    })
    for (const data of [
        response({ balanceCredited: 'true' }),
        response({ message: 'a'.repeat(1025) }),
        response({ status: 'invalid' }),
        response({ newExpiresAt: 'yesterday' })
    ]) {
        assert.equal(invoiceStatusSchema.safeParse(data).success, false)
    }
})

test('cabinet navigation only permits absolute HTTPS URLs without credentials', () => {
    assert.equal(safeCabinetUrl('https://cabinet.example/renew'), 'https://cabinet.example/renew')
    for (const url of [
        null,
        undefined,
        '',
        '/cabinet',
        'javascript:alert(1)',
        'data:text/html,bad',
        'http://example.org',
        'https://name:password@example.org'
    ]) {
        assert.equal(safeCabinetUrl(url), null)
    }
})

function setup(t, getStatus) {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const results = []
    const signals = []
    let timeouts = 0
    let expiries = 0
    const stop = pollInvoice({
        getStatus: (signal) => {
            signals.push(signal)
            return getStatus(signal, signals.length)
        },
        onResult: (result, status) => results.push({ result, status }),
        onTimeout: () => timeouts++,
        onSessionExpired: () => expiries++
    })
    t.after(stop)
    return {
        results,
        signals,
        stop,
        get timeouts() {
            return timeouts
        },
        get expiries() {
            return expiries
        }
    }
}

test('pending followed by credited stops polling without declaring the payment failed', async (t) => {
    const run = setup(t, (_, n) =>
        response(n === 1 ? {} : { status: 'failed', balanceCredited: true })
    )
    await flush()
    assert.deepEqual(run.results, [])
    t.mock.timers.tick(3000)
    await flush()
    assert.equal(run.results[0].result, 'credited')
    t.mock.timers.tick(300000)
    assert.equal(run.signals.length, 2)
    assert.equal(run.timeouts, 0)
})

test('session 401 stops immediately and offers recovery without polling again', async (t) => {
    const run = setup(t, () => {
        throw Object.assign(new Error('Expired'), { status: 401 })
    })
    await flush()
    assert.equal(run.expiries, 1)
    assert.equal(run.signals[0].aborted, true)
    t.mock.timers.tick(300000)
    assert.equal(run.signals.length, 1)
    assert.equal(run.timeouts, 0)
    assert.deepEqual(run.results, [])
})

test('transport and schema errors retry instead of displaying payment failure', async (t) => {
    const run = setup(t, (_, n) => {
        if (n === 1) throw new Error('Network failure')
        if (n === 2) return { status: 'failed', balanceCredited: 'yes' }
        return response({ status: 'succeeded' })
    })
    await flush()
    for (let n = 0; n < 2; n++) {
        t.mock.timers.tick(3000)
        // eslint-disable-next-line no-await-in-loop -- Settle one response before advancing its next retry.
        await flush()
    }
    assert.equal(run.results.length, 1)
    assert.equal(run.results[0].result, 'succeeded')
})

test('closing or replacing a poller aborts the request and ignores its late reply', async (t) => {
    let resolve
    const run = setup(
        t,
        () =>
            new Promise((r) => {
                resolve = r
            })
    )
    run.stop()
    assert.equal(run.signals[0].aborted, true)
    resolve(response({ status: 'succeeded' }))
    await flush()
    t.mock.timers.tick(300000)
    assert.deepEqual(run.results, [])
    assert.equal(run.timeouts, 0)
    assert.equal(run.signals.length, 1)
})

test('a hung request times out and late success cannot overwrite the timeout', async (t) => {
    let resolve
    const run = setup(
        t,
        () =>
            new Promise((r) => {
                resolve = r
            })
    )
    t.mock.timers.tick(300000)
    assert.equal(run.signals[0].aborted, true)
    assert.equal(run.timeouts, 1)
    resolve(response({ status: 'succeeded' }))
    await flush()
    assert.deepEqual(run.results, [])
})
