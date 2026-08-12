# Security Policy / Política de Segurança

`fotos.lucafchala.com` is a single Cloudflare Worker — a public photo gallery
with an admin dashboard and LGPD photo-removal / image-use-consent flows. We
take the security and privacy of visitors' data seriously and welcome
responsible disclosure.

## Reporting a vulnerability / Como reportar

- **Email:** security@lucafchala.com
- **PGP:** [`48E7 3F6F A287 1E7B 86EF EA64 8EC4 329A 369B 7B33`](https://keys.openpgp.org/vks/v1/by-fingerprint/48E73F6FA2871E7B86EFEA648EC4329A369B7B33) — please encrypt sensitive reports.
- **Languages:** English, Português (pt-BR)

This policy is also published in machine-readable form at
[`/.well-known/security.txt`](https://fotos.lucafchala.com/.well-known/security.txt) (RFC 9116).

Please include a description of the issue and its impact, steps to reproduce
(a proof of concept, the affected URL/endpoint), and any logs, requests, or
screenshots that help. **Do not open a public GitHub issue for security
problems — email first**, and please give us a reasonable window to fix the
issue before any public disclosure.

> **PT-BR:** Encontrou uma falha de segurança ou um possível vazamento de dados
> pessoais (LGPD)? Envie um e-mail para **security@lucafchala.com** (de
> preferência cifrado com a chave PGP acima). **Não abra issue pública.**
> Inclua descrição, impacto e passos para reproduzir.

## Scope / Escopo

**In scope:**

- The production site `https://fotos.lucafchala.com` and its `*.workers.dev`
  deployment.
- The Worker code in this repository (`src/`): the admin dashboard
  (`/dashboard`), the public APIs (`/api/*`), and the LGPD removal/consent
  flows.

**Out of scope / known by design:**

- **Google Drive links are shareable.** Photos are delivered via Google Drive
  links. Once a legitimate visitor passes the consent gate, the link can be
  reshared — that is inherent to Drive sharing, not a vulnerability.
- **The ad-blocker fallback path is intentionally weaker.** The Drive gate
  (`POST /api/drive-link`) fail-closes on a real Turnstile token: a
  missing/invalid token returns 403 and the link is never included in the
  response. When the Turnstile script itself is blocked client-side (ad-blocker
  or JS disabled), the client falls back to a `turnstileToken: "noscript"`
  value — still a real POST per event, rate-limited on its own (tighter)
  key, and logged with `turnstile_ok=0` — instead of failing delivery
  outright for that audience. This is a conscious accessibility/delivery
  trade-off, not a bypass anyone can silently rely on for bulk scraping (it's
  rate-limited and audited), but it is a known, weaker path.
- **No per-page nonce yet on `/api/drive-link`.** The endpoint is rate-limited
  per IP but doesn't yet bind a request to having actually loaded that
  specific event page, so a script holding a valid Turnstile token could in
  principle probe multiple slugs within the rate limit. Tracked in
  [`TODO.md`](./TODO.md) (Etapa 3.1).
- Best-effort, non-atomic counters (`views`, `drive_clicks`): undercounting
  under load is expected.
- Rate limits are abuse-mitigation, not a hard guarantee.
- Automated-scanner output with no demonstrated impact, "best-practice" header
  nitpicks already covered by our CSP/HSTS, volumetric DoS, and
  social-engineering reports.

## Invariants for contributors / Invariantes ao mexer no código

Two guards are easy to half-apply. Both are pinned by tests (`tests/drive-gate.test.js`,
`tests/utils.test.js`) — if you change either, expect a red suite.

- **`safeUrl()` is a scheme allowlist, not an HTML escaper.** It strips
  `javascript:`/`data:` and upgrades `http:` — it does *not* escape quotes, so
  `https://x/" onload="…` passes through intact. Interpolating into an HTML
  attribute needs both: `escape(safeUrl(v))`. Assigning to a DOM property in the
  client (`el.href = v`) needs only `safeUrl()`, because no HTML is parsed.
  Neither function alone covers both attacks.
- **KV counters go through `toCount()`.** Counters are stored as plain strings;
  a corrupted value read back with a bare `parseInt` yields `NaN`, and
  `String(NaN)` written back poisons the counter permanently. `toCount()`
  accepts only a non-negative integer and falls back to `0` — it deliberately
  rejects partial garbage (`"12abc"`) rather than salvaging a prefix.

## Monitoring / alerting

The top-level `fetch()` handler catches any unhandled exception from any
route, returns a generic 500 to the visitor (with a link back to the gallery
and to `/suporte`, never a stack trace), and fires a best-effort email to
`ADMIN_EMAIL` via Resend (`sendErrorAlert()` in `src/utils.js`) — a tripwire
so an outage or regression is noticed without watching logs. The alert
contains only the error message, a truncated stack, and the route — never
request bodies, headers, or visitor IP — and is throttled by a single global
15-minute KV cooldown so a repeating failure can't flood the inbox. Alerting
itself is fully isolated: `sendErrorAlert()` never throws, and the response
already sent to the visitor never waits on it (`ctx.waitUntil`, best-effort).
No `RESEND_API_KEY`/`ADMIN_EMAIL` configured means alerting silently no-ops —
the site keeps working, you just won't be emailed.

Server-side features that depend on an optional integration (e-mail
notifications, Web Analytics) already fail closed to "not available" rather
than breaking the page they're on — see the `sendXEmail()` helpers in
`src/utils.js`, all of which catch their own errors and return `null`/`false`
instead of throwing into the caller.

## Response / Prazo de resposta

This is a personal project maintained by one person. We aim to **acknowledge
reports within 5 business days** and to fix confirmed, high-impact issues as
quickly as is reasonable. We'll keep you updated and are happy to credit you if
you'd like.

## Personal data (LGPD)

The site processes personal data for image-use consent and photo-removal
requests. The privacy policy is at
[`/privacidade`](https://fotos.lucafchala.com/privacidade); data-subject and
removal requests can be made through
[`/suporte`](https://fotos.lucafchala.com/suporte) or the contact above.
