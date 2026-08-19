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
  cannot record them" below. They are not, however, optional: see the same
  section for why `/api/track-drive` keeps its per-IP limit even with counters
  coalesced.
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
- **It is never silent**, and that is a property of the whole system rather than
  of this one control. Anything that degrades calls `noteDegraded(label, detail)`,
  and `/api/healthz` reports every entry in `problems` until 30 minutes pass
  without a repeat — so the status dashboard goes red while the site is quietly
  serving on with counters and limiters switched off. This matters more here than
  in a system that simply falls over: **everything below is designed to keep
  delivering photos while pieces fail, which means "the site is up" is not
  evidence that anything is fine.** The alarm is what closes that gap.

  It is one recorder on purpose. It began as two — one for KV, one for the events
  fallback — and the third case (the consent log) was about to be a third. Three
  places to remember to raise an alarm is how an alarm gets forgotten; with one,
  a new degradation anywhere in the code appears on the dashboard without anyone
  editing `auditSite()`. `noteKvFailure()` is a thin wrapper that records **which
  operation** failed, because the message names a cause: a failed *read* logged
  as a write made healthz assert "probably out of daily write quota" for a fault
  with nothing to do with the write quota, sending whoever investigates to the
  wrong place mid-incident. The record is isolate-local and costs nothing:
  persisting it would need the very write that was just refused.

The other half is not spending the quota in the first place, and that is a
question of shape rather than of tuning: a counter written once per visitor
makes the site's cost grow with its audience, against a ceiling that does not
move. Three changes take that out:

- **Counters coalesce under concurrency, and only under concurrency.** `views:`
  and `drive_clicks:` go through `bumpCounter()`, which writes through unless the
  same key was written less than a second ago — a floor matching KV's own limit
  of one write per second per key, which the paid plan does **not** lift.
  Whatever the floor defers is drained by a scheduled `waitUntil`, so it never
  depends on another request happening to arrive. Measured: spread-out traffic
  costs 4 writes per engaged visitor with counts exact; forty visitors arriving
  together cost 2.1, also exact, because forty view increments collapse into two
  writes. Two earlier designs got this wrong, both silently — deferring the
  *first* increment lost the count outright on sparse traffic (the isolate dies
  before a second one, and the daily cron cannot rescue it: different isolate,
  empty map), and a *single* window timestamp shared across keys let the first
  key to write block every other one, so a burst's tail was never written at all
  — fifty visitors recorded as one. The pending map is bounded by the number of
  events, because callers validate the slug first, so no flood can grow it.
- **`/api/track-drive` keeps its per-IP rate limit**, and an attempt to drop it
  is worth recording as a mistake. The reasoning was "the aggregation is the
  bound now, so a flood adds no writes." It does not hold: coalescing is bounded
  by a per-key floor of one second, so a sustained flood still costs up to sixty
  writes a minute on that key — far past a 1000/day quota. Coalescing lowers the
  cost per request, not the cost per hour, and the cost per hour is what an
  attacker controls. Without a per-IP limit the public endpoint becomes the
  cheapest way to drain the very quota this section is about, and leaves
  `drive_clicks` forgeable by curl, since the CSRF gate deliberately passes
  clients that send no browser headers.
- **Validation that costs nothing runs first.** `/api/track-drive` used to call
  `checkRateLimit()` before parsing the body, so junk POSTs burned quota while
  counting nothing. That reorder is the real saving, and it is intact: junk
  POSTs now cost zero writes. Same reasoning already applied to `handleLogin()`,
  which deliberately does not count an attempt the burst limiter already refused.

### The consent log fails loudly now

`POST /api/drive-link` writes one row per acceptance to D1, and that row is the
non-repudiation evidence behind the whole LGPD posture: which Terms text, which
version, which declaration, when, by whom. The write is `ctx.waitUntil` and
best-effort by design — refusing a visitor their photos because *our* audit log
is down punishes the wrong person — but "best-effort" had come to mean "and
nobody finds out". A failed insert logged one line to `console.error` and the
site carried on looking perfect.

That is the worst failure mode in the system: the photos are delivered, the
consent that authorised delivering them is not recorded, and nothing anywhere
says so. It now fails on both channels — `sendErrorAlert()` emails the owner
(globally throttled to one per 15 minutes, and it never throws) and
`noteDegraded()` puts it on `/api/healthz`, which the status dashboard turns
into an alert. Pinned by `tests/drive-gate.test.js`, verified failing against
the previous `console.error`.

### Logout says so when it does not actually revoke

`POST /dashboard/logout` deletes the session record from KV. That delete is not
housekeeping — **it is the revocation**. The cookie is cleared in the browser
either way, so someone who clicks "sair" lands on the login screen and believes
they are out, while the token stays accepted by the server until its 24-hour TTL
runs out. Anyone holding a copy taken before the logout keeps the panel.

The timing is the sharp part: a KV **delete spends write quota** like a `put`
does, so the day of heavy traffic — the day the 1000/day account ceiling is
actually reached — is the day logging out can quietly stop revoking. And the
`Clear-Site-Data` header two lines below names the scenario the handler has in
mind: a borrowed computer.

Failing here must not interrupt the logout (leaving the admin signed in *in the
browser* is the worse outcome), so the redirect and both cookie clears happen
regardless. What changed is that it is no longer a `console.error` nobody reads:
the failure goes to `noteDegraded()` — so `/api/healthz` reports it and the
status dashboard goes red — and to `sendErrorAlert()`. Pinned by
`tests/kv.test.js`, verified failing against the previous code.

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

**The fallback is for visitors only.** `getEvents(env, true)` — the `fresh` read
used by every admin path and every read-modify-write — never falls back; it
propagates. Serving a stale list there is not graceful degradation, it is a
staged data loss: the `saveEvents` that follows would write the old list back
over the new one, deleting every project changed since the copy was taken.
Failing costs the owner an error message; the alternative costs the projects.

Two things that are **not** relaxed while degraded, both pinned by
`tests/drive-gate.test.js`: the Drive gate refuses exactly what it refuses
normally (missing consent, failed Turnstile, `comingSoon`, unknown slug), and
`/api/healthz` reports `kv:false` and flips `ok:false`. The site staying up must
never make the dashboard look green. Because healthz reads with `fresh`, that
`kv` flag is measured by its own read rather than inferred: an earlier version
compared a module-global fallback counter before and after, and since that state
is shared by every request in the isolate, one *concurrent* visitor falling back
made healthz answer 503 and fail the deploy smoke test while its own read had
succeeded. The visitor-side degradation is still reported, as an advisory line in
`problems` with a time window — which is all module state can honestly claim.

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
