# Custom subscription page: upstream 8.0.0 integration

## Scope and pinned revisions

Prepared on 2026-09-28 in branch `codex/subpage-upstream-v8.0.0` for the test subscription-page server `159.194.246.156`, domain `sub2.evoevoevo.com`.

| Revision | Commit |
|---|---|
| Deployed custom 7.2.6 baseline, `codex/mandatory-fixes-20260906` | `dcbde9ec1da6c11b10aeba2caeda68e51a48f3b0` |
| Common upstream 7.2.6 base | `5fefecdb0a610e6b4a7b286d31b9dc2adef69146` |
| Upstream Git tag `8.0.0`, equal to fetched upstream main | `2a125d180240bb4f373871daf1100f9bb0e2ae3f` |

The comparison contains 10 upstream commits and 22 custom commits after the common base. The target is an official Git tag; GitHub's latest-release endpoint returned 404, so no published GitHub Release is asserted. No mutually exclusive product-logic choice was identified during this merge.

**Status at documentation time: local integration and independent frontend/backend/source review passed with no blockers; this version has not been deployed.** Production services are outside this change. Live rollout results must be recorded separately before claiming installation success.

## Integration and retained behavior

Upstream replaces RootModule with WebpageModule, SubscriptionModule and optional MarzbanModule; builds the backend with Rspack/SWC to `dist/main.js`; traces runtime dependencies into `dist`; and introduces loopback-only `/internal/health`. The new backend contract package is 3.1.1 and subscription-page types are 0.5.0. Subscription URLs still use shortUuid; they must not be replaced by numeric panel user IDs.

The custom behavior is retained in the new module layout:

- PaymentBffModule remains server-side and is imported directly in AppModule. The browser supplies only a period. The BFF refetches authorized options and selects the first supported method in the bot's order; it does not expose provider selection, panel tokens or the bot signing secret.
- Signed bot requests, response validation, timeout/no-redirect behavior and payment outcome distinctions remain intact. Provider-return navigation is not payment confirmation. Credited balance and manual review do not claim subscription renewal or offer an unsafe repeat payment.
- Scoped HttpOnly/Secure/SameSite=Strict subscription cookies and supported legacy fallback remain. Each tab selects its config with `X-Subpage-Short-Uuid`; wrong-owner or expired sessions are rejected. Explicit recovery reload preserves the exact subscription and invoice URL.
- The production request pipeline parses cookies for assets and payments, preserves Host/protocol/trusted client IP for same-origin guards, and filters only copies of headers forwarded to the panel. It retains optional CSP, the explicit 32 KB JSON limit, and redacted access/application logs.
- Subscription HTML, personalized config, payment responses and raw client exports retain private/no-store handling. Raw panel bytes are forwarded without JSON/text conversion; custom no-store overrides upstream cache headers.
- The black/orange custom theme, typography, cards, renewal modal and existing installation flows remain. Panel-driven app configuration, plain links and Happ crypt3/crypt4 templates remain authoritative. The committed default app-config JSON was compared structurally with the deployed baseline and is identical after formatting.
- The renewal poller retains cancellation, late-response guards, timeout/401 recovery and same-invoice resume. Upstream's Spinner API change from `speed` to `duration` is applied.

Upstream dependency/tooling versions are retained, with custom test runners restored. Production backend build explicitly sets `NODE_ENV=production` so Rspack does not include the development HMR path when that environment variable is absent.

## Verification and limits

Local checks use Node 24.19; the image uses upstream Node 24.18. Both packages passed typecheck, lint, formatting and production build. Frontend lint reports three existing set-state-in-effect pattern warnings and no errors; backend lint reports no diagnostics. The frontend build successfully downloaded its font assets. Backend dependency tracing completed.

| Suite | Passed |
|---|---:|
| Frontend payment/status/session tests | 34 |
| Backend session/security HTTP tests | 9 |
| Backend payment contract tests | 6 |
| Backend safe logging tests | 8 |
| Total automated tests | 57 |

There were no failed or skipped tests in these runs. Backend HTTP tests exercise the actual new modules and shared production request middleware with a synthetic panel: valid/rejected payment requests, default and nested prefixes, two simultaneous subscription sessions, expiry and owner binding, trusted client IP, raw binary bytes, cache headers and loopback health.

An independent Chrome check exercised the built frontend in 12 synthetic desktop/mobile cases: payment selection, pending, credited-only, succeeded, failed and expired-session views at 390px and 1440px. It recorded no page errors or horizontal overflow. External network was blocked; screenshots confirmed custom styling and the distinction between balance credit and renewal. This does not constitute a real payment-provider or full paid end-to-end test.

Evidence outside the repository is in workspace directories `work/subpage-upstream-audit-20260928/` and `work/subpage-upstream-verification-20260928/`. Independent backend/source review subsequently passed: all 57 tests and typecheck/lint/format/build/trace checks exited successfully, with no blocking findings. Live container verification remains a separate pending gate.

## Self-contained image build

From the repository root:

```sh
docker build -f Dockerfile.selfbuild -t test-subscription-page:<verified-commit> .
```

The Dockerfile runs frozen-lockfile `npm ci`, frontend typecheck and all 34 frontend tests before its production build. The backend stage runs typecheck, security/payment/logging suites, production build and dependency tracing. A stage dependency completes the frontend before heavy backend work. Each builder uses a 2048 MiB Node heap limit; this is a per-process limit, not an aggregate container memory cap. Monitor memory on the test host and do not disturb its unrelated remnanode container.

`Dockerfile.selfbuild.dockerignore` excludes local node_modules/dist, Git metadata, environment secrets and logs, while retaining test files. Runtime receives compiled artifacts and traced dependencies. Existing PM2 runtime behavior remains unchanged. The image healthcheck requests the actual loopback HTTP health route; deployment must not override it with the old weaker TCP-only probe.

## Live dependencies and rollout requirements

Read-only server checks observed Remnawave **3.4.4** and successful authenticated metadata/config-list responses. The configured bot health endpoint reports **3.66.0**. Static BFF contract review used bot source `741feec565f9c7046ab73566d61f4a9d7fdf68f4`; that source review does not prove which bot commit is currently deployed.

Preserve remote environment values, panel-managed app configuration, existing API token and HMAC secret. The subscription-page token cannot enumerate users; do not widen its permissions just to find a test subscription. Valid subscription-link checks must avoid logging identifiers or subscription content.

Before rollout, retain the previous immutable image and release, and back up deployment configuration and secrets only on the server with restricted permissions. Build a new uniquely tagged candidate, check it on loopback, and replace only the subscription-page application service. Preserve Caddy, TLS volumes, remnanode and all other test services. Rollback switches the application back to the retained image/configuration and release link.

Post-switch verification must include real HTTP health, a valid subscription HTML/config/client export, session rejection and authenticated read-only renewal options. No invoice creation or charge has been performed by the checks documented here. Root or invented-invalid-link 502 responses are not a valid-page health criterion: the inherited not-found behavior closes the connection.
