/* global globalThis */
/* eslint-disable no-script-url -- Deliberately malicious navigation fixtures. */
import { after, before, test } from 'node:test'
import { MantineProvider } from '@mantine/core'
import { createRoot } from 'react-dom/client'
import { act, createElement } from 'react'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'

let dom
let vite
let Widget
before(async () => {
    dom = new JSDOM('<html><body></body></html>', {
        url: 'https://subpage.example/user?invoice=test-invoice',
        pretendToBeVisual: true
    })
    for (const key of [
        'window',
        'document',
        'navigator',
        'HTMLElement',
        'Element',
        'DocumentFragment',
        'getComputedStyle',
        'requestAnimationFrame',
        'cancelAnimationFrame'
    ]) {
        Object.defineProperty(globalThis, key, {
            value:
                typeof dom.window[key] === 'function' && key[0] === key[0].toLowerCase()
                    ? dom.window[key].bind(dom.window)
                    : dom.window[key],
            configurable: true
        })
    }
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
    globalThis.ResizeObserver = function ResizeObserverMock() {
        return { disconnect() {}, observe() {}, unobserve() {} }
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const stubs = {
        '@entities/subscription-info-store':
            "export const useSubscription = () => ({ user: { shortUuid: 'abcdefgh' } }); export const usePaymentApiUrl = () => '/payment-api';",
        '@shared/hooks':
            "export const useTranslation = () => ({ currentLang: globalThis.paymentTestLanguage || 'ru' });",
        'payment-fetch-stub':
            'export const ofetch = (...args) => globalThis.paymentTestFetch(...args);'
    }
    vite = await createServer({
        configFile: false,
        optimizeDeps: { noDiscovery: true, include: [] },
        server: { middlewareMode: true, ws: false },
        plugins: [
            {
                name: 'payment-component-test-dependencies',
                enforce: 'pre',
                transform(code, id) {
                    if (id.endsWith('/renew-subscription.widget.tsx'))
                        return code.replace("from 'ofetch'", "from 'payment-fetch-stub'")
                    return null
                },
                resolveId(id) {
                    if (id in stubs) return `\0payment-test:${id}`
                    return null
                },
                load(id) {
                    if (id.startsWith('\0payment-test:'))
                        return stubs[id.slice('\0payment-test:'.length)]
                    return null
                }
            }
        ]
    })
    Widget = (
        await vite.ssrLoadModule(
            '/src/widgets/main/renew-subscription/renew-subscription.widget.tsx'
        )
    ).RenewSubscriptionWidget
})
after(async () => {
    await vite?.close()
    dom?.window.close()
})

async function mount(
    t,
    invoice,
    { cabinetUrl = 'https://cabinet.example/', enabled = true, language = 'ru' } = {}
) {
    window.history.replaceState(null, '', '/user?invoice=test-invoice')
    globalThis.paymentTestLanguage = language
    const calls = []
    const renewalOptions = [
        {
            periodDays: 30,
            priceKopeks: 10000,
            basePriceKopeks: 10000,
            devicesPriceKopeks: 0,
            label: '30 дней'
        }
    ]
    globalThis.paymentTestFetch = async (url, options) => {
        calls.push({ url, options })
        if (url.endsWith('/renewal-options')) {
            return { cabinetUrl, enabled, options: enabled ? renewalOptions : [] }
        }
        return typeof invoice === 'function' ? invoice(options) : invoice
    }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    t.after(async () => {
        await act(() => root.unmount())
        container.remove()
    })
    await act(async () => {
        root.render(createElement(MantineProvider, null, createElement(Widget)))
    })
    return { calls, text: () => document.body.textContent }
}
const status = (data = {}) => ({ status: 'failed', newExpiresAt: null, ...data })

test('credited payment renders account navigation, never an unpaid or renewed message', async (t) => {
    const view = await mount(
        t,
        status({ balanceCredited: true, message: 'Оплата зачислена на баланс.' })
    )
    assert.match(view.text(), /Оплата зачислена на баланс/)
    assert.doesNotMatch(
        view.text(),
        /Оплата не завершена|Подписка продлена|Можно попробовать ещё раз/
    )
    assert.equal(document.querySelector('a')?.href, 'https://cabinet.example/')
    assert.equal(window.location.search, '')
    assert.equal(
        view.calls.some(({ options }) => options.method === 'POST'),
        false
    )
})

test('manual review is rendered as text and does not offer repeat payment', async (t) => {
    const message = 'Оплата требует проверки. <img src=x onerror=alert(1)>'
    const view = await mount(t, status({ balanceCredited: false, message }))
    assert.match(view.text(), /Оплата требует проверки/)
    assert.ok(view.text().includes(message))
    assert.doesNotMatch(view.text(), /Оплата не завершена|Можно попробовать ещё раз/)
    assert.equal(document.querySelector('img'), null)
})

test('legacy failed response still renders the ordinary failure screen', async (t) => {
    const view = await mount(t, status())
    assert.match(view.text(), /Оплата не завершена/)
    assert.equal(window.location.search, '')
})

test('successful renewal shows its date', async (t) => {
    const view = await mount(
        t,
        status({ status: 'succeeded', newExpiresAt: '2026-10-01T00:00:00+00:00' })
    )
    assert.match(view.text(), /Подписка продлена/)
    assert.match(view.text(), /2026/)
})

test('credited result has English fallback and no unsafe cabinet link', async (t) => {
    const view = await mount(t, status({ balanceCredited: true }), {
        language: 'en',
        cabinetUrl: 'javascript:alert(1)'
    })
    assert.match(view.text(), /Payment credited to your balance/)
    assert.match(view.text(), /Choose a renewal in your account/)
    assert.equal(document.querySelector('a'), null)
})

test('disabled sales still let an already credited user open the cabinet', async (t) => {
    const view = await mount(t, status({ balanceCredited: true }), { enabled: false })
    assert.match(view.text(), /Оплата зачислена на баланс/)
    assert.equal(document.querySelector('a')?.href, 'https://cabinet.example/')
})

test('closing while checking aborts, retains the invoice URL, and ignores a late success', async (t) => {
    let resolve
    let signal
    const view = await mount(t, (options) => {
        signal = options.signal
        return new Promise((r) => {
            resolve = r
        })
    })
    assert.match(view.text(), /Проверяем статус оплаты/)
    const close = document.querySelector('button[aria-label="Close"]')
    await act(async () => {
        close.click()
    })
    assert.equal(signal.aborted, true)
    assert.equal(new URLSearchParams(window.location.search).get('invoice'), 'test-invoice')
    await act(async () => {
        resolve(status({ status: 'succeeded' }))
    })
    assert.doesNotMatch(view.text(), /Подписка продлена/)
    assert.equal(view.calls.length, 2)
})

test('reopening a pending payment checks the same invoice without creating another', async (t) => {
    let count = 0
    let resolveOld
    const view = await mount(t, () => {
        count++
        if (count === 1)
            return new Promise((r) => {
                resolveOld = r
            })
        return status({ balanceCredited: true })
    })
    await act(async () => document.querySelector('button[aria-label="Close"]').click())
    const reopen = [...document.querySelectorAll('button')].find(
        (button) => button.textContent === 'Продлить подписку'
    )
    await act(async () => reopen.click())
    assert.match(view.text(), /Оплата зачислена на баланс/)
    await act(async () => resolveOld(status({ status: 'succeeded' })))
    assert.doesNotMatch(view.text(), /Подписка продлена/)
    assert.equal(view.calls.filter(({ url }) => url.endsWith('/invoice/test-invoice')).length, 2)
    assert.equal(
        view.calls.some(({ options }) => options.method === 'POST'),
        false
    )
})
