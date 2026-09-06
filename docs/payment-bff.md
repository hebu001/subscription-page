# Subscription payment BFF

The browser talks only to the subscription-page origin:

```text
Browser -> /payment-api/* -> subscription-page backend -> bot /cabinet/subpage/*
```

The browser never receives the bot API base URL and cannot select a payment
provider. The BFF reloads the bot's ranked payment methods when an invoice is
created and selects the first supported method.

## Configuration

Generate one shared secret (at least 32 random characters):

```bash
openssl rand -base64 48
```

Subscription page:

```dotenv
PAYMENT_API_URL=https://api.example.com/cabinet/subpage
PAYMENT_BFF_SECRET=<shared-secret>
# Only needed when a CDN alias reaches the origin with another Host/SNI:
PAYMENT_ALLOWED_ORIGINS=https://cdn-sub.example.com
```

Bot backend:

```dotenv
SUBPAGE_PAYMENT_ENABLED=true
SUBPAGE_URL=https://sub.example.com
SUBPAGE_BFF_SECRET=<shared-secret>
```

Keep both servers synchronized with NTP. Signed requests are valid for 90
seconds, and each nonce can be consumed only once. Redis is required; nonce
validation fails closed when Redis is unavailable.

The public reverse proxy for the subscription-page hostname must send
`/payment-api/*` to the subscription-page container. Do not keep a Caddy/Nginx
handler that proxies this path directly to the bot, because that would bypass
the BFF session and same-origin checks.

`PAYMENT_ALLOWED_ORIGINS` is an exact allowlist, not a CORS wildcard. Values
must be HTTPS origins without paths, query strings, credentials, or fragments.
Leave it empty when the public browser origin and the origin-facing Host are
the same.

## Safe rollout and rollback

Deploy the subscription page first while the previous bot version is still
running, smoke-test renewal options and invoice creation through
`/payment-api`, and then deploy the HMAC-protected bot version.

Rollback in reverse order: restore the previous bot version first, then restore
the previous subscription-page version. This keeps the payment path available
throughout the rollback.

## Security properties

- The HttpOnly session is bound to the subscription `shortUuid`.
- State-changing browser requests require the backend-observed origin or an
  exact HTTPS origin from `PAYMENT_ALLOWED_ORIGINS`; cross-site fetch metadata
  is still rejected.
- Upstream requests use an HMAC over timestamp, nonce, subscription, client IP,
  HTTP method, path, and body hash.
- The bot rejects expired signatures and replayed nonces.
- Invoice status is bound to the same signed subscription.
- Upstream redirects are disabled and all responses are schema-validated.
- HTML, raw subscriptions, app config, and payment responses are marked
  private and `Cache-Control: no-store`.

## Concurrent subscriptions and expired sessions (F07)

Every rendered subscription issues its own `subpage_session_<hash>` cookie. The
hash includes the normalized custom prefix and subscription identifier. Cookies
remain HttpOnly, Secure, SameSite=Strict, host-only, and expire after 30 minutes;
the signed JWT retains its existing 33-minute expiry. `Path=/` lets the same
context cover both the prefixed payment API and unprefixed
`/assets/.app-config-v2.json`. No JWT is exposed to JavaScript.

Payment routes select the cookie for their `shortUuid`. The frontend config
request sends `X-Subpage-Short-Uuid` from its own rendered subscription data;
the config middleware verifies the corresponding signed owner before choosing
the config. Opening another subscription does not replace that context.

The legacy `session` cookie remains for common assets/locales and existing
clients. A missing scoped cookie can use a verified legacy cookie only for the
same subscription. Missing A with a fresh legacy B cookie returns 401 so A can
recover. Present invalid/expired scoped cookies never fall back. A deliberately
selected signed cookie belonging to another subscription is rejected with 404.
Selectorless config requests retain the legacy behavior; reload previously
opened clients to gain config isolation.

A 401 during options, invoice creation, status polling, or config bootstrap
offers an explicit page-refresh action. Polling stops, the invoice URL remains,
and the refresh reloads the same subscription and resumes the existing invoice
status check. Closing/reopening the payment dialog retains the recovery screen.
There is no automatic reload or invoice POST replay. Transient payment transport
errors retain the existing bounded polling behavior.

Deploy the BFF and frontend together. No bot API, HMAC, provider or database
change is required for F07. Rolling back these files reintroduces the original
multi-subscription behavior; retain the existing credited/review payment result
handling. Each recently opened subscription adds about 400 bytes to same-origin
Cookie headers (roughly 1.2 KB for two subscriptions plus legacy), until expiry.
The design covers concurrent subscriptions, not an unlimited cookie registry.

## Durable payment results (bot audit stage 2)

The invoice-status response now preserves these fields end to end:

| Field | Meaning | Default for older bot responses |
| --- | --- | --- |
| `balanceCredited` | Payment went to the account balance instead of renewal | `false` |
| `message` | Explanation for credited-only or manual-review orders | `null` |

A succeeded renewal still shows the new expiration. `failed` with
`balanceCredited: true` shows that the money is on the balance and offers the
configured HTTPS cabinet link. `failed` with a message but no credit shows a
review result. Neither screen suggests that the user should pay again. Backend
messages are rendered as plain text, limited to 1024 characters by the BFF.
Unknown upstream fields are still stripped. Ordinary failed/expired replies and
older responses without the new metadata remain supported.

Polling has one cancellable owner per invoice, a 10-second request timeout and a
five-minute overall deadline. Closing the dialog or changing/unmounting it
invalidates pending callbacks. Timeout and dismissal preserve the invoice URL;
reopening checks that invoice again. Only terminal results remove its URL
parameter. None of these status checks creates a new payment.

Deploy this BFF and frontend together **before** activating the bot's new
credited-only/review outcomes (bot migration `0103`, local fix `b102d831`). Keep
this result handling when rolling back UI changes after new orders exist. The
initial HMAC rollout instructions above do not authorize reverting migrations or
session revocation from later bot releases. Cabinet WS security requires its own
coordinated frontend/backend release with migration `0104`.

### Local verification

Use Node 22.18+ or a newer supported Node release for native TypeScript stripping.
`npm ci` installs the declared backend `tough-cookie` development dependency for
the shared cookie-jar tests. F07 adds no production dependency.

```sh
(cd backend && npm ci && npm run test:payments && npm run test:security && npm run test:logging && npm run build)
(cd frontend && npm ci && npm run test:payments && npm run start:build)
```

Contract tests exercise the real BFF service with an Axios adapter replacing
upstream HTTP. Frontend tests cover classification, cancellation and deadlines;
DOM tests render the actual widget and Mantine components through Vite/jsdom,
with HTTP and subscription context stubbed. They check Russian/English result
screens, safe links, plain-text messages, closing/reopening and late responses.
They do not call payment providers or test the production deployment.

F07 security tests run the real Nest controllers, RootService and guards behind
local panel/payment fixtures. A shared `tough-cookie` jar exercises default and
custom prefixes, concurrent opens completing in either order, selected configs
and payments, HttpOnly/Secure/expiry attributes, missing/expired/invalid/swapped
contexts, legacy compatibility and malicious origins. DOM tests also cover
manual recovery after options/create/status 401, close/reopen, and StrictMode
config bootstrap with real ofetch handling an empty HTTP 401 response. Deferred
options/status responses are tested in both orders for succeeded, credited and
review outcomes: a late options 401 cannot replace a terminal result, and expiry
stops pending status updates while preserving the invoice. DOM reload is observed
through a test stub; the backend test
separately reloads the same invoice URL and verifies no invoice creation. These
checks do not claim a full browser/provider return journey or deployed proxy
verification.

Independent Chrome verification adds 2 shared-cookie security scenarios and 8
React/HTTP recovery/ordering scenarios, using the actual cookie setter, guards,
stores, RootLayout, widget and ofetch with local upstream/payment fixtures.
Real manual reload resumes the same invoice GET without another POST; empty
config 401 and both response orders pass. Source hashes stayed stable for the
final frontend run; the backend hashes matched the earlier cookie run. A separate
actual-widget review reproducer also passes 1/1 after the late-options fix.
Evidence is in `../audit/frontend-backend-2026-09-06/fix-verification/` relative
to the repository root (`f07-session-review` and `subpage-session`). This covers
isolated Chrome and loopback HTTP, with no live provider or production proxy.

F07 local gate: backend build/full ESLint, 7 security cases, 6 payment contracts,
8 logging cases; frontend typecheck/production build, 34 payment/bootstrap DOM
cases, full ESLint and changed-file Prettier all pass. Full frontend Stylelint
still reports 48 violations in 9 existing CSS files. Those CSS files, Stylelint
configuration and frontend dependency files were left identical to the prior
commit; F07 introduces no CSS changes.
