import { decryptLink } from '@incy/link-encoder/sync'
import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createServer } from 'vite'

let vite
let TemplateEngine
before(async () => {
    vite = await createServer({
        configFile: false,
        optimizeDeps: { noDiscovery: true, include: [] },
        server: { middlewareMode: true, ws: false }
    })
    TemplateEngine = (await vite.ssrLoadModule('/src/shared/utils/template-engine.ts'))
        .TemplateEngine
})
after(async () => vite?.close())

const meta = {
    subscriptionUrl: 'https://sub.example/private/test?lang=ru&label=%D0%A2%D0%B5%D1%81%D1%82',
    username: 'Test user'
}

test('INCY template round-trips the exact subscription URL without exposing it in the link', () => {
    const link = TemplateEngine.formatWithMetaInfo('{{INCY_CRYPT1_LINK}}', meta)
    assert.match(link, /^incy:\/\/crypt1\//)
    assert.equal(decryptLink(link).url, meta.subscriptionUrl)
    assert.ok(!link.includes(meta.subscriptionUrl))
})

test('plain links, username and unknown template tokens retain their behavior', () => {
    assert.equal(
        TemplateEngine.formatWithMetaInfo('{{USERNAME}}|{{SUBSCRIPTION_LINK}}|{{UNKNOWN}}', meta),
        `${meta.username}|${meta.subscriptionUrl}|{{UNKNOWN}}`
    )
})

test('Happ crypt3 and crypt4 still produce client links', () => {
    for (const version of [3, 4]) {
        const link = TemplateEngine.formatWithMetaInfo(`{{HAPP_CRYPT${version}_LINK}}`, meta)
        assert.match(link, new RegExp(`^happ://crypt${version}/`))
        assert.ok(!link.includes(meta.subscriptionUrl))
    }
})

test('unused encrypted templates stay lazy for metadata-only formatting', () => {
    assert.equal(
        TemplateEngine.formatWithMetaInfo('{{USERNAME}}', {
            username: 'Test',
            subscriptionUrl: ''
        }),
        'Test'
    )
})
