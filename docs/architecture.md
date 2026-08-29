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
| §Decisions | [Decisions](#decisions) | D1–D17 + carried-over v1 decisions |
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
2. **Vault** — master password → Argon2id (hash-wasm; 64 MB memory, iterations
   tuned to roughly 500 ms on the target device, per-user random 16-byte salt) →
   256-bit master key, imported as a **non-extractable `CryptoKey`**.
3. **Wrapping** — the master key wraps a randomly generated data key with AES-KW.
   The wrapped data key, the salt, and the Argon2id parameters live in a
   plaintext `meta` table. This allows password changes without re-encrypting
   the database, and leaves room for additional unlock methods (Phase 8 device
   pairing).
4. **Records** — the data key encrypts record payloads with AES-256-GCM, a random
   12-byte IV per record stored alongside the ciphertext. The GCM auth tag
   provides tamper detection.

### Encryption middleware

`app/db/encryption-middleware.ts` is a Dexie 4 DBCore middleware. It intercepts
`mutate` to encrypt before writes, and `get` / `getMany` / `query` to decrypt
after reads. DBCore is promise-based, so async Web Crypto works natively — the
constraint that forced synchronous TweetNaCl in v1 no longer applies.

### Table field allowlist

Encryption is per-table and allowlist-driven:

- **Plaintext (indexed):** the fields IndexedDB must range-query — `id`, `date`,
  `type`, and equivalent keys. These are structural, not financial content.
- **Encrypted (single blob field):** everything sensitive — `amount`,
  `description`, `category`, `notes`, and any free text.
- **Plaintext by design:** the `meta` table (wrapped data key, salt, KDF params).

The allowlist is the security contract for the db layer and is asserted by a
plaintext-leak test that dumps raw IndexedDB after writes and fails if any known
plaintext value appears (see §Workflow, testing).

### Session lifetime

The data key lives in module-scoped memory only. Locking drops the reference;
an idle timeout auto-locks. The key is never written to any storage.

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
  the list. Separate CI job.
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
