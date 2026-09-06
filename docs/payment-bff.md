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
No new test dependencies are required.

```sh
(cd backend && npm ci && npm run test:payments && npm run test:security && npm run build)
(cd frontend && npm ci && npm run test:payments && npm run start:build)
```

Contract tests exercise the real BFF service with an Axios adapter replacing
upstream HTTP. Frontend tests cover classification, cancellation and deadlines;
DOM tests render the actual widget and Mantine components through Vite/jsdom,
with HTTP and subscription context stubbed. They check Russian/English result
screens, safe links, plain-text messages, closing/reopening and late responses.
They do not call payment providers or test the production deployment.
