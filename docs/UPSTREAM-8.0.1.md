# Subscription page 8.0.1 integration

Prepared 2026-10-24 for the existing test page at `sub2.evoevoevo.com`.

- Fork baseline: `d448ed0e7bd060e71590fd2161a6b7c8645daee1` (application baseline `6dbe938b`).
- Upstream tag: `8.0.1`, commit `9045728e6e197a2581c6da40f4f92b170a8bad53`.
- Branch: `codex/subpage-upstream-v8.0.1`.

The only textual conflict was import ordering in `template-engine.ts`. The merged
file matches upstream exactly and adds lazy `INCY_CRYPT1_LINK` support alongside
existing plain and Happ links. There is no mutually exclusive product behavior.
Both package versions and the frontend lockfile follow upstream; the fork's
self-contained Docker build also moves all three stages to Node 24.22.

Payment BFF, signed bot requests, same-origin/session guards, redacted logging,
private cache handling, payment status distinctions and custom UI are unchanged
from the deployed fork. Frontend adds four real template tests: INCY round trip,
plain/unknown tokens, Happ links and lazy evaluation of unused templates.

Local validation: 57 existing tests plus 4 template tests, both typechecks, lint
and formatting. The three existing frontend hook warnings remain. Server build
must run the same suites on Node 24.22 before activation. No invoices or paid
jobs are needed for validation. Deployment evidence is recorded outside Git in
`work/subpage-v8.0.1-20261024/`.

Only the existing test application is in deployment scope. Preserve remote
environment values, Caddy, certificates, bot/panel settings and other host
services. Retain the old image and source release for rollback.
