# Cifra Restart — Design Spec

Date: 2026-08-23
Status: Approved (brainstorming session, sections approved individually)

## Purpose

Restart Cifra — a privacy-first personal finance PWA for the Italian market — as a
public, open-source portfolio project. The previous private iteration
(`/Volumes/Ext Storage/Code/cifra`, 59 local commits, phases 1–2 of 9 complete) is
archived read-only. This repo starts with a clean history and an
aperimonio-style engineering workflow.

Core product value (unchanged from v1): users see exactly where their money goes —
bank transactions, cash expenses, and savings goals — in a single encrypted,
offline-capable interface that never exposes financial data to servers.

## What is ported from the old repo (read-only source)

| Asset | Destination |
|---|---|
| Planning corpus: PROJECT.md, 56 requirements, 9-phase roadmap, decision log, research | `docs/architecture.md` + GitHub issues/labels |
| ADR-003 bank report parsing (formats, profiles, sign/date/encoding conventions) | `docs/architecture.md` import section |
| i18n strings, EN/IT (~108 keys) | `app/i18n/` resources |

Everything else — UI components, import service code, stores, crypto code — is
rebuilt from scratch. The old repo is never written to.

## Stack (latest versions at scaffold time)

- Node 24 LTS (`.nvmrc`, `engines`), npm
- React 19, React Router 7 **framework mode with `ssr: false`** (pure SPA)
- TypeScript 5.9+, Tailwind 4 (CSS-first `@theme` tokens), Zustand 5
- Dexie 4 (IndexedDB), date-fns 4
- Firebase 12 — **auth only** (Google sign-in); no server-side data, ever
- PapaParse (CSV), **exceljs** (XLSX; replaces CVE-stale `xlsx`/SheetJS npm build)
- hash-wasm (Argon2id)
- Quality: Biome 2, lefthook, commitlint (conventional), Vitest 4, Playwright,
  Storybook 10 (+ Vitest addon), Renovate, GitHub Actions (pinned SHAs)
- PWA: vite-plugin-pwa (Workbox), installable from first scaffold
- License: **Apache 2.0**

### `verify` contract

`npm run verify` = `typecheck && lint && format:check && test:unit && build && build-storybook`.
CI runs exactly this on every PR. Playwright e2e is a separate, slower CI job.

## Architecture

### Layering

```
pages (RR7 routes) → stores (Zustand) → services (pure TS) → db (Dexie 4 + middleware) → crypto (Web Crypto utils)
```

Services never import React. Crypto never imports Dexie. Each layer is
unit-testable in isolation (`fake-indexeddb` for the db layer).

### Crypto & key hierarchy

1. **Identity**: Firebase Google sign-in. Identity only — never touches encryption.
2. **Vault**: master password → **Argon2id** (hash-wasm; 64 MB memory, iterations
   tuned to ~500 ms on target device, per-user random 16-byte salt) → 256-bit
   master key, imported as a **non-extractable `CryptoKey`**.
3. Master key **wraps** a randomly generated data key (AES-KW). Wrapped data key +
   salt + Argon2id params live in a plaintext `meta` table. This enables password
   change without re-encrypting the DB and future additional unlock methods
   (Phase 8 device pairing).
4. Data key encrypts records via **AES-256-GCM**, random 12-byte IV per record,
   IV stored alongside ciphertext. GCM auth tag gives tamper detection.

### Encryption middleware (Dexie 4 DBCore)

`app/db/encryption-middleware.ts` intercepts `mutate` (encrypt before write) and
`get`/`getMany`/`query` (decrypt after read). DBCore is promise-based, so async
Web Crypto works (the constraint that forced TweetNaCl in v1 is gone).

- Per-table field allowlist: indexed query fields (id, date, type) stay plaintext
  for IndexedDB range queries; everything sensitive (amount, description,
  category, notes) is encrypted as a single blob field.
- Session: data key lives in module-scoped memory only; lock = drop the
  reference; auto-lock on idle timeout.

### Money

Integer cents (`-1234` = −12,34 €), never floats. Exact arithmetic, stable
equality (reconciliation matching, dedup hashing), no drift in derived balances.
Formatting only at the display edge (`Intl.NumberFormat('it-IT')`); parsing at
the import edge (Italian format `1.234,56` → `123456`).

### Bank import: pluggable parsers + format identification

- **`StatementParser` interface**: `id`, `canParse(file, sniff) → confidence`,
  `parse(file) → { headers, rows }`. Parsers live in a registry; adding a future
  format (PDF-via-AI, OFX, QIF) = one new module, zero changes elsewhere.
- **Detection stage 1 — container** (magic bytes, not extension): `PK` zip header
  → xlsx (exceljs); CFB header → legacy xls; otherwise text → CSV path with
  BOM/encoding sniff (UTF-8 vs ISO-8859-1) and delimiter sniff (`,` vs `;` —
  Italian exports often use `;`).
- **Detection stage 2 — profile auto-identification**: parsed header set is
  hashed into a signature and matched against built-in + saved profiles.
  Match → profile auto-selected with confidence shown; no match → manual
  column-mapping UI, saveable as a named profile.
- **Profiles are data (JSON), not code.** Built-ins shipped as assets; user
  profiles stored in the encrypted DB; both flow through the same matcher.

Built-in profiles (from ADR-003 / v1):

| Bank | Format | date / desc / amount columns | Encoding |
|---|---|---|---|
| Banca Intesa | CSV | `Data` / `Descrizione` / `Importo` | ISO-8859-1 |
| UniCredit | CSV | `Data Val.` / `Descrizione` / `Importo €` | UTF-8 |
| Fineco | XLSX | `Data` / `Descrizione` / `Entrate/Uscite` | UTF-8 |

Profile shape: `columnMapping`, `dateFormat` (e.g. `dd/MM/yyyy`),
`amountSign: standard | inverted`, `encoding`, `format`.

## Design track: Storybook-first

Storybook is the design workbench and living spec, not an afterthought gallery.

- **Tokens first**: Editorial Italiana v2 as Tailwind 4 `@theme` CSS tokens;
  a tokens story renders palette/type scale for browser review before components.
- **Component contract**: every UI component ships `component.tsx` +
  `component.stories.tsx` in the same PR; stories cover all states
  (empty/loading/error/filled), EN + IT, mobile + desktop viewports. The story is
  the acceptance spec for later page work.
- **Fresh redesign**: v1 components are not copied; the old app is only a memory
  of which screens exist.
- **Page-level stories** for key flows (import wizard, transaction list) with
  mocked stores — whole-screen UX validated while services are still being built.
- **Addons**: a11y (feeds the WCAG 2.1 AA goal), viewport, Vitest addon (stories
  run as smoke tests inside `verify`).
- **i18n in stories**: ported EN/IT strings via decorator + locale toolbar.

### Deployment

- **App**: Vercel, single project, preview deploy per PR, production on `main`.
- **Storybook**: **GitHub Pages** (`gh-pages` via Actions on merge to `main`) —
  the repo's public living design docs, linked from the README.
  No per-PR Pages previews; CI uploads `storybook-static` as a workflow artifact
  on every PR instead.

## Workflow

### Build strategy: two-track with foundation gate

1. **Foundation gate (first)**: scaffold repo — RR7-SPA, Tailwind 4, Biome,
   lefthook, commitlint, CI + `verify`, Storybook, PWA config, Vercel + Pages
   deploys, Apache 2.0, README, CLAUDE.md — plus `docs/architecture.md` and the
   initial issue set for phases 1–3.
2. **Design track** ∥ **Core track** (parallel via Docker sandboxes):
   design = tokens + components in Storybook; core = crypto middleware, db
   schema, auth, services (TDD). Tracks rarely touch the same files.
3. **Pages** land as thin vertical-slice issues joining both tracks per phase.

### Issues, labels, sprints

- GitHub issues are the queue. Each issue carries its governing architecture
  sections inline. `gh issue list --label ready` drives work.
- **Labels** — type: `type:planned`, `type:bug`, `type:security`, `type:debt`,
  `type:design`; priority: `p0` / `p1` / `p2`; status: `ready`, `blocked`;
  context: `phase:1` … `phase:9`.
- **Sprints = GitHub milestones** with due dates ("Sprint 03 (due YYYY-MM-DD)").
  Phase tracking lives in `phase:N` labels, not milestones. Sprint planning picks
  the issue set: `type:planned` prioritized per roadmap; `type:bug` scheduled by
  priority and postponable by design.

### Branching & PRs

Trunk-based; short-lived `feat/<issue>-slug` branches; PR per issue referencing
the issue; conventional commits enforced; semi-linear merge (rebase + merge
commit); branch protection requires green CI + linear history.

### Review gates

- **Per-PR (always)**: CI `verify` + correctness/security code review before merge.
- **Sprint close**: a review pass (correctness + security) over the sprint's
  merged diff. Every finding gets an explicit triage decision:
  - *Not acceptable as-is* → fixed within the sprint (amend open PR or immediate
    fix-PR) before the milestone closes.
  - *Deferrable* → new issue with `type:bug`/`type:security` + priority label,
    planned into a future sprint.
  - Milestone closes only when the triage table is empty. Each sprint gets a
    short retro note in `docs/sprints/NN.md` (decisions + carry-overs).

## Testing

- **Unit (Vitest 4)**: services and crypto pure-TS, TDD. Crypto: Argon2id
  vectors, AES-GCM roundtrip, wrap/unwrap, tamper detection. DB layer with
  `fake-indexeddb`: middleware transparency + **plaintext-leak test** — dump raw
  IndexedDB after writes and assert no known plaintext appears (permanently
  guards the "unreadable via DevTools" criterion).
- **Import**: parser contract tests per format with fixture files; the detection
  matrix (container sniff × profile signature) has its own suite.
- **Component**: Testing Library where logic warrants; all stories run as smoke
  tests via the Storybook Vitest addon — both inside `verify`.
- **E2E (Playwright)**: few critical journeys — vault create → lock → unlock;
  CSV import wizard end-to-end with fixture; manual expense entry → appears in
  list. Separate CI job.
- **Fixtures**: synthetic bank CSVs/XLSX (fake data, Italian formats) in
  `test/fixtures`. Never real bank exports.
- **Coverage**: v8 coverage reported in CI; no hard threshold gate initially;
  watched in sprint reviews.

## Decisions log

| # | Decision |
|---|---|
| D1 | Fresh public repo, clean history; old repo archived read-only |
| D2 | Apache 2.0 license |
| D3 | RR7 framework mode, `ssr: false` (pure SPA + PWA) |
| D4 | Web Crypto AES-256-GCM + hash-wasm Argon2id; custom Dexie 4 DBCore middleware; no `dexie-encrypted` |
| D5 | Key hierarchy: master key wraps random data key (AES-KW) — password change without DB re-encryption |
| D6 | exceljs replaces `xlsx` (SheetJS npm CVE staleness) |
| D7 | Google sign-in (Firebase, identity only) + master password for vault |
| D8 | Port planning corpus + ADR-003 + i18n strings only; rebuild all code and UI |
| D9 | App on Vercel; Storybook on GitHub Pages as living docs; PR Storybook builds as CI artifacts |
| D10 | Two-track build: Storybook design track ∥ core services track, joined by vertical-slice page issues |
| D11 | Sprints as GitHub milestones with due dates; phases as `phase:N` labels |
| D12 | Sprint-close review gate: every finding triaged fix-now vs new-issue before milestone closes |
| D13 | Money as integer cents everywhere; format/parse only at edges |
| D14 | Pluggable `StatementParser` registry + two-stage format identification (container magic bytes, then profile header signature) |
| D15 | Public from first commit |

## Out of scope (v1, unchanged from old roadmap)

AI features (auto-categorization, receipt scanning, PDF import via AI vision),
OFX/QIF parsers. Architecture leaves room for them (parser registry, AI provider
setting) but no implementation.

## Success criteria for the foundation gate

1. `npm run verify` green locally and in CI on a trivial PR
2. App deploys to Vercel (preview + production), installable as PWA, offline shell works
3. Storybook deploys to GitHub Pages from `main`
4. Branch protection + semi-linear merge active; commitlint rejects bad messages
5. `docs/architecture.md` committed; phase 1–3 issues created with labels/milestone
6. Old repo untouched (verifiable: no new commits/files there)
