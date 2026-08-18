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
- **No COEP header.** `Cross-Origin-Embedder-Policy: require-corp` would blank
  the gallery: the photos come from `lh3.googleusercontent.com`, which does not
  send CORP. Its absence is a decision, not an oversight.
- **HSTS is not `preload`ed.** `max-age` is two years with `includeSubDomains`,
  but submitting the domain to the preload list is a near-irreversible
  commitment covering the whole apex domain — that is the owner's call, not a
  side effect of a commit.
- **`'unsafe-inline'` is still in the enforced `script-src`.** See "CSP: two
  policies at once" below — this is a measured, staged migration, not an
  oversight.
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
- **Unlisted ≠ private.** A project toggled off ("Ocultar") leaves the gallery,
  the sitemap and the self-test, and is served with `X-Robots-Tag: noindex`,
  but **still opens on a direct link** — that is what keeps a preview link sent
  to a client working. If you need a project to be genuinely inaccessible,
  delete it or leave the Drive URL empty. Tracked in [`TODO.md`](./TODO.md) as
  a semantics decision.
- Best-effort, non-atomic counters (`views`, `drive_clicks`): undercounting
  under load is expected.
- Rate limits are abuse-mitigation, not a hard guarantee. In particular they
  **stop counting when KV refuses a write** — see "Rate limits fail open when KV
  cannot record them" below.
- Automated-scanner output with no demonstrated impact, "best-practice" header
  nitpicks already covered by our CSP/HSTS, volumetric DoS, and
  social-engineering reports.

## Controls / Controles

A map of what protects what. Every item is pinned by `tests/security.test.js` or
`tests/drive-gate.test.js`; the policy itself lives in one place, `src/security.js`.

| Control | Where | What it stops |
| --- | --- | --- |
| Same-origin gate on every write, **before routing** | `src/index.js` dispatcher | CSRF, including the same-site case a `SameSite=Strict` cookie still allows |
| Signed page nonce (HMAC, slug-bound, 2 h) | `/api/drive-link` | Sweeping every slug with one valid Turnstile token |
| Signed form token + honeypot | `/suporte`, removal form | Bots posting straight at the endpoints |
| `__Host-` session cookie | `sessionCookie()` | A neighbouring host on `lucafchala.com` planting a session |
| Session idle timeout + client binding | `verifySession()` | A stolen cookie staying useful for a full 24 h |
| Layered login rate limit + e-mail alert | `handleLogin()` | Silent brute force |
| Password policy (12+, classes, weak patterns) | `validatePassword()` | An offline attack against a leaked hash |
| CSV formula-injection guard | `csvCell()` | `=HYPERLINK(...)` in a visitor-supplied field executing in the admin's spreadsheet |
| EXIF/GPS stripping on uploads | `stripImageMetadata()` | A removal request handing us the GPS coordinates of the photo |
| `no-store` on every data response | `dataSecurityHeaders()` | Personal data sitting in a disk or intermediary cache |
| Restore sanitisation | `sanitizeRestoredRequest()`, `mergeRestore()` | A hand-edited backup planting junk shapes and `javascript:` URLs |
| Attachment filename sanitisation | `sanitizeFilename()` | Path traversal and CRLF in the MIME attachment header |
| Escape-before-format markdown rendering | `src/ui/markdown.js` | HTML in a compliance document becoming markup on the page |
| Link allowlist in rendered documents | `resolveDocHref()` | Dead links, `javascript:` targets, and any link off to GitHub |

### CSP: two policies at once

Every HTML response carries **both** `Content-Security-Policy` and
`Content-Security-Policy-Report-Only`, built from the same source
(`contentSecurityPolicy()`) so they cannot drift apart.

- The **enforced** policy allows `'unsafe-inline'` and carries **no nonce**.
  That combination is deliberate and load-bearing: per CSP Level 3, **a nonce
  makes the browser discard `'unsafe-inline'`**. So `'self' 'unsafe-inline'
  'nonce-abc'` is not "both" — it is effectively `'self' 'nonce-abc'`, and every
  `onclick="…"` attribute handler stops firing. The UI has ~63 of them, so that
  silently kills the gallery, the event page, the Drive gate and the dashboard.
  This was actually committed once and caught only by driving a real browser —
  a unit test asserting the policy *string* contains `'unsafe-inline'` passes
  happily while the browser ignores it.
- The **report-only** policy is the one we want to enforce — `'nonce-…'` with no
  `'unsafe-inline'`. Running it in report-only turns each remaining inline
  handler into a report at `/api/csp-report` instead of a broken element. It is
  the migration's task list, measured in production rather than guessed. The
  `nonce="…"` attributes in the markup exist for *this* policy.

**The flip happens when the reports stop arriving**: remove the inline handlers,
then let the enforced policy use `strict` too. Until then, a `<script>` without a
nonce is invisible today and breaks silently on flip day — so CI rejects one, and
the deploy smoke test rejects a nonce appearing in the enforced header
(`.github/workflows/security.yml`, `deploy.yml`).

### Rate limits fail open when KV cannot record them

`checkRateLimit()` reads a counter from KV and writes it back. The write is the
part that can be refused: the free tier allows **1000 KV writes per day for the
whole account**, and once that is spent KV rejects writes — as a thrown
exception — while reads keep working normally. A day of real traffic reaches
that ceiling on its own, because every visitor spends writes on the view counter
and on the Drive gate's own limiter.

Left unhandled, that exception propagated out of `checkRateLimit()` into the
top-level `fetch()` catch and became a **500 on `/api/drive-link`** — photo
delivery down for everyone, on the busiest day of the site's life — and a 500 on
`/dashboard/login`, locking the owner out at exactly the moment they would go
looking for the cause. Neither error said anything about a quota.

So the counter write is isolated, and a request whose limit check already passed
is allowed through when only the bookkeeping fails. This is a deliberate fail
**open**, in the same direction as `SIGNING_SECRET`: refusing every visitor's
photos in order not to let one extra request through is the worse side of the
trade, and rate limits here are abuse-mitigation rather than a guarantee. Two
things bound it:

- **A limit already exceeded still blocks.** Reads are unaffected by a spent
  write quota, so a counter that has passed the limit keeps refusing — the
  fail-open covers the request that was going to be allowed anyway, not a
  blanket bypass. Pinned by `tests/kv.test.js`.
- **It is never silent.** Every refused write is recorded
  (`noteKvWriteFailure()`), and `/api/healthz` reports it in `problems` until 30
  minutes pass with no new refusal — so the status dashboard goes red while
  counters and limiters are degraded, instead of the site quietly serving on
  with neither. The record is isolate-local and costs nothing: persisting it
  would need the very write that was just refused.

The other half is not spending the quota in the first place, and that is a
question of shape rather than of tuning: a counter written once per visitor
makes the site's cost grow with its audience, against a ceiling that does not
move. Three changes take that out:

- **Counters are aggregated, not written per request.** `views:` and
  `drive_clicks:` go through `bumpCounter()`, which sums increments in the
  isolate's memory and writes once per window (`flushCounters()`). A hundred
  visitors in the same minute cost one write per key instead of a hundred. What
  is lost is whatever is pending when an isolate dies — already-declared
  best-effort behaviour, and the daily cron flushes the tail. The pending map is
  bounded by the number of events, because callers validate the slug first, so
  no flood can grow it.
- **`/api/track-drive` no longer carries its own KV rate limit.** It cost a
  write to protect a write — doubling the price of the beacon rather than
  lowering it, the same reasoning `/api/perf` already states. With the counter
  aggregated, a flood adds no writes at all: the aggregation *is* the bound, and
  a better one, since it does not depend on the visitor's IP. What still
  contains abuse there costs nothing: the CSRF gate ahead of routing, and the
  slug having to name a real event that is not `comingSoon`.
- **Validation that costs nothing runs first.** `/api/track-drive` used to call
  `checkRateLimit()` before parsing the body, so junk POSTs burned quota while
  counting nothing. Same reasoning already applied to `handleLogin()`, which
  deliberately does not count an attempt the burst limiter already refused.

Measured over 200 simulated engaged visitors: **1.01 KV writes per visitor**,
down from 4, with the recorded counts exact (200 views, 200 clicks). The
remainder is `ratelimit:drive-link`, one per visitor — and that one stays, since
a limiter that does not persist immediately does not limit. The ceiling is now
set by a security control rather than by bookkeeping.

### The event list survives KV being unavailable

KV is the only hard dependency on the critical path: without the event list
there is no slug, no event, and no Drive link. A KV **read** outage used to take
the gallery, the project pages and the Drive gate down together, with a 500 —
the site's one promise, delivering photos, broken by an outage in a store it
consults only to find the right folder URL.

`getEvents()` now degrades in three steps, newest data first:

1. **The isolate's own cache, even expired.** It was previously discarded once
   past its 30 s TTL, so an isolate holding a perfectly good list answered 500
   the moment KV faltered. Thirty seconds stale is still the right list.
2. **A copy in the Cache API.** Free, no write quota, and — unlike module state
   — it lives in the colo rather than the isolate, which is what covers a *cold*
   isolate. That is the common case in an outage: new traffic lands on new
   isolates with nothing in memory.
3. **Rethrow.** With no cache and no copy there is nothing to serve. Returning
   an empty list here would turn an outage into "the site exists and has no
   projects" — 404 everywhere, `ok:true` on healthz, nothing red on the
   dashboard. Lying about having no data is worse than admitting the failure.

The copy is written only when the stored value changes, and only after KV has
accepted the write, so it can never contradict the source.

**What this costs, stated plainly.** While serving from the copy, the visitor
may see a list that is out of date: a project hidden, corrected, or deleted
*during the outage* still appears. In practice the window is the outage itself —
the copy is refreshed on any successful read of a changed value — and it is
bounded further by the fact that a KV that cannot be read usually cannot be
written either, so there is no new state to miss. The trade is deliberate:
delivering photos from a possibly-minutes-old list beats delivering nothing.

Two things that are **not** relaxed while degraded, both pinned by
`tests/drive-gate.test.js`: the Drive gate refuses exactly what it refuses
normally (missing consent, failed Turnstile, `comingSoon`, unknown slug), and
`/api/healthz` reports `kv:false` and flips `ok:false`, naming the degradation
in `problems`. The site staying up must never make the dashboard look green —
so the fallback increments a counter that healthz compares before and after its
own read, which tells it whether *that* read came from KV or from the copy,
rather than guessing from a time window.

### Outbound links: one exception only

Every legal and compliance document is served **from this site**, at
`/legal/<slug>`. The only link on the whole site that points to GitHub is the
footer's "Código-fonte". This is enforced in CI
(`.github/workflows/security.yml`), and the markdown renderer independently
demotes *any* `github.com` link found in a document to plain text
(`resolveDocHref` in `src/ui/markdown.js`) — so the rule holds even if someone
pastes one into a document later.

Why it matters here rather than being a style preference: sending a visitor to
a third-party service to read the policy that governs their own data is the
opposite of transparency, and an external link is a failure point outside our
control on the one page whose entire promise is being accurate.

### Rendering documents safely

`src/ui/markdown.js` is a purpose-built subset renderer, not a dependency. Its
security contract is one rule: **escape first, format second.** Every piece of
text goes through `escape()` before any formatting regex runs, so a `<script>`
in a document is already `&lt;script&gt;` by the time inline rules act and none
of them can reconstruct a tag. Doing it the other way round — format, then try
to clean up — is how markdown sanitizers usually fail. Pinned by
`tests/security.test.js`.

The document text itself is generated into `src/content/legal-docs.js` from the
markdown; CI regenerates and diffs it, so a published page can never drift from
the document it claims to reproduce.

Two link-handling rules inside the renderer are worth stating explicitly,
because they look inconsistent and are not:

- **Recognising this site's own host uses `new URL()` and compares `host`.** A
  `startsWith()` on the site URL would accept
  `https://fotos.lucafchala.com.example.com/` and
  `https://fotos.lucafchala.com@example.com/` — third-party hosts that merely
  begin with our name — and hand back the sliced remainder, which a browser
  reads as a relative path. Comparing a URL as a string is the same mistake
  that becomes an open redirect elsewhere.
- **Blocking `github.com` stays a substring match, deliberately.** The two
  checks have opposite signs: recognising our own host is a *permission*, where
  over-reach admits someone else's host; blocking GitHub is a *denial*, where
  over-reach at worst demotes a link to text. Failing safe points in a
  different direction in each case.

The link target is also unescaped in a **single pass**. Chained `replace` calls
(`&amp;` → `&`, then `&quot;` → `"`) strip two layers off `&amp;quot;` and
produce a real double quote — the character that closes the `href` attribute.
The emission-time `escape()` would still contain it, but a control that depends
only on the last step breaks the day someone edits the last step. All three
issues were found by CodeQL, not by manual review, and each is pinned by a
regression test verified to fail against the previous code.

## Two controls that failed silently, and how they were found

Both were found by code review over the whole change, then confirmed by
**driving the running site** — neither was visible in a green test suite.

**A sibling host could take the admin panel down.** `verifySession` matched
`(?:__Host-)?session=` in a single pattern, and `match()` returns the *first*
occurrence — so a plain `session=` cookie won over `__Host-session`. Any host
under `lucafchala.com` can write a domain cookie but **cannot** write a
`__Host-` one; that asymmetry is the entire point of the prefix. Writing 64
arbitrary hex characters was enough to lock the owner out. Confirmed against
the running panel: `/api/metrics` returned **401** under the hostile cookie
before the fix, **200** after. The `__Host-` cookie now takes precedence, and
login clears the legacy one (logout already did — the asymmetry was the bug).

**A removal request could email the requester's GPS coordinates.**
`isLikelyImage()` accepted HEIC, AVIF and GIF; `stripImageMetadata()` only
strips JPEG, PNG and WebP. Two lists, drifting apart in silence — and HEIC is
the iPhone default, so this was the common path, not the exotic one. Someone
asking to be *removed* from a photo was handing over where it was taken, while
the published privacy policy stated without qualification that metadata is
erased.

The fix is not a third list. The gate is now **the strip itself**: if
`stripImageMetadata` does not confirm a clean result, the attachment is refused.
Teaching the stripper HEIC later opens the gate on its own, with nobody having
to remember.

## Required secrets

`ADMIN_PASSWORD`, `TURNSTILE_SECRET_KEY`, `RESEND_API_KEY`, `ADMIN_EMAIL` and
**`SIGNING_SECRET`** — see `wrangler.toml` for what each does.

`SIGNING_SECRET` deserves a note: unlike the others, its absence **breaks
nothing**. The Drive page nonce and the form tokens simply stop being required,
and the site keeps serving as if it were protected. That is a deliberate
trade-off (a missing secret is a deploy error, and failing closed here would
take the whole photo delivery down over an *additional* layer), made safe by
never being silent: `auditSite()` flags it, and it shows up in `/api/healthz`
and on the status dashboard until someone runs:

```bash
npx wrangler secret put SIGNING_SECRET
```

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

The daily retention cron (`scheduled()` in `src/index.js`, `wrangler.toml`
`[triggers]`) now fires the same `sendErrorAlert()` when either of its two
prune tasks fails, not just `console.error` — a retention bug is as much a
"you should know about this" event as a request-path exception, and used to
be visible only in Cloudflare's logs or, indirectly, once the cron heartbeat
(`/api/healthz`'s `cron.stale`) aged past a day.

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

A public trust center is published at
[`/legal`](https://fotos.lucafchala.com/legal) (also `/compliance`), bringing
together the privacy policy, the terms, this policy, a plain-language summary of
what is done with each piece of data, the contact channels and the
machine-readable endpoints.

The full compliance pack — records of processing (ROPA), the data-protection
impact assessment (RIPD), the legitimate interest assessment (LIA), the
retention policy, the international-transfer mapping, the data-subject
request procedure, the incident response plan, and image-authorization
templates — is published at [`/legal`](https://fotos.lucafchala.com/legal).

**If you are reporting a personal-data incident**, follow
[`docs/legal/plano-resposta-incidentes.md`](./docs/legal/plano-resposta-incidentes.md)
— the ANPD notification window is **3 business days** from the moment the
controller becomes aware.
