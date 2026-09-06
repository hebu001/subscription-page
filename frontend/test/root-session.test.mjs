import { act, createElement, StrictMode } from 'react'
import { after, before, test } from 'node:test'
/* global globalThis */
import { createRoot } from 'react-dom/client'
import assert from 'node:assert/strict'
import { createFetch } from 'ofetch'
import { createServer } from 'vite'
import { JSDOM } from 'jsdom'

let dom
let vite
let RootLayout
before(async () => {
    dom = new JSDOM('<html><body></body></html>', {
        url: 'https://subpage.example/private/aaaaaaaa?invoice=existing'
    })
    for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element']) {
        Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true })
    }
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    const stubs = {
        '@entities/subscription-info-store':
            'export const useSubscriptionInfoStoreActions = () => ({setSubscriptionInfo: value => globalThis.rootSessionSubscription = value}); export const useSubscriptionInfoStoreInfo = () => ({subscription:null});',
        '@entities/app-config-store':
            'export const useAppConfigStoreActions = () => ({setConfig: () => {}}); export const useIsConfigLoaded = () => false;',
        '@shared/ui': 'export const LoadingScreen = () => "Loading";',
        '@shared/utils/subscription-session':
            "export { isSessionExpired, sessionRecoveryText } from '/src/shared/utils/subscription-session.ts'; export const reloadSubscriptionPage = () => globalThis.rootSessionReloads.push(window.location.href);",
        'root-session-fetch':
            'export const ofetch = (...args) => globalThis.rootSessionFetch(...args);'
    }
    vite = await createServer({
        configFile: false,
        optimizeDeps: { noDiscovery: true, include: [] },
        server: { middlewareMode: true, ws: false },
        plugins: [
            {
                name: 'root-session-test-fixtures',
                enforce: 'pre',
                transform(code, id) {
                    return id.endsWith('/root.layout.tsx')
                        ? code.replace("from 'ofetch'", "from 'root-session-fetch'")
                        : null
                },
                resolveId(id) {
                    return id in stubs ? `\0root-session:${id}` : null
                },
                load(id) {
                    return id.startsWith('\0root-session:')
                        ? stubs[id.slice('\0root-session:'.length)]
                        : null
                }
            }
        ]
    })
    RootLayout = (await vite.ssrLoadModule('/src/app/layouts/root/root.layout.tsx')).RootLayout
})
after(async () => {
    await vite?.close()
    dom?.window.close()
})

test('StrictMode bootstrap selects its subscription and real ofetch empty401 offers manual URL-preserving reload', async (t) => {
    const calls = []
    globalThis.rootSessionReloads = []
    globalThis.rootSessionFetch = createFetch({
        fetch: async (url, options) => {
            calls.push({ url, options })
            return new Response('', { status: 401 })
        },
        Headers,
        AbortController
    })
    const bootstrap = document.createElement('div')
    bootstrap.id = 'sbpg'
    bootstrap.dataset.panel = window.btoa(
        JSON.stringify({ response: { user: { shortUuid: 'aaaaaaaa' } } })
    )
    document.body.append(bootstrap)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    t.after(async () => {
        await act(() => root.unmount())
        container.remove()
    })
    await act(async () => root.render(createElement(StrictMode, null, createElement(RootLayout))))
    assert.equal(calls.length, 1)
    assert.equal(calls[0].options.headers.get('X-Subpage-Short-Uuid'), 'aaaaaaaa')
    assert.equal(calls[0].options.retry, 0)
    assert.match(calls[0].url, /^\/assets\/\.app-config-v2\.json\?v=/)
    assert.equal(globalThis.rootSessionSubscription.subscription.user.shortUuid, 'aaaaaaaa')
    assert.match(document.body.textContent, /Session expired/)
    assert.equal(globalThis.rootSessionReloads.length, 0)
    await act(async () => document.querySelector('button').click())
    assert.deepEqual(globalThis.rootSessionReloads, [
        'https://subpage.example/private/aaaaaaaa?invoice=existing'
    ])
    assert.equal(calls.length, 1)
})
