# CLAUDE.md — working agreement for Cifra

Cifra is a privacy-first, local-first personal finance PWA for the Italian
market. Financial data is encrypted in the browser and never reaches a server in
plaintext. Read `docs/architecture.md` before writing code — it is the contract
this repo is built against.

## Repo state

The **foundation gate has landed**: React Router SPA scaffold, Tailwind 4,
Biome, lefthook + commitlint, Storybook 10, PWA manifest and service worker,
Playwright smoke e2e, the `verify` contract, and the ported EN/IT strings. No
product feature is implemented yet — phases 1–9 in `docs/architecture.md`
§Roadmap are all open work.

The Phase 1–3 backlog (22 issues) is filed; Sprint 01 scope is issues #1–#8
(Phase 1 design + core tracks, milestone "Sprint 01").

The queue is GitHub issues:

```bash
gh issue list --label ready
```

Each issue names the architecture sections that govern it
(`Governed by: docs/architecture.md §Crypto`). Work the issue's governing
sections before improvising; if the issue and the architecture disagree, stop
and resolve it rather than picking one.

## Work tracking: issues, labels, sprints

**Issues are the only queue.** No plan documents drive execution — an issue
carries everything: a one-paragraph goal, its `Governed by:` architecture
sections, and acceptance bullets. If work isn't an issue, file one before
starting it (`type:*` + priority + `phase:N` labels, body in the same shape).

**Label taxonomy** (every issue gets one of each of the first three):

- *Type*: `type:planned` (roadmap work) · `type:bug` · `type:security` ·
  `type:debt` · `type:design` (Storybook/design-track work, ships component +
  stories in the same PR)
- *Priority*: `p0` (drop everything) · `p1` (this or next sprint) · `p2`
  (backlog). Bugs are scheduled by priority — a `p2` bug can wait, `type:planned`
  roadmap work is prioritized per the architecture §Roadmap order.
- *Phase*: `phase:1` … `phase:9` — maps the issue to the architecture roadmap.
- *Status*: `ready` = claimable now (dependencies met); `blocked` = waiting on
  another issue, named in the body. When a blocking issue closes, move its
  dependents to `ready`.

**Sprints are GitHub milestones** ("Sprint 01", "Sprint 02", …) with a due
date — nothing else is a sprint. Phases are *labels*, never milestones. The
lifecycle:

1. **Plan**: agree an issue set with the owner, assign the milestone, set the
   due date (~2 weeks). `gh issue list --milestone "Sprint NN"` is the sprint
   scope; scope changes mid-sprint are deliberate decisions, not drift. The
   **milestone description** records the sprint's track structure, intra-sprint
   ordering, and what was deliberately excluded — read it first:
   `gh api repos/conteit/cifra/milestones --jq '.[] | .title, .description'`.
2. **Execute**: one issue → one `feat/<issue>-slug` branch → one PR referencing
   the issue (`Closes #N`). PR merges only on green required checks.
3. **Sprint close — the review gate**: before the milestone closes, run a
   correctness + security review pass over the sprint's merged diff. Every
   finding gets an explicit decision, recorded where it was made:
   - *not acceptable as-is* → fixed inside the sprint (amend the open PR or an
     immediate fix-PR) before the milestone closes;
   - *deferrable* → new issue with `type:bug`/`type:security` + priority,
     scheduled by priority into a later sprint. **Never silently dropped.**
4. **Retro**: a short note in `docs/sprints/NN.md` — what shipped, decisions
   made, carry-overs — then close the milestone and plan the next one.

**Deferred work goes into issue bodies, not into memory or chat.** When a
review or a task uncovers follow-up work, append it to the owning issue's
acceptance bullets (see #1 and #9 for the pattern) or file a new issue — that
way any session, human or agent, picks it up from GitHub alone.

## Authoritative docs, in precedence order

1. **`docs/architecture.md`** — product, requirements (68 IDs), roadmap,
   decision log D1–D15, crypto/data contract, import pipeline, workflow.
   Highest authority. If code contradicts it, the code is wrong, or the doc
   needs an explicit decision update in the same PR.
2. **Storybook** (`npm run storybook`) — the living design spec. A component's
   stories define its states, its EN/IT copy, and its responsive behaviour.
   Build components against their stories, not against screenshots.
3. **The code** — lowest authority. Read it to learn what exists; do not treat
   an existing pattern as a decision.

`docs/superpowers/specs/2026-08-23-cifra-restart-design.md` is the source spec
behind `docs/architecture.md`. It is historical: cite it for rationale, but
`docs/architecture.md` is what binds.

The archived v1 prototype lives at `/Volumes/Ext Storage/Code/cifra`.
**Read-only reference. Never write there, never commit there, never run its
scripts.** Only the planning corpus, ADR-003, and the i18n strings were ported;
all v1 code and UI is rebuilt from scratch here (D8). Where its docs conflict
with `docs/architecture.md` — PBKDF2, `dexie-encrypted`, SheetJS, PDF import via
AI — the architecture doc wins and the v1 choice is dead.

## The `verify` contract

```bash
npm run verify
```

is exactly:

```
typecheck && lint && format:check && test:unit && test:stories && build && build-storybook
```

CI runs **exactly this** on every PR — nothing more, nothing less. Green
locally means green in CI. Never claim work is done without having run it and
seen it pass.

Individual stages: `npm run typecheck`, `npm run lint`, `npm run format`
(writes) / `npm run format:check` (verifies), `npm run test:unit`,
`npm run test:stories`, `npm run build`, `npm run build-storybook`.

Vitest runs two projects (`vitest.config.ts`):

- **`unit`** — `npm run test:unit` (`vitest run --project unit`). Node
  environment, no browser. Services, crypto, i18n. Keep it that way: nothing in
  this project may need Playwright.
- **`stories`** — `npm run test:stories` (`vitest run --project stories`). Every
  Storybook story rendered as a smoke test in headless Chromium via
  `@storybook/addon-vitest`. Needs `npx playwright install chromium`; CI's
  `verify` job installs it the same way the `e2e` job does.

E2E is **not** part of `verify` — it runs separately, and as its own CI job:

```bash
npm run test:e2e
```

`npm run test:e2e` runs Playwright (`playwright test`); CI's `e2e` job uses
this same alias.

Notes on the build: React Router runs in framework mode with `ssr: false`, so
the app is a pure SPA. `npm run build` ends with `rm -rf build/server` — that is
a deliberate workaround for the framework emitting an unused server bundle in
SPA mode, not dead code. Leave it.

## Development

```bash
nvm use          # Node 24, pinned in .nvmrc and engines
npm ci
npm run dev      # app on the Vite dev server
npm run storybook # design workbench on :6006
```

## Commits and branches

Conventional commits, enforced by commitlint on `commit-msg`. Subject in
lower-case, header at most 72 characters. Allowed scopes:

`app` · `ui` · `db` · `crypto` · `i18n` · `import` · `infra` · `deps` · `docs`

Hooks (lefthook): `pre-commit` runs `format:check` and `lint`; `commit-msg`
runs commitlint; `pre-push` refuses direct pushes to `main`. Work on
short-lived `feat/<issue>-slug` branches and open a PR per issue. Do not
`--no-verify` around a failing hook — fix the cause.

## Deployment & operations

- **App → Vercel**: project `cifra` (team `paolos-projects-9edadd41`), connected
  to GitHub — preview deploy per PR, production on `main`. Config in
  `vercel.json` (static SPA: `build/client` output, catch-all rewrite).
- **Deployment protection is ON deliberately** (Vercel Authentication, all
  deployments): the owner wants access control until the app is ready. Do not
  propose disabling it. For automated checks against real deployments, the repo
  Actions secret `VERCEL_AUTOMATION_BYPASS_SECRET` exists — send it as the
  `x-vercel-protection-bypass` header (add `x-vercel-set-bypass-cookie=true`
  for browser flows). Nothing in CI uses it yet; today's `e2e` job tests the
  local build.
- **Storybook → GitHub Pages** at https://conteit.github.io/cifra/ (public,
  deployed by `deploy-storybook.yml` on every merge to `main`). PRs additionally
  upload `storybook-static` as a CI artifact.
- **Branch protection on `main`**: required checks `verify`, `e2e`,
  `semi-linear`; strict (branch must be up to date); linear history. Merge PRs
  with `gh pr merge --rebase`. GitHub Actions are SHA-pinned; Renovate
  (`renovate.json`, includes `helpers:pinGitHubActionDigests`) maintains pins
  and dependency updates — its Dependency Dashboard issue appears once the
  first scan runs.
- **Sprints are GitHub milestones** with due dates ("Sprint 01"); phases are
  `phase:N` labels. Before a sprint's milestone closes, a correctness+security
  review pass runs over the sprint's merged work; every finding is either fixed
  inside the sprint or filed as a new prioritized issue — never silently
  dropped. Sprint retros go in `docs/sprints/NN.md`.

## Rules that are not negotiable

- **No real bank data in fixtures.** Every CSV/XLSX fixture under
  `test/fixtures` is synthetic: invented names, invented IBANs, invented
  amounts, real Italian *formats*. Never commit an actual bank export, not even
  a redacted one, not even temporarily.
- **No plaintext financial data leaves the crypto boundary.** Amounts,
  descriptions, categories, and notes are encrypted before they reach IndexedDB.
  The plaintext-leak test exists to catch regressions — do not weaken or skip it.
- **Money is integer cents.** No floats, anywhere, ever. Parse at the import
  edge, format at the display edge (`Intl.NumberFormat('it-IT')`).
- **Layer contract:** services never import React; crypto never imports Dexie.
- **Semantic design tokens only** — components reference token names, never raw
  colour or size values.
- **Both locales, always.** EN and IT keys stay in parity (`app/i18n/en.ts`,
  `app/i18n/it.ts`, 134 keys each, guarded by a parity test). Adding a key to
  one file without the other breaks `test:unit`.
- **Firebase is auth only.** No financial data in Firestore, ever, except the
  encrypted sync blobs specified in `docs/architecture.md` §Roadmap Phase 8.

## Layout

```
app/            application code (routes, i18n; db/crypto/services land per phase)
stories/        Storybook stories for design-system work
test/unit/      Vitest suites
test/e2e/       Playwright specs
docs/           architecture.md and specs
.storybook/     Storybook config
```
