# Cifra — Architecture

Status: living document. This is the single authoritative description of what
Cifra is, what it must do, and how it is built. GitHub issues reference it as
`Governed by: docs/architecture.md §<Section>`.

Cifra is a public restart of an archived v1 prototype. The v1 planning corpus
(product definition, the v1 requirement set, 9-phase roadmap, bank-parsing ADR)
is ported here; all v1 code and UI is rebuilt from scratch. Where v1 documents and
the 2026-08-23 restart design spec disagree, **this document reflects the
restart spec** — the superseded v1 choices are called out inline.

## Section index

| Reference | Section | Covers |
|---|---|---|
| §Product | [Product](#product) | Core value, target user, non-goals |
| §Requirements | [Requirements](#requirements) | The 68 v1 requirement IDs |
| §Roadmap | [Roadmap](#roadmap) | 9 phases, goals, success criteria |
| §Decisions | [Decisions](#decisions) | D1–D26 + carried-over v1 decisions |
| §Stack | [Stack and layering](#stack-and-layering) | Dependencies, layer contract |
| §Crypto | [Crypto and data layer](#crypto-and-data-layer) | Key hierarchy, middleware, allowlist |
| §Import | [Bank import](#bank-import) | Parser registry, detection, profiles |
| §Workflow | [Workflow](#workflow) | Labels, sprints, review gates, `verify` |

---

## Product

**Core value.** Users see exactly where their money goes — bank transactions,
cash expenses, and savings goals — in a single encrypted, offline-capable
interface that never exposes financial data to servers.

**Name.** *Cifra* is Italian for "figure/number" and the root of *cifrare*, to
encrypt. The app counts money and protects it.

**Target user.** Italian households managing salary plus freelance income across
mixed payment methods (bank card, cash, ATM) and saving toward concrete goals.
Italian-market specifics are first-class, not localisation afterthoughts: EUR
with `it-IT` formatting (`1.234,56 €`), Italian bank export formats, Italian
default expense categories, EN + IT interface.

**Privacy model.** Local-first. Financial data lives in the browser's IndexedDB,
encrypted at rest with a key derived from a master password the server never
sees. Firebase provides identity only. There is no server-side plaintext, no
Open Banking aggregator, and no analytics on financial content.

**Non-goals for v1.**

- AI features — auto-categorisation, receipt scanning, PDF-import-via-AI-vision.
  The architecture leaves room (parser registry, AI provider setting) but ships
  no implementation. This explicitly defers the PDF path from v1's ADR-003.
- OFX/QIF parsers — niche in the Italian market; the parser registry makes them
  additive later.
- Open Banking APIs (Plaid/TrueLayer) — defeats the privacy premise, needs
  PSD2/AISP licensing, poor Italian coverage.
- Native mobile apps — the PWA covers the use case.
- Multi-currency, dark mode, plain-CSV export, shared/multi-user accounts,
  investment tracking, push notifications, gamification, on-device OCR.

---

## Requirements

68 v1 requirements. IDs are stable and are the unit of traceability from issues
and PRs. Checkbox state is deliberately absent: v1 "complete" markers do not
carry over to this repo, where every requirement is unimplemented until landed
here.

> The archived v1 requirements document states a coverage total of "56". That
> figure is a stale miscount: its own list and traceability table both contain
> 68 v1 IDs (the count was never updated after Bank Import was expanded and
> moved to Phase 2). **68 is the correct number** and is what this document and
> the issue tracker use. The two v2-only analytics IDs (ANLY-05, ANLY-06) are
> excluded, as are all AI-\* and MISC-\* v2 IDs.

### Foundation (FOUN, 11)

- **FOUN-01** — User can sign in with Google (Firebase Auth, identity only).
- **FOUN-02** — Vault master key established on first setup; 256-bit, non-extractable.
- **FOUN-03** — Master key derived from a master password via Argon2id with a
  per-user random salt (supersedes v1's PBKDF2 uid + device-secret KEK).
- **FOUN-04** — All financial data encrypted at rest in IndexedDB via a custom
  Dexie 4 DBCore middleware (supersedes v1's `dexie-encrypted`).
- **FOUN-05** — App works offline after first load (service worker + Workbox).
- **FOUN-06** — App installable as a PWA (manifest + install prompt).
- **FOUN-07** — UI supports English and Italian with browser auto-detection.
- **FOUN-08** — Editorial Italiana design language (Cormorant Garamond, IBM Plex,
  cream/ink palette) expressed as semantic Tailwind 4 `@theme` tokens.
- **FOUN-09** — Responsive layout: mobile bottom nav below 900px, desktop sidebar at/above.
- **FOUN-10** — Vault key wiped on sign-out, tab close, and 30-minute idle.
- **FOUN-11** — All amounts stored as integer cents; no floating-point money.

### Bank import (IMPT, 9)

- **IMPT-01** — User can import a bank statement from a CSV file.
- **IMPT-02** — User can import a bank statement from an Excel file (.xlsx/.xls).
- **IMPT-03** — User can map columns (date, description, amount, type).
- **IMPT-04** — User can select a built-in Italian bank profile (Banca Intesa, UniCredit, Fineco).
- **IMPT-05** — User can save a custom column mapping as a named profile.
- **IMPT-06** — User can preview transactions before confirming the import.
- **IMPT-07** — Duplicate transactions detected and skipped on ingest (date + description + amount).
- **IMPT-08** — User sees an "X new, Y duplicates" summary in the preview.
- **IMPT-09** — Import history tracked (date, profile, format, count).

### Transactions (TXNS, 8)

- **TXNS-01** — User can add a manual expense in electronic mode.
- **TXNS-02** — User can add a manual expense in cash mode.
- **TXNS-03** — User can add a planned expense that auto-converts after a 3-day grace period.
- **TXNS-04** — User can view a combined transaction list sorted by date.
- **TXNS-05** — User can search transactions by description and category.
- **TXNS-06** — User can edit a transaction's category inline, saving a rule for future matches.
- **TXNS-07** — Italian default categories (Alimentari, Trasporti, Bollette, …).
- **TXNS-08** — EUR formatting with Italian conventions (`1.234,56 €`).

### Cash wallet (CASH, 5)

- **CASH-01** — User can see the current cash wallet balance (always derived, never stored).
- **CASH-02** — User can declare actual cash on hand (wallet audit) and see the mismatch.
- **CASH-03** — User can record received cash (gifts, found money).
- **CASH-04** — User can write off a wallet mismatch as unrecoverable.
- **CASH-05** — User can view the full cash movement history.

### Reconciliation (RECN, 4)

- **RECN-01** — Reconciliation engine runs automatically after each import.
- **RECN-02** — Auto-reconcile at 95%+ confidence (Levenshtein description + amount + date).
- **RECN-03** — Suggest matches in the 70–94% confidence band for user review.
- **RECN-04** — User can override bank data on a reconciled record (`overrideBank` flag).

### Analytics (ANLY, 4)

- **ANLY-01** — Overview page shows a stat strip (income, bank spend, cash spend, net).
- **ANLY-02** — Cumulative spend area chart for the current month.
- **ANLY-03** — Top-5 category breakdown with a cash overlay.
- **ANLY-04** — Surplus callout showing the formula and linking to goals.

### Budgets (BDGT, 3)

- **BDGT-01** — User can set a monthly budget per category.
- **BDGT-02** — Budget bars show bank spend + cash spend + planned overlay.
- **BDGT-03** — Over-budget categories highlighted with the overage amount.

### Savings goals (GOAL, 6)

- **GOAL-01** — User can create a target goal (amount + deadline + emoji).
- **GOAL-02** — User can create a habit goal (benchmark category).
- **GOAL-03** — Goal progress shown as a ring chart (target) or delta bar (habit).
- **GOAL-04** — User can set a monthly EUR target per goal.
- **GOAL-05** — Surplus distributed across goals via four strategies (weighted/priority/equal/deadline).
- **GOAL-06** — Strategy selector updates allocations live.

### Forecasting (FCST, 3)

- **FCST-01** — Recurring transactions detected (Levenshtein + amount-variance matching).
- **FCST-02** — Rolling 3-month averages per category.
- **FCST-03** — Projected month-end balance displayed.

### Sync (SYNC, 6)

- **SYNC-01** — Encrypted relay sync via Firestore (delta blobs, 30-day TTL).
- **SYNC-02** — Sync triggers: 2s debounce, foreground, network restore, 5-minute heartbeat.
- **SYNC-03** — Conflict resolution: bank wins amount/date, user wins category/notes.
- **SYNC-04** — QR device pairing (ECDH P-256, one-time, 5-minute expiry).
- **SYNC-05** — Sync mode selector (relay / P2P / local-only).
- **SYNC-06** — Sync status indicator in the UI (synced/dirty/syncing/offline/error).

### Account and settings (ACCT, 9)

- **ACCT-01** — Account page with profile info (photo, name, email).
- **ACCT-02** — Language selector (System / English / Italiano).
- **ACCT-03** — Sync and devices management (mode selector, linked devices, force sync).
- **ACCT-04** — Encrypted backup export (JSON snapshot).
- **ACCT-05** — Encrypted backup restore.
- **ACCT-06** — Sign out, clearing the vault key from memory.
- **ACCT-07** — Delete-all-data option.
- **ACCT-08** — PWA install prompt banner.
- **ACCT-09** — WCAG 2.1 AA accessibility (keyboard navigation, ARIA labels, 4.5:1 contrast).

**Coverage:** 68 v1 requirements (11 + 9 + 8 + 5 + 4 + 4 + 3 + 6 + 3 + 6 + 9),
all mapped to a phase in §Roadmap, none unmapped.

---

## Roadmap

Nine phases. The encrypted foundation comes first because crypto cannot be
retrofitted; bank import comes second so the app can be populated with real data
immediately; sync comes late because it touches the whole data model.

Phases are tracked as `phase:N` issue labels, not milestones (see §Workflow).

### Phase 1 — Encrypted Foundation

**Requirements:** FOUN-01 … FOUN-11
**Goal:** users can sign in and every data operation runs against an encrypted
local database inside an offline-capable, installable PWA with the Editorial
Italiana design language.
**Success criteria:** sign-in lands on the styled app shell; data written to
IndexedDB is encrypted and unreadable via DevTools; the app loads cached content
offline; the app is installable; the UI renders correctly in EN and IT.

### Phase 2 — Bank Import

**Requirements:** IMPT-01 … IMPT-09
**Depends on:** Phase 1
**Goal:** users can import CSV and Excel bank statements with built-in Italian
bank profiles and automatic duplicate detection.
**Success criteria:** an imported CSV/XLSX lands in the encrypted DB; a built-in
profile can be chosen or columns mapped manually; a custom mapping can be saved
as a named profile; the preview shows "X new, Y duplicates"; import history is
viewable.

### Phase 3 — Transaction Loop

**Requirements:** TXNS-01 … TXNS-08
**Depends on:** Phases 1, 2
**Goal:** users can track expenses manually and browse all transactions in a
searchable, inline-editable list with Italian category defaults.
**Success criteria:** electronic, cash, and planned entry modes all work; the
combined list is date-sorted and searchable by description or category; inline
category changes persist as a reusable rule; planned entries auto-convert after
the 3-day grace period; amounts display in Italian EUR format.

### Phase 4 — Cash Wallet

**Requirements:** CASH-01 … CASH-05
**Depends on:** Phase 3
**Goal:** users track physical cash separately from bank data, with a derived
balance, audit capability, and full history.
**Success criteria:** the balance is computed from cash transactions and never
stored; declaring cash on hand surfaces the mismatch; a mismatch can be written
off and adjusts the balance; the full cash history is viewable.

### Phase 5 — Reconciliation

**Requirements:** RECN-01 … RECN-04
**Depends on:** Phases 2, 3
**Goal:** manual entries are matched against imported bank transactions, with
high-confidence matches auto-resolved and uncertain ones queued for review.
**Success criteria:** reconciliation runs automatically after import; 95%+
matches auto-reconcile; 70–94% matches are presented for approval; the user can
override bank data when the manual entry is more accurate.

### Phase 6 — Analytics and Budgets

**Requirements:** ANLY-01 … ANLY-04, BDGT-01 … BDGT-03
**Depends on:** Phase 3
**Goal:** users see where money goes via an overview dashboard, and set
per-category monthly budgets with visual progress.
**Success criteria:** the stat strip shows income, bank spend, cash spend, net;
the cumulative chart and top-5 breakdown with cash overlay render; the surplus
callout shows its formula and links to goals; budgets show dual-layer progress;
over-budget categories are highlighted with the overage.

### Phase 7 — Savings and Forecasting

**Requirements:** GOAL-01 … GOAL-06, FCST-01 … FCST-03
**Depends on:** Phase 6
**Goal:** users create savings goals, distribute surplus across them, and see
projected month-end balances from recurring patterns.
**Success criteria:** target and habit goals can be created with monthly EUR
targets; progress renders as ring chart or delta bar; the four distribution
strategies update allocations live; recurring transactions are detected; rolling
3-month averages and a projected month-end balance are shown.

### Phase 8 — Multi-Device Sync

**Requirements:** SYNC-01 … SYNC-06
**Depends on:** Phase 1
**Goal:** encrypted data syncs between devices via relay, with QR pairing and
predictable conflict resolution.
**Success criteria:** two devices pair by QR over an ECDH-established channel;
changes propagate on debounce/foreground/network-restore triggers; conflicts
resolve as bank-wins-amount/date, user-wins-category/notes; sync mode and status
are visible in the UI.

### Phase 9 — Account and Polish

**Requirements:** ACCT-01 … ACCT-09
**Depends on:** Phase 1
**Goal:** a complete account/settings surface, encrypted backup round-trip, and
accessibility conformance.
**Success criteria:** the account page exposes profile, language, sync, and
security settings; an encrypted JSON backup exports and restores on another
device; sign-out clears the key and delete-all-data works; the install prompt
appears for non-installed users; the app passes WCAG 2.1 AA checks.

---

## Decisions

### Restart decision log (D1–D15)

Binding decisions from the 2026-08-23 restart design spec.

| # | Decision |
|---|---|
| D1 | Fresh public repo, clean history; the v1 prototype is archived read-only |
| D2 | Apache 2.0 license |
| D3 | React Router framework mode with `ssr: false` — pure SPA plus PWA |
| D4 | Web Crypto AES-256-GCM + hash-wasm Argon2id; custom Dexie 4 DBCore middleware; no `dexie-encrypted` |
| D5 | Key hierarchy: master key wraps a random data key (AES-KW) — password change without re-encrypting the DB |
| D6 | exceljs replaces `xlsx` (SheetJS npm-build CVE staleness) |
| D7 | Google sign-in (Firebase, identity only) plus a master password for the vault |
| D8 | Port the planning corpus, ADR-003, and i18n strings only; rebuild all code and UI |
| D9 | App on Vercel; Storybook on GitHub Pages as living docs; PR Storybook builds as CI artifacts |
| D10 | Two-track build: Storybook design track ∥ core services track, joined by vertical-slice page issues |
| D11 | Sprints as GitHub milestones with due dates; phases as `phase:N` labels |
| D12 | Sprint-close review gate: every finding triaged fix-now vs new-issue before the milestone closes |
| D13 | Money as integer cents everywhere; format and parse only at the edges |
| D14 | Pluggable `StatementParser` registry plus two-stage format identification (container magic bytes, then profile header signature) |
| D15 | Public from the first commit |

### Carried-over v1 decisions still binding

| # | Decision | Rationale |
|---|---|---|
| V1-1 | Money is integer cents end to end (reinforces D13) | Exact arithmetic, stable equality for dedup hashing and reconciliation matching, no drift in derived balances |
| V1-2 | Per-user random 16-byte salt for key derivation, stored with the wrapped key | Prevents cross-user rainbow-table reuse; carried forward from v1 with Argon2id replacing PBKDF2 |
| V1-3 | Semantic design tokens only — components never reference raw colour or size values | Keeps the Editorial Italiana language changeable in one place and makes theming additive |
| V1-4 | Italian number and date parsing rules are explicit, never implicit | `1.234,56` must go through a dedicated parser; dates always parse against the profile's format, never `new Date(string)` |
| V1-5 | **Light only. There is no dark theme** | Editorial Italiana is cream paper and green/ink print — "Light, not dark" is the identity, not a default. No `dark:` variants, no `prefers-color-scheme` branch, `color-scheme: light` pinned on the document. Adding a dark palette would need a new decision here first |

### Decisions taken during the build (D16–)

Binding decisions made after the restart spec was written, numbered on from the
restart log.

| # | Decision | Rationale |
|---|---|---|
| D16 | **Every pigment drawn as text clears WCAG 2.x AA (4.5:1) against every surface the design system permits it on.** The permitted foreground/surface pairs are enumerated and enforced by `test/unit/palette-contrast.test.ts`, which reads the values out of `app/app.css` itself. `surface-page`, `surface-card` and `surface-inset` are text surfaces and carry any text token; `surface-track` is a *graphic* surface (progress tracks, the secondary button's hover fill) and carries only `text-primary` and `text-secondary`; `surface-inverse` carries `text-inverse` and the accent washes; each money accent and each category colour is additionally paired with its own `-surface` wash | The type scale uses `text-meta` at 8.5px and the money accents at 17px, so no large-text exemption applies. Storybook's axe pass only sees pixels a story happens to paint, which is why `--ramp-sepia-500` (3.95:1) and `--ramp-amber-600` (2.87:1) shipped in #1 and were caught only when #2 made a11y blocking. Asserting the *contract* rather than the rendering catches a pigment that no story renders yet, and catches re-lightening later. FOUN-08 is preserved by moving lightness in OKLCH with hue held, never by desaturating toward grey |
| D17 | **`--color-accent-income-strong` is a non-text token** — bars, chart series and fills. It carries the 3:1 WCAG 1.4.11 non-text bar, not 4.5:1 | At `#4a7c43` it reaches only 4.35:1 on the page and 3.82:1 on its own wash. Darkening it to pass as text would close the gap to `accent-income` (`#2d5a27`) to ~0.07 OKLCH lightness, which is not a distinguishable second green — the token would stop doing its job. It is lighter than `accent-income` by construction, and a *lighter* hover colour on cream paper lowers contrast rather than raising it, so it was never a sound text-hover token. Its role is the one that changes, not its pigment |
| D18 | **Every plaintext-indexed column that carries meaning is bound into the record's AES-GCM AAD, and the allowlist forces that decision for each index.** The record envelope version goes to `0x02`; no migration is written | `date` and `type` must stay plaintext — IndexedDB range-queries them — but plaintext meant *unauthenticated*: the Sprint 01 security review (S-2) demonstrated that rewriting either column directly in IndexedDB produced a row that decrypted cleanly, flipping a transaction between the cash and electronic ledgers or between months with the auth tag still verifying. Binding them costs nothing at runtime (the AAD is already built per record) and the middleware re-encrypts on every write anyway. The declaration is mandatory per index rather than defaulted because the defect was the *absent question*, not a wrong answer. The version byte is bumped so a v1 blob reports `envelope/unsupported-version` instead of being indistinguishable from tampering; no migration ships because no vault exists — Phase 1 has no user-facing write path (vault setup is #9) — and doing this after real vaults exist would have meant a read-decrypt-re-encrypt pass over every record |
| D20 | **`Dexie.waitFor` stays in the encryption middleware even though it is measurably inert in Chromium, and the browser e2e suite pins the engine behaviour that makes it inert.** The db layer is additionally reachable from a browser at all, through a build-gated `window` handle deleted with #9/#10 | #42's mutation run removed `waitFor` and got two opposite answers: 26 failures under `fake-indexeddb`, zero in Chromium. Measuring the halves separately explains it — a Chromium IndexedDB transaction does die across a task boundary, but Blink settles `crypto.subtle.encrypt` in the same task (ahead of an unclamped `MessageChannel` post, at 64 B through 1 MiB), so the middleware never reaches the boundary. That is one engine's implementation detail: it is not what `fake-indexeddb` does, nothing promises it for Firefox or Safari, and a future Blink that moves SubtleCrypto onto a thread hop would silently make every write path depend on `waitFor`. Keeping it costs nothing and removing it would rest the vault on an unwritten guarantee, so it stays — and the engine assumption is asserted in `test/e2e/db-liveness.spec.ts` rather than left invisible. The handle exists because nothing in the app imports `app/db` or `app/crypto` yet, so the whole encrypted layer had never executed in a browser in any test; it is gated on the `import.meta.env.MODE` literal, the `vite.config.ts` bundle guard asserts it out of production in both directions, and the production bundle was verified byte-identical with and without it |
| D19 | **Argon2id parameters read back from `meta` are bounded by a cost ceiling of 1 048 576 KiB-passes (`memorySizeKib × iterations`) plus a 256 MiB memory cap and a 16-pass cap, and floored at OWASP's weakest configuration (19 MiB memory, 38 912 KiB-passes of work).** These are security bounds, not tuning knobs; moving one needs a fresh measurement | `meta` is plaintext *and* unauthenticated (#32), so whoever can write that row chooses what the next unlock costs. The Sprint 01 review (S-4) measured the previous bounds admitting 1 GiB × 64 passes — **36.5 s** of frozen main thread on an M4 under Node 24, a one-row denial of service. The bound is on the *product* because per-parameter caps multiply (256 MiB × 16 passes is 4 GiB-passes) while Argon2id's cost is linear in `m × t`: measured at 0.51–0.60 µs per KiB-pass, 1 048 576 KiB-passes is ~0.6 s here however it is split, ~3 s on the ~5×-slower mid-range mobile the ~500 ms default targets. That leaves 5.3× headroom over today's 64 MiB × 3, so #29 can raise the iteration count without touching it. The memory cap is separate because the cost ceiling alone admits a 1 GiB allocation at t=1, which is an out-of-memory crash on a phone whatever the wall time says. A *weak* row is not a decryption risk — weak parameters derive a different master key and `unwrapDataKey` simply fails — so the floor exists for the creation path instead: vault setup (#9) must always use `ARGON2ID_DEFAULT_PARAMS` and never read parameters from `meta`, and the floor is the backstop that makes a mistake there loud. The floor ships now because it could not ship later: stored parameters exist so old vaults still unlock, so a floor introduced after vaults exist could lock one out permanently. No vault exists yet (D18) |
| D21 | **The active locale is resolved once from the browser's ordered language preferences, reduced to the primary language subtag, with English as the fallback; it is held in a Zustand store, and `<html lang>` is written onto the live document at runtime rather than rendered.** A user-facing override is deliberately *not* part of it — ACCT-02 stays Phase 9 (#74) | FOUN-07 asks for auto-detection and the strings were at full EN/IT parity, but nothing selected between them: two route modules imported `en` by name, so the app was English-only whatever a browser asked for (#47). Four choices needed recording. **Region is dropped** (`it-IT`, `it-CH`, `IT` → `it`) because there is one Italian translation, not one per region, and the *ordered* list is walked so an unsupported first preference (`fr-FR`, `it-IT`) does not cost a supported second one its match. **English is the fallback** because an unsupported tag means the user reads neither shipped language natively, English is the wider second language, and it is the language the source strings are written in — so the fallback table is the one that cannot be stale (#58 is that gap on the Italian side). **A store, not a module constant**, because detection alone would not have needed one but ACCT-02's language selector changes the locale while the app runs, and only a store can re-render on that; it also keeps §Stack and layering's `pages → stores` direction intact, with the tables reachable from app code only through `stringsFor` (enforced by `test/unit/locale-boundary.test.ts` over the AST import graph, since the previous enforcement was a comment that was itself wrong). **`<html lang>` is imperative** because `ssr: false` prerenders one static HTML file in Node for every visitor: a rendered `lang={locale}` would be a hydration mismatch on `<html>`, so the shell ships the default and `useDocumentLocale` corrects the live document. That is honest only because the prerendered document carries no copy at all — asserted, with the detection itself, in `test/e2e/locale.spec.ts` |
| D22 | **Argon2id runs in a dedicated Web Worker, one worker per derivation, terminated in a `finally`; the derived master key crosses back as a structured-cloned non-extractable `CryptoKey` and the raw digest never enters the page's realm. The unlock signal is a three-state busy indicator, not a percentage** | Derivation on the main thread froze the UI for its whole duration — ~111 ms at the current defaults on an M4, proportionally worse on a phone, and worse still once #29 raises the iteration count (Sprint 01 review, S-7). `CryptoKey` is a [Serializable] platform object, so the worker can `importKey(…, extractable: false, ['wrapKey','unwrapKey'])` and post the *handle*: verified in both target runtimes — Node 24.14 `worker_threads` and Chromium 151 each return a key with `extractable === false`, an `exportKey` that rejects `InvalidAccessError`, and byte-identical AES-KW output. That is **stronger** than before, because the 32 raw bytes used to sit in the page heap until collected and now never leave the worker. **One worker per derivation** rather than a pool: Argon2's block array lives in WebAssembly linear memory, which grows and never shrinks, so a pooled worker would hold 64 MiB — up to the 256 MiB D19 permits — for the whole session on a device that may be a phone, to amortise a spawn that happens roughly once per unlock; terminating also destroys the heap that held the password (see §Session lifetime). **No progress percentage**: hash-wasm's `argon2id()` exposes no progress hook, so a bar would have to be invented from a timer and would be wrong on exactly the slow devices where it is read; the states are `starting` / `deriving` / `settled`. Worker failures are mapped back to the existing typed `KdfError` codes (plus `worker/failed` and `environment/no-worker`) rather than surfacing as an opaque `ErrorEvent`, and D19's parameter bounds are enforced **twice** — on the main thread before a worker is spawned at all, and inside the worker, whose `onmessage` accepts whatever the page sends it. That derivation happens off the main thread is enforced mechanically, not by review: `test/unit/crypto/kdf-worker-boundary.test.ts` walks the module graph of `app/crypto/kdf.ts` with the `new URL(…, import.meta.url)` edge excluded and fails if any Argon2id implementation is reachable |
| D23 | **`ARGON2ID_DEFAULT_PARAMS` is re-measured and deliberately kept at 64 MiB × 3 passes × 1 lane. The "roughly 500 ms on the target device" target becomes an operable, falsifiable model — `ARGON2ID_COST_MODEL`: a measured reference of 0.53 µs per KiB-pass, an *assumed* 5–8× target-device slowdown, and a 250–1000 ms budget — stated in code, asserted by tests that read no clock, and refutable by one measurement on a real phone (#78). Parameters are never auto-tuned at runtime** | #29 asked whether `t = 3` is right and found that the honest answer is *the question was never answerable*: "the target device" had no definition and no phone had ever been measured. Re-measuring the reference machine gives 103.8 ms of Argon2id in a Chromium 151 dedicated worker on an Apple M4 (106.3 ms with worker spawn, a flat 2.5–3.7 ms) and 102.7 ms in Node 24.14 — 0.51–0.59 µs per KiB-pass, linear in `m × t` across the whole admissible range, so the two runtimes and every parameter split agree. The slowdown factor is the one number still estimated; 5–8× is the union of the two figures this repo already committed to (D19 reasoned from ~5×, the Sprint 01 review of #29 from ~8×) and brackets what a single-core score ratio predicts once memory bandwidth — which dominates a memory-hard KDF — is allowed for. That predicts **519–830 ms**, i.e. already *inside* the band and, at the pessimistic end, *above* 500 ms: the pressure the issue anticipated was to raise `iterations`, and the measurement says the opposite. **Keeping the value is the decision, not the absence of one.** Three arguments support it. (1) 64 MiB × 3 is exactly RFC 9106 §4's *second recommended option* (that option specifies 4 lanes; `p = 1` is a documented deviation for hash-wasm's single-threaded Argon2id, which leaves `m × t` — and therefore the work — identical while keeping the memory undivided), and it is far above every OWASP Argon2id minimum, the weakest of which the D19 strength floor already encodes. (2) Since D22 the unlock is a spinner rather than a frozen tab, so the cost of being at the top of the band is much lower than the cost of being wrong about it. (3) **The migration argument is why this is decided now rather than deferred**: every vault stores the parameters it was created with, so while no vault exists (D18) this is a one-line edit, and from the first vault onward it is a re-derivation and re-wrap of every master key. Deciding costs nothing today. Consequences: D19's ceiling and its 5.3× headroom are untouched, and the headroom test is retargeted from "slack reserved for #29" to a standing ≥5× bound — still load-bearing, because a future move to `t = 4` would drop it to 4.0× *and* push the predicted unlock to 1106 ms, tripping both guards deliberately. The model is not consulted at runtime and derivation is never auto-tuned from a live measurement: device-dependent parameters would make the same password derive a different key on each device, so a vault created on a laptop could not be unlocked on the owner's phone. What remains open is the measurement itself, filed as #78 and worth taking before #9 ships a vault |
| D24 | **The keyboard focus ring is one token and one treatment on every surface, and its pigment is chosen so that it can be.** `--color-focus-ring` moves from `--ramp-green-700` to `--ramp-green-500`, and `test/unit/palette-contrast.test.ts` asserts the 3:1 non-text bar against every `--color-surface-*` the sheet declares, not only the surfaces someone remembered to permit | Green-700 reaches 2.12:1 on `surface-inverse`: the ring was invisible on the ink panel, so the first focusable control inside `Card tone="inverse"` would have shipped without a focus indicator (#65). A cream-and-ink system admits exactly one band of pigments that clear 3:1 on both — relative luminance between 0.141 and 0.213 — and green-500 sits in it (4.74 / 4.35 / 4.04 / 3.65 on card, page, inset and track; 3.46 on inverse), close to the theoretical best of ~3.55 for a single ring. The alternatives were worse: a surface-aware `--color-focus-ring-inverse` needs a scoped custom-property override that `test/unit/ui-tokens.test.ts` forbids components from writing, and leaves a convention every future dark surface must remember; a two-tone ring re-styles every control in the app and turns a per-surface contract into an "either tone clears 3:1" one; forbidding focusable content inside an inverse card is a rule the type system cannot express. The cost is ring contrast on paper falling from 7.11:1 to 4.35:1 — still comfortably over the 3:1 bar that governs the affordance, and the same non-text class D17 already assigns green-500 |
| D25 | **The install affordance is a shell-owned strip with three states, and iOS/iPadOS gets the third one: a written Share → Add to Home Screen instruction instead of a button. A dismissal is remembered in `localStorage` and is permanent on that device** | FOUN-06 asks for "manifest + install prompt" and only the manifest had shipped (#60), so the app was installable but never said so. The interesting half of the decision is iOS. `beforeinstallprompt` is a Chromium extension to the platform — it is in no standard, WebKit has declined to implement it, and **every** browser on iOS/iPadOS is WebKit, so the event is not merely absent in Safari, it is absent on the whole platform. A two-state design ("prompt captured" / "nothing") therefore shows nothing on the one platform where the install path is *least* discoverable: it is four taps behind a Share sheet, with no page-side signal that the app is installable at all. The alternatives were to accept that (FOUN-06 half-met for every iPhone user, and the roadmap's Phase 9 success criterion "the install prompt appears for non-installed users" false there), or to fake a button that could only open instructions. Neither is honest, so the affordance has three states and the third one *is* the instruction: same strip, same dismissal, no button, because there is nothing for a button to do. The copy names the browser's own command ("Share" → "Add to Home Screen" / "Condividi" → "Aggiungi a Home"), which is accurate in Safari, Chrome, Edge and Firefox on iOS alike — they all reach the same WebKit install path. iPadOS is detected the way the platform itself forces: it reports a desktop macOS user agent, so a "Macintosh" that reports more than one touch point is an iPad. **Dismissal is persistent and one-way** because it has to be: iOS fires no `appinstalled` event either, so on the platform that gets the guidance strip the *only* signal that the offer is finished is the user saying so — an undismissed strip would outlive the install it asked for. The same key covers Chromium, where it replaces the mini-infobar the port suppresses with `preventDefault()`. It holds a UI preference and never financial data, so `localStorage` is outside the crypto boundary by construction, and every read and write is wrapped: a browser with site data blocked throws on the property access itself and must not take the shell down with it. What is deliberately **not** here: no re-prompt schedule, no "remind me later", and no dismissal reset in settings — ACCT-01's account surface (Phase 9) is where a reset belongs if one is ever wanted, and inventing a nag cadence before anyone has used the app would be guessing |
| D26 | **A recovery phrase is generated at vault setup and wraps a *second copy of the same data key* under its own AES-KW key-encryption key; both wrapped copies live in the plaintext `meta` row. The phrase is 160 bits from `crypto.getRandomValues`, written as 32 Crockford base32 symbols in 8 groups of 4, derived to a key-encryption key with HKDF-SHA-256 and a per-vault salt — not Argon2id. It is returned exactly once by `createVault` and no function reads it back** | As specified through Sprint 01, a forgotten master password was **permanent, total data loss**: the hierarchy had exactly one route to the data key, and #9 would have shipped that without the product ever saying so (#68). Five choices needed recording. (1) **A second wrapping, not a second derivation path.** The recovery key wraps the *same* data key rather than reproducing the master key, so it composes with step 3 as written ("leaves room for additional unlock methods"), needs no re-encryption of any record, and keeps the two paths independent — changing the password rewrites one copy, rotating the phrase rewrites the other, and neither invalidates the other. The zero-knowledge property is untouched: `meta` gains a 16-byte salt and a second 40-byte blob, neither of which decrypts anything without a secret the user holds offline. (2) **160 bits of entropy.** The phrase is full-entropy random, so its strength *is* its entropy — 2^160 AES-KW trials against a stolen `meta` row — and the recovery path is therefore stated plainly as 160-bit rather than 256-bit. 128 bits (BIP39's 12 words, NIST's long-horizon symmetric target) is the conventional floor but is 25.6 base32 symbols, which tiles no group; 256 bits would match the data key at the cost of 52 hand-copied symbols, roughly doubling the transcription-error surface to close a gap nothing can walk through. 160 tiles exactly — 32 symbols, 8 groups, no padding, no unused bits, so no two written phrases mean the same secret. (3) **HKDF-SHA-256, not Argon2id.** A memory-hard KDF exists to buy work factor for *low*-entropy secrets; on 160 bits it would buy ~2^20 on top of 2^160, paid for in ~500 ms and — worse — in a second set of cost parameters sitting in an attacker-writable plaintext row, which is exactly the denial-of-service surface D19 exists to bound. The recovery unlock is one HKDF, so it also spawns no worker and puts nothing on any `postMessage` boundary. `deriveKey` to a non-extractable `AES-KW` key was verified in both target runtimes before being relied on — Node 24.14 and Chromium 151 each return `extractable === false` with usages `wrapKey`/`unwrapKey` and a 40-byte wrap — the same standard D22 applied to structured-cloned `CryptoKey`s; if a future target engine refuses that derived-key type, the documented fallback is `deriveBits` plus `importKey`, and the failure is loud at setup rather than silent. (4) **Crockford base32, no wordlist, no checksum.** A BIP39-style wordlist reads better aloud but ships a 2048-word table and immediately collides with "both locales, always" — an English list shown to an Italian user is a transcription hazard, and a second Italian list means two encodings of one secret and a new way to lose data. Crockford is language-neutral, excludes `I`/`L`/`O`/`U`, and folds the confusables on read, so most transcription slips still open the vault at the one moment the user has no other way in. No checksum symbol: AES-KW already carries an integrity check and the recovery unlock costs microseconds, so a checksum would only move an identical "that is not the phrase" message a few microseconds earlier, at the price of an encoding rule that must never drift. (5) **One entry point, and the phrase is a one-shot value.** `app/crypto/vault.ts` creates a vault (both copies, one call), unlocks it with either secret (a typed discriminated result, not an exception, for everything a user can retype), changes the password and rotates the phrase; #9 composes none of the primitives itself, because a record assembled in the wrong order is an unopenable vault. Setup's "losing both is unrecoverable" acknowledgement is a UI obligation the service makes hard to get wrong rather than one it can enforce: the phrase is returned once from creation, there is no getter, and `recoveryPhrasesMatch` supports the type-it-back step while it is still on screen. Consequences: creation always uses `ARGON2ID_DEFAULT_PARAMS` and never reads parameters from `meta` (D19's creation-path rule, now enforced by there being no parameter argument); the record is a closed, versioned field set so #32 has a canonical encoding to MAC (`version`, `kdfSalt`, `kdfParams`, `wrappedDataKey`, `recoverySalt`, `recoveryWrappedDataKey`), and #32 must cover the two new fields or a substituted recovery copy stays undetectable; #51's AAD binding is untouched, since `meta` is not an encrypted table and no record ciphertext changes. That the phrase is never persisted, logged or transmitted is asserted rather than intended, in `test/unit/crypto/recovery-phrase-leak.test.ts` | |
| D27 | **The sign-in, vault-setup and unlock screens render from a pathless *gate* layout that wraps the whole app, not from a `/sign-in` route reached by redirect; identity and the vault stay two stores with exactly one edge between them; #44's e2e session handle is deleted and #42's db handle is re-justified and kept.** | #9 is the first change that has to answer "what does the app show when there is no identity, or an identity but a closed vault", and four choices needed recording. **(1) A wrapper, not a redirect.** `app/routes/app-layout.tsx` and `app/shell/app-shell.tsx` both anticipated the sign-in screen as a *sibling* route. The screens do render outside the shell exactly as those notes intended, but as a nested pathless layout: `app/stores/session.ts` already warned that treating an unresolved session as signed-out "bounces them out of a deep link", and a redirect to `/sign-in` does precisely that on every cold load, so every deep link would then need a return-to parameter to undo it. A wrapper renders the right screen *at* the URL the user asked for and the `<Outlet />` appears underneath it the moment the vault opens — no navigation happens at all, and the unresolved states (`session === 'unknown'`, `vault === 'unknown'`) render nothing rather than guessing. `test/unit/shell/nav-routes.test.ts` now asserts the two-level nesting, so a third top-level route — a page reachable with no identity and no vault — still fails. **(2) Two stores, one edge.** "Signed in but locked" is the state the whole lock screen exists for, and it is only representable if identity and the vault are separate; collapsing them would also make sign-out and lock the same event, which FOUN-10 distinguishes. The single edge is `onSessionEnded(() => vault.lock())`, wired in `app/stores/vault-instance.ts` — the composition root, which may import both while neither store imports the other, so `test/unit/auth-boundary.test.ts` keeps holding. The idle auto-lock and the tab-close wipe are *not* here: they are #10, and they call the same action. **(3) Creation cannot read Argon2id parameters from `meta`, as a shape rather than a rule.** D19 requires it; what makes it true is that no function on the creation path — `app/stores/vault.ts`, `app/services/vault/vault-service.ts`, `createVault` — takes a parameter argument at all, so there is no variable that could hold the wrong ones. The record store is the only module that touches the `meta` row, and it writes the whole record in one `put`, because a password copy stored beside a stale salt is an unopenable vault. **(4) The two e2e handles part company.** #44's `window` session handle is **deleted**: the sign-in screen replaces it completely, and the one thing it asserted that the UI cannot — that the store receives a four-field `AuthUser` and no token — moved to `test/unit/auth-user.test.ts` over a narrowing function extracted for the purpose, which is stronger because it runs on every `verify` rather than only when an emulator is up. #42's db handle is **kept**, and the re-justification is narrow: the vault lives in `meta`, which the allowlist marks plaintext by design, so the *encryption middleware* still has no user-facing write path — the encrypted tables are `transactions` and `categories` and Phase 1 ships no screen that writes either. Deleting the handle would remove nine browser cases (the raw-IndexedDB leak scan, tamper detection, AAD re-encryption, the locked-vault path, transaction liveness) and put nothing in their place, which is exactly the trade D20 forbids. Its retirement condition is restated as an observable one — the first UI that writes an encrypted row, i.e. the Phase 3 transaction loop — and filed as an issue rather than left as a comment. Consequences: the stale sign-in and vault copy is rewritten in both locales (`signin_feat2_*` and `signin_note` sold Gemini receipt scanning, a v1 non-goal; `vault_step2*` described the dead Google-UID + PBKDF2 scheme), and the recovery phrase's show-once UX is a screen the store owns for the length of setup — `createVault` returns it exactly once, `acknowledgeRecoveryPhrase` ends its life, and `recoveryPhrasesMatch` gates the step so nobody clicks past a phrase they never recorded |
| D28 | **The lock screen is the gate's full-page unlock screen, not a modal over the app; the idle auto-lock is a wall-clock deadline checked by a coarse interval and on `visibilitychange`, plus `pagehide`, running only while a data key is held; every lock names its reason** | #10 closes FOUN-10, and three choices needed recording. **(1) No modal.** `app/routes/app-layout.tsx`, `app/shell/app-shell.tsx` and `app/routes/gate.tsx` all anticipated re-presenting the unlock form as a `dismissible={false}` `Modal` beside the shell. That shape contradicts D27's rule 3 — every page below the gate may assume a live data key — because a modal keeps those pages mounted with none, and it leaves financial content on screen behind the lock. Unmounting the outlet is what makes "locked" mean *nothing that needed the key is rendered*; the URL is untouched, so the same page reappears on unlock, which is the property the modal was meant to buy. The stale notes are rewritten and the `Modal` primitive keeps its `dismissible={false}` escape hatch for the mobile overflow it already serves. **(2) A timestamp, not a resettable timeout.** A `setTimeout` reset on every input is the obvious implementation and the wrong one on a phone: a background tab's timers are throttled and then suspended, so a tab brought back after an hour would still be waiting on a timeout that never ran, with the data key live throughout. `app/services/vault/idle-lock.ts` therefore records the last input as a wall-clock instant and compares against it from three places — a 60-second interval while the tab runs, `visibilitychange` when it returns (the suspended-tab case: the clock moved, the interval did not), and never from the input handlers themselves, which only stamp a number and so cost nothing on a scroll. `pagehide` locks unconditionally: it fires on close, on navigation away and on entry to the back-forward cache, the one case where module memory *outlives* leaving the page, and a re-entered password on a bfcache restore is the right price for a key that never survives it. The watcher runs only while the store is `unlocked` (`app/stores/vault-idle-lock.ts`) and unregisters itself after firing, so a locked vault keeps no timer and no window listeners alive. **(3) `lock(reason)` is required.** `manual`, `idle` and `session-ended` are the three edges FOUN-10 names; making the argument mandatory means no call site can pass `lock` straight in as a click handler and store a `MouseEvent` where a reason should be. The unlock screen reads the reason for exactly one thing — an idle lock swaps the subtitle so a user back from lunch is told the vault locked itself before being asked to type — and a successful unlock clears it. Consequences: `test/unit/vault/idle-lock.test.ts` drives the deadline with fake timers and `vi.setSystemTime` (the suspended tab), `test/unit/vault/vault-idle-lock.test.ts` proves the watcher starts and stops with the data key, and the e2e journey jumps the page clock thirty-one minutes with `page.clock.fastForward` and expects the unlock screen with the idle copy — the only automated place the real `window` wiring runs | |

### Superseded v1 decisions

- PBKDF2 uid + device-secret KEK → **Argon2id from a master password** (D4, D5).
- `dexie-encrypted` → **custom Dexie 4 DBCore middleware** (D4).
- SheetJS/`xlsx` → **exceljs** (D6).
- ADR-003's PDF-import-via-AI-vision → **deferred out of v1 scope**; the parser
  registry keeps it a drop-in addition later.
- Firebase Hosting / full backend → **Vercel for the app, Firebase for auth only** (D9, D7).

---

## Stack and layering

Node 24 LTS (`.nvmrc`, `engines`), npm. React 19, React Router 8 framework mode
with `ssr: false`. TypeScript 5.9+, Tailwind 4 (CSS-first `@theme` tokens),
Zustand 5, Dexie 4, date-fns 4. Firebase 12 for auth only. PapaParse for CSV,
exceljs for XLSX, hash-wasm for Argon2id. PWA via vite-plugin-pwa (Workbox).
Quality tooling: Biome 2, lefthook, commitlint, Vitest 4, Playwright,
Storybook 10, Renovate, GitHub Actions.

```
pages (router routes) → stores (Zustand) → services (pure TS) → db (Dexie 4 + middleware) → crypto (Web Crypto)
```

The layer contract is enforced by review: services never import React; crypto
never imports Dexie. Every layer is unit-testable in isolation, with
`fake-indexeddb` standing in for the browser database.

---

## Crypto and data layer

### Key hierarchy

1. **Identity** — Firebase Google sign-in. Identity only; it never touches
   encryption material.
2. **Vault** — master password → Argon2id (hash-wasm; **64 MiB memory, 3
   passes, 1 lane**, per-user random 16-byte salt) → 256-bit master key,
   imported as a **non-extractable `CryptoKey`**.

   Those parameters are tuned to roughly 500 ms on the target device — and
   since #29 that sentence has an operable meaning instead of an aspiration.
   **The target device is a mid-range Android phone browser**, and it has still
   never been measured. What has been measured is the reference machine: 64 MiB
   × 3 costs **103.8 ms of Argon2id** in a Chromium 151 dedicated worker on an
   Apple M4 (106.3 ms including worker spawn) and 102.7 ms in Node 24.14, a rate
   of 0.51–0.59 µs per KiB-pass that holds across the whole admissible parameter
   range. Applying the stated slowdown assumption of **5–8×** — recorded as
   `ARGON2ID_COST_MODEL` in `app/crypto/kdf-params.ts`, asserted by
   `test/unit/crypto/kdf.test.ts`, and refutable by one measurement on a real
   phone — predicts **519–830 ms** there, inside the band. The parameters were
   therefore re-measured and deliberately **kept**; see D23, which also records
   why the remaining phone measurement (#78) is worth taking before the first
   vault exists.

   Derivation runs in a **dedicated Web Worker**, one per derivation,
   terminated as soon as it answers — see D22. The worker imports the digest
   into the key and posts back only the `CryptoKey`, which is structured-
   cloneable: the raw 32 bytes never exist in the page's realm at all. The
   parameters are validated on both sides of that boundary, before any Argon2id
   work, per D19.
3. **Wrapping** — the master key wraps a randomly generated data key with AES-KW.
   The wrapped data key, the salt, and the Argon2id parameters live in a
   plaintext `meta` table. This allows password changes without re-encrypting
   the database, and leaves room for additional unlock methods (Phase 8 device
   pairing).

   Since #68 the room that leaves is occupied: **the same data key is wrapped
   twice, and both copies live in that row.**

   ```
     master password ──Argon2id(kdfSalt, kdfParams)──► master key ──┐
                                                                    ├─AES-KW─► data key
     recovery phrase ──HKDF-SHA-256(recoverySalt)──► recovery key ──┘
   ```

   The second key-encryption key comes from a **recovery phrase**: 160 bits from
   `crypto.getRandomValues`, written as 32 Crockford base32 symbols in 8 groups,
   generated at vault setup, shown once and never retrievable afterwards. It is
   a second wrapping of the *same* data key, not a second derivation path to the
   master key — so a forgotten master password costs the password, not the
   vault, and no record is ever re-encrypted. Losing **both** is unrecoverable
   by construction: there is no third copy and no server-side anything. See D26
   for the entropy, the encoding and why this path uses HKDF rather than
   Argon2id.

   The `meta` row therefore holds `version`, `kdfSalt`, `kdfParams`,
   `wrappedDataKey`, `recoverySalt` and `recoveryWrappedDataKey` — the closed
   field set #32 will MAC. Each of the two copies is rewritten independently:
   changing the master password rewrites the password copy (new salt, current
   default parameters) and leaves the recovery phrase working; rotating the
   recovery phrase rewrites the recovery copy and leaves the password working.
   `app/crypto/vault.ts` is the only entry point for all of it — creating a
   vault produces both copies in one call, and unlocking takes either secret —
   because a record assembled from those primitives in the wrong order is an
   unopenable vault.

   That row is unauthenticated (authenticating it is tracked as #32), so the
   parameters read back from it are untrusted input and are bounded before any
   derivation begins — see D19. Creation, by contrast, **never** reads
   parameters back: it always uses `ARGON2ID_DEFAULT_PARAMS`.
4. **Records** — the data key encrypts record payloads with AES-256-GCM, a random
   12-byte IV per record stored alongside the ciphertext. The GCM auth tag
   provides tamper detection.

   The tag covers more than the payload. Each record's **additional
   authenticated data (AAD)** binds the envelope version, the table name, the
   record's primary key, and every plaintext-indexed column the allowlist marks
   `{ aad: 'bound' }` — today `transactions.date` and `transactions.type`. The
   layout is length-prefixed so it cannot be read two ways:

   ```
   version                                   1 byte  (0x02)
   u32be(len(table))    || table
   u32be(len(recordId)) || recordId
   u32be(count of bound fields)              4 bytes
   for each bound field, in allowlist order:
       u32be(len(name))  || name
       u32be(len(value)) || value
   ```

   Consequences: a blob cannot be moved to another row or another table, and a
   plaintext column cannot be rewritten in the database behind the middleware's
   back — either produces a different AAD and the read fails `decrypt/failed`
   (surfaced as `record/corrupt`). Changing a bound column therefore means
   **re-encrypting** the record, not re-indexing it; the middleware does that
   already because every write is a whole-value `put`.

   Bound values are authenticated **exactly as stored** — no normalisation, no
   reformatting — because a writer and a reader that canonicalise differently
   would turn a whole vault into decryption failures. A bound column must
   therefore be a non-empty string: a numeric index has to choose its stored
   string form before it can be bound.

   The version byte is `0x02`. Version 1 bound only the table and the record id;
   its AAD is a different byte string, so a v1 blob is rejected with
   `envelope/unsupported-version` rather than an indistinguishable
   `decrypt/failed`. No migration ships with the bump — there is nothing to
   migrate, because no user-facing write path exists yet (vault setup is #9) and
   the only v1 blobs ever written were written by tests. See D18.

### Encryption middleware

`app/db/encryption-middleware.ts` is a Dexie 4 DBCore middleware. It intercepts
`mutate` to encrypt before writes, and `get` / `getMany` / `query` to decrypt
after reads.

DBCore is promise-based, so an async cipher can be used at all — v1's
synchronous TweetNaCl is not forced on us, and Argon2id, AES-GCM and a
non-extractable `CryptoKey` are all reachable. **It does not follow that a bare
`await` is safe.** An IndexedDB transaction is only *active* during the task
that created it and during its own request callbacks: the moment control
returns to the event loop with no request outstanding, the transaction commits.
`crypto.subtle.encrypt` resolves in a later task, so awaiting it inside a Dexie
transaction lets that transaction close underneath the middleware and the next
operation throws `InvalidStateError`. Issue #6 reproduced this on the `update()`
and `modify()` paths and on the primary-key-change path. It is not a
`fake-indexeddb` artefact — browsers behave the same way, and it is the same
hazard that pushed v1 to a synchronous cipher.

Every await of Web Crypto inside the middleware therefore goes through
**`Dexie.waitFor`**, which keeps issuing a dummy request against the
transaction while the promise is pending, so the transaction stays active and
the continuation resumes inside a request callback. Outside a transaction it is
a passthrough. Remove it and every mutation path fails under `fake-indexeddb`.

It is kept as an **engine-independent guarantee, not because every engine needs
it today**. Issue #42 ran the middleware in Chromium and measured the two halves
separately: an IndexedDB transaction there really does die across a task
boundary (`TransactionInactiveError`), exactly as above — but Blink resolves
`crypto.subtle.encrypt` inside the *same* task, ahead of an unclamped
`MessageChannel` message, at 64 B, 64 KiB and 1 MiB alike. The middleware
therefore never crosses the boundary in Chromium and `waitFor` has nothing to
keep alive there. See D20. `test/e2e/db-liveness.spec.ts` pins that Blink
behaviour as an assertion, so it cannot change without saying so.

### Table field allowlist

Encryption is per-table and allowlist-driven:

- **Plaintext (indexed):** the fields IndexedDB must range-query — `id`, `date`,
  `type`, and equivalent keys. These are structural, not financial content.
- **Encrypted (single blob field):** everything sensitive — `amount`,
  `description`, `category`, `notes`, and any free text.
- **Plaintext by design:** the `meta` table (both wrapped copies of the data
  key, the Argon2id salt and parameters, the recovery salt).

**Readable is not the same as rewritable.** Every secondary index on an
encrypted table additionally declares an **AAD binding**, and there is no
default:

- `{ aad: 'bound' }` — the column's value is authenticated with the record (see
  §Key hierarchy step 4). `transactions.date` and `transactions.type` are bound:
  a wrong `date` moves a transaction between months and so between every
  analytic and reconciliation window (ANLY-01..04, RECN-01..04), and a wrong
  `type` moves money between the cash wallet and the bank (CASH-01..05).
- `{ aad: 'unbound', rationale }` — the column may be rewritten undetected, and
  must say in writing why that cannot distort anything. Nothing is unbound
  today.

Adding an index without declaring its binding fails `assertValidAllowlist` with
`schema/unbound-index` at construction time. That is deliberate: issue #51
happened because nothing made the question mandatory, not because someone
answered it wrongly.

The allowlist is the security contract for the db layer and is asserted by a
plaintext-leak test that dumps raw IndexedDB after writes and fails if any known
plaintext value appears (see §Workflow, testing).

### Session lifetime

The data key lives in module-scoped memory only. Locking drops the reference;
an idle timeout auto-locks. The key is never written to any storage.

The derivation worker (D22) is not a second place a key lives. It is created
per derivation and terminated in a `finally`, so the password string, its
encoded bytes and the Argon2id digest go with the thread rather than waiting on
a garbage collector — which is stricter than the main thread ever was. The
master key it hands back is a non-extractable `CryptoKey` held in the same
module-scoped memory as everything else.

### Money

Integer cents (`-1234` = −12,34 €), never floats. Formatting happens only at the
display edge via `Intl.NumberFormat('it-IT')`; parsing happens only at the import
edge (Italian format `1.234,56` → `123456`).

`app/services/money.ts` is the single implementation, and it binds three rules
that follow from D13:

- **Reject, never guess.** A separator that reads two ways with a 1000× gap —
  `1.234` (grouped 1234, or a stray decimal point) and `1,234` (Italian decimals,
  or English thousands) — is refused with a typed error code, not resolved by a
  heuristic. Every rejection is a typed code; the parser never falls back to `0`
  or `NaN`.
- **Never round.** Digits past the second decimal are dropped only when they are
  zeros and therefore carry no value; a non-zero digit that would be rounded away
  rejects the input instead.
- **No IEEE-754 on either path.** Parsing goes digit string → `BigInt` → safe
  integer; formatting goes cents → `BigInt` → decimal string → `Intl`. There is
  no division by 100 anywhere. The representable range is
  ±9.007.199.254.740.991 cents; past it the parser reports `OUT_OF_RANGE`.

Sign conventions that live outside the amount string — the profile's
`amountSign`, separate Dare/Avere or Entrate/Uscite columns — belong to the
import profile, not to the parser.

---

## Bank import

Italian banks export in inconsistent, long-unchanged formats with no OFX/QIF
equivalent, so the import pipeline is built around pluggable parsers and
data-driven profiles rather than per-bank code.

### Parser registry

`StatementParser` interface: `id`, `canParse(file, sniff) → confidence`,
`parse(file) → { headers, rows }`. Parsers live in a registry; adding a future
format (PDF-via-AI, OFX, QIF) means one new module and no changes elsewhere.

### Two-stage detection

**Stage 1 — container, by magic bytes, never by file extension.** A `PK` zip
header means xlsx (exceljs); a CFB header means legacy xls; anything else is
treated as text and goes down the CSV path with a BOM/encoding sniff (UTF-8 vs
ISO-8859-1) and a delimiter sniff (`,` vs `;` — Italian exports frequently use
semicolons).

**Stage 2 — profile auto-identification.** The parsed header set is hashed into a
signature and matched against built-in and saved profiles. A match auto-selects
the profile and shows the confidence; no match falls through to the manual
column-mapping UI, whose result is saveable as a named profile.

**Profiles are data (JSON), not code.** Built-ins ship as assets; user profiles
are stored in the encrypted DB; both flow through the same matcher.

### Built-in profiles

Column mappings and encodings carried over from v1's ADR-003.

| Bank | Format | date | description | amount | Encoding |
|---|---|---|---|---|---|
| Banca Intesa | CSV | `Data` | `Descrizione` | `Importo` | ISO-8859-1 |
| UniCredit | CSV | `Data Val.` | `Descrizione` | `Importo €` | UTF-8 |
| Fineco | XLSX | `Data` | `Descrizione` | `Entrate/Uscite` | UTF-8 |

### Profile shape

`columnMapping`, `dateFormat` (e.g. `dd/MM/yyyy`), `amountSign`
(`standard | inverted`), `encoding`, `format`, plus the ingestion knobs Italian
exports demand: rows to skip before the header, and delimiter.

### Format hazards the pipeline must handle

- Legacy ISO-8859-1 exports producing mojibake in accented descriptions.
- Comma decimal separators and dot thousands separators (`-1.234,56`), which
  naive `parseFloat` reads 1000× too large.
- Sign conventions: single signed column, separate Dare/Avere columns, or
  Fineco-style separate Entrate/Uscite columns — hence `amountSign`.
- Ambiguous dates (`01/03/2026`): always parse against the profile's
  `dateFormat`, never `new Date(string)`.
- Metadata rows before the real header, and trailing separators creating a
  phantom empty column.
- A preview step showing sample parsed rows before commit is part of the
  contract, not a nicety (IMPT-06).

### Deduplication

Duplicates are detected on ingest by date + description + amount. Integer-cent
amounts make the hash stable (V1-1). Imports carry deterministic IDs so that
Phase 8 sync cannot resurrect a de-duplicated row.

---

## Workflow

### Build strategy

1. **Foundation gate first** — repo scaffold (SPA router, Tailwind 4, Biome,
   lefthook, commitlint, CI + `verify`, Storybook, PWA config, deploys,
   Apache 2.0, README, CLAUDE.md), this document, and the initial issue set.
2. **Design track ∥ core track** — design builds tokens and components in
   Storybook; core builds crypto middleware, db schema, auth, and services
   test-first. The tracks rarely touch the same files.
3. **Pages** land as thin vertical-slice issues joining both tracks per phase.

### Issues, labels, sprints

GitHub issues are the queue, and each issue carries its governing architecture
sections inline. `gh issue list --label ready` drives work.

- **Type:** `type:planned`, `type:bug`, `type:security`, `type:debt`, `type:design`
- **Priority:** `p0`, `p1`, `p2`
- **Status:** `ready`, `blocked`
- **Context:** `phase:1` … `phase:9`

**Sprints are GitHub milestones** with due dates ("Sprint 03 (due YYYY-MM-DD)").
Phase tracking lives in `phase:N` labels, not milestones. Sprint planning picks
the issue set: `type:planned` prioritised per the roadmap, `type:bug` scheduled
by priority and postponable by design.

### Branching and PRs

Trunk-based, with short-lived `feat/<issue>-slug` branches and one PR per issue
referencing it. Conventional commits are enforced by commitlint; the allowed
scopes are `app`, `ui`, `db`, `crypto`, `i18n`, `import`, `infra`, `deps`,
`docs`. Merges are semi-linear (rebase plus merge commit). Branch protection
requires green CI and linear history; a lefthook `pre-push` hook refuses direct
pushes to `main`.

### The `verify` contract

```
npm run verify = typecheck && lint && format:check && assist:check && test:unit && test:stories && build && build-storybook
```

CI runs exactly this on every PR — no extra steps, no missing ones. If it is
green locally it is green in CI. Playwright e2e runs as a separate, slower CI
job.

`assist:check` is the stage that enforces Biome's *assist* actions
(`source.organizeImports` in `biome.json`). Neither `biome lint` nor
`biome format` runs assists, so the setting was inert until this stage existed.

Vitest is split into two projects (`vitest.config.ts`). `test:unit` scopes to
the `unit` project: Node environment, no browser, and it stays that way.
`test:stories` scopes to the `stories` project: every Storybook story rendered
in headless Chromium by `@storybook/addon-vitest`. Both are inside `verify`, so
the `verify` CI job installs Chromium exactly as the `e2e` job does.

### Review gates

- **Per PR (always):** CI `verify` plus a correctness/security code review before merge.
- **Sprint close:** a correctness and security review pass over the sprint's
  merged diff. Every finding gets an explicit triage decision:
  - *Not acceptable as-is* → fixed inside the sprint (amend the open PR or land
    an immediate fix PR) before the milestone closes.
  - *Deferrable* → a new issue with a `type:bug` / `type:security` label plus
    priority, planned into a future sprint.

  The milestone closes only when the triage table is empty. Each sprint gets a
  short retro note in `docs/sprints/NN.md` recording decisions and carry-overs.

### Testing

- **Unit (Vitest):** services and crypto as pure TS, written test-first. Crypto
  covers Argon2id vectors, AES-GCM round-trips, wrap/unwrap, and tamper
  detection. The db layer runs on `fake-indexeddb` and asserts middleware
  transparency plus the **plaintext-leak test** that permanently guards the
  "unreadable via DevTools" criterion.
- **Import:** a parser contract suite per format with fixture files, and a
  dedicated suite for the detection matrix (container sniff × profile signature).
- **Component:** Testing Library where logic warrants it. Every Storybook story
  also runs as a smoke test in headless Chromium via `@storybook/addon-vitest`
  (the `stories` Vitest project), and that run is part of `verify`.
- **E2E (Playwright):** a few critical journeys — vault create → lock → unlock;
  CSV import wizard end to end with a fixture; manual expense entry appearing in
  the list. Separate CI job. The first of those journeys is live since #9:
  `auth-emulator.spec.ts` signs in through the real screen against the Auth
  emulator, creates a vault, types the recovery phrase back, locks, and unlocks
  with **both** secrets — all by clicking shipping UI, with no test seam. It is
  one long test on purpose: the emulator's popup sign-in is the expensive and
  flaky part (#71), and splitting the vault half out would pay for it twice.
  `db-liveness.spec.ts` still drives the db layer through a build-gated handle
  (D20, D27): a real write/read/update/modify/lock cycle, tamper detection, and
  a **second plaintext-leak scan against real IndexedDB** sharing one scanner
  with the Node test (`test/support/raw-scan.ts`) so the two cannot drift. That
  handle survives #9 because the vault row is plaintext by design, so the
  encryption middleware still has no user-facing write path; the first UI that
  writes an encrypted row retires it.
- **Fixtures:** synthetic bank CSV/XLSX files with fake data in Italian formats,
  under `test/fixtures`. **Never real bank exports.**
- **Coverage:** v8 coverage reporting will be wired into CI once core-track
  units land; no hard threshold gate planned initially — watched at sprint
  review instead.

### Deployment

- **App:** Vercel, one project, a preview deploy per PR and production on `main`.
- **Storybook:** GitHub Pages, published by Actions on merge to `main`, as the
  repo's public living design docs. There are no per-PR Pages previews; CI
  uploads `storybook-static` as a workflow artifact on every PR instead.
