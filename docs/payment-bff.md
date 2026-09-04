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
