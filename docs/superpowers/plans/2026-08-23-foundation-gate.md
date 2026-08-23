# Foundation Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold the public cifra repo with the full toolchain, CI, deploy pipelines, ported docs/i18n, and the phase 1–3 issue backlog — so the two-track build can start.

**Architecture:** React Router 7 framework mode with `ssr: false` (pure SPA + PWA), Tailwind 4, Storybook as design workbench, `verify` as the single quality contract enforced locally (lefthook) and in CI. GitHub issues/labels/milestones are the work queue.

**Tech Stack:** Node 24, React 19, RR7, TypeScript 5.9+, Tailwind 4, Biome 2, lefthook, commitlint, Vitest 4, Playwright, Storybook 10, vite-plugin-pwa, GitHub Actions, Vercel (app), GitHub Pages (Storybook).

**Spec:** `docs/superpowers/specs/2026-08-23-cifra-restart-design.md`

## Global Constraints

- Repo root: `/Volumes/Ext Storage/Code/GitHub/cifra`. The old repo `/Volumes/Ext Storage/Code/cifra` is READ-ONLY source material — never write there.
- Node 24 LTS (`.nvmrc` = `24`, `engines.node` = `>=24 <25`), npm.
- `ssr: false` in `react-router.config.ts` — the app is a static SPA; never enable SSR.
- License: Apache 2.0. Public repo from first push.
- Conventional commits, header ≤ 72 chars, lower-case subject. Scopes: `app`, `ui`, `db`, `crypto`, `i18n`, `import`, `infra`, `deps`, `docs`.
- `verify` = `typecheck && lint && format:check && test:unit && build && build-storybook`. CI runs exactly this.
- No real bank exports anywhere — synthetic fixtures only.
- Latest stable versions of all dependencies at install time; if an API differs from a code block below, consult current docs (context7) and adapt — the step's Expected outcome is the contract, not the exact snippet.

---

### Task 1: Scaffold RR7 SPA + repo hygiene

**Files:**
- Create: entire app scaffold (via `create-react-router`), `react-router.config.ts`, `.nvmrc`, `LICENSE`, `.gitignore`, `.env.example`, `README.md` (skeleton)

**Interfaces:**
- Produces: `npm run dev` / `npm run build` working RR7 SPA; `app/` directory convention all later tasks build on.

- [ ] **Step 1: Scaffold into temp dir, copy into repo**

```bash
cd /private/tmp/claude-501/-Volumes-Ext-Storage-Code-cifra/*/scratchpad 2>/dev/null || cd /tmp
npx --yes create-react-router@latest cifra-scaffold --no-git-init --no-install
rsync -a --exclude .git cifra-scaffold/ "/Volumes/Ext Storage/Code/GitHub/cifra/"
cd "/Volumes/Ext Storage/Code/GitHub/cifra" && npm install
```

(The default template ships React 19 + Tailwind 4 + TypeScript.)

- [ ] **Step 2: Force SPA mode**

`react-router.config.ts`:

```ts
import type { Config } from "@react-router/dev/config";

export default {
  ssr: false,
} satisfies Config;
```

- [ ] **Step 3: Pin Node + engines**

`.nvmrc` containing `24`. In `package.json`: `"engines": { "node": ">=24 <25" }`.

- [ ] **Step 4: License + gitignore + env example**

```bash
gh api licenses/apache-2.0 --jq .body > LICENSE
```

`.gitignore` must cover: `node_modules/`, `build/`, `storybook-static/`, `.react-router/`, `test-results/`, `playwright-report/`, coverage, `.env`, `.env.*`, `!.env.example`, `.DS_Store`, `._*`, `.Spotlight-V100`, `.Trashes`, `.vscode/`, `.idea/`, `*.iml`, `*.log`.

`.env.example`:

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
```

`README.md` skeleton: project name, one-line description ("Privacy-first personal finance PWA — local-first, end-to-end encrypted"), placeholder sections `## Architecture` (link `docs/architecture.md`), `## Development`, `## Design system` (Storybook link added in Task 11).

- [ ] **Step 5: Verify dev build works**

Run: `npm run build`
Expected: build succeeds, output in `build/client/` only (no `build/server/` — proves SPA mode).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(app): scaffold react router 7 spa"
```

---

### Task 2: Biome 2 (lint + format)

**Files:**
- Create: `biome.json`
- Modify: `package.json` (scripts)

**Interfaces:**
- Produces: `npm run lint`, `npm run format`, `npm run format:check` — used by `verify` (Task 8) and lefthook (Task 3).

- [ ] **Step 1: Install and init**

```bash
npm install -D @biomejs/biome
npx biome init
```

In `biome.json` set: 2-space indent, single quotes, organize imports on. Exclude `build/`, `.react-router/`, `storybook-static/` via `files.includes` negations.

- [ ] **Step 2: Add scripts**

```json
"lint": "biome lint .",
"format": "biome format --write .",
"format:check": "biome format ."
```

- [ ] **Step 3: Format the scaffold, verify green**

Run: `npm run format && npm run lint && npm run format:check`
Expected: all exit 0.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(infra): add biome lint and format"
```

---

### Task 3: commitlint + lefthook

**Files:**
- Create: `commitlint.config.js`, `lefthook.yml`
- Modify: `package.json` (`prepare` script)

- [ ] **Step 1: Install**

```bash
npm install -D @commitlint/cli @commitlint/config-conventional lefthook
```

- [ ] **Step 2: commitlint config**

`commitlint.config.js`:

```js
export default {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'scope-enum': [
      2,
      'always',
      ['app', 'ui', 'db', 'crypto', 'i18n', 'import', 'infra', 'deps', 'docs'],
    ],
    'subject-case': [2, 'always', 'lower-case'],
    'header-max-length': [2, 'always', 72],
  },
};
```

- [ ] **Step 3: lefthook config**

`lefthook.yml`:

```yaml
commit-msg:
  commands:
    commitlint:
      run: npx --no-install commitlint --edit {1}

pre-commit:
  commands:
    format:
      run: npm run format:check
    lint:
      run: npm run lint

pre-push:
  commands:
    no-direct-push-to-main:
      only:
        - ref: main
      run: |
        echo "Refusing to push directly to main. Open a pull request."
        echo "If you really mean it: git push --no-verify"
        exit 1
```

`package.json`: `"prepare": "if [ -e .git ] && command -v lefthook >/dev/null 2>&1; then lefthook install; else echo 'skipping git hooks'; fi"` then run `npx lefthook install`.

- [ ] **Step 4: Verify hook rejects bad message**

Run: `git commit --allow-empty -m "bad message"`
Expected: FAIL (commitlint). Then clean up nothing (commit was rejected).

- [ ] **Step 5: Commit properly**

```bash
git add -A && git commit -m "feat(infra): add commitlint and lefthook hooks"
```

---

### Task 4: Vitest 4 + i18n port (TDD)

**Files:**
- Create: `vitest.config.ts`, `app/i18n/en.ts`, `app/i18n/it.ts`, `app/i18n/index.ts`, `test/unit/i18n.test.ts`
- Read (old repo, read-only): `/Volumes/Ext Storage/Code/cifra/src/i18n/strings.ts`

**Interfaces:**
- Produces: `npm run test:unit`; `Strings` type and `en`/`it` exports from `app/i18n` — phase-1 UI work consumes these.

- [ ] **Step 1: Install + config**

```bash
npm install -D vitest @vitest/coverage-v8
```

`vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/unit/**/*.test.ts', 'app/**/*.test.ts'],
    environment: 'node',
  },
});
```

Script: `"test:unit": "vitest run"`.

- [ ] **Step 2: Write failing parity test**

`test/unit/i18n.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { en } from '../../app/i18n/en';
import { it as itStrings } from '../../app/i18n/it';

describe('i18n locales', () => {
  it('en and it expose identical key sets', () => {
    expect(Object.keys(itStrings).sort()).toEqual(Object.keys(en).sort());
  });

  it('no empty values', () => {
    for (const locale of [en, itStrings]) {
      for (const [key, value] of Object.entries(locale)) {
        expect(value, key).not.toBe('');
      }
    }
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm run test:unit`
Expected: FAIL — cannot resolve `app/i18n/en`.

- [ ] **Step 4: Port strings from old repo**

Read `/Volumes/Ext Storage/Code/cifra/src/i18n/strings.ts`. It defines `en` and `it` maps (~108 keys each, values are strings or `(args) => string` functions). Split into:

- `app/i18n/en.ts` — `export const en = { ... } as const;` (copy the en map verbatim; keep function values)
- `app/i18n/it.ts` — `export type Strings = typeof en;` consistency via `export const it: Record<keyof typeof en, string | ((...args: never[]) => string)> = { ... };` (copy the it map)
- `app/i18n/index.ts` — `export { en } from './en'; export { it } from './it';`

Drop keys that reference features cut from the restart (AI provider setup screens) only if the same key is dropped from BOTH locales — the parity test enforces this.

- [ ] **Step 5: Run test to verify it passes**

Run: `npm run test:unit`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(i18n): port en/it strings with parity test"
```

---

### Task 5: Storybook 10 + tokens story

**Files:**
- Create: `.storybook/main.ts`, `.storybook/preview.ts`, `stories/tokens.stories.tsx`
- Modify: `package.json` (scripts)

**Interfaces:**
- Produces: `npm run storybook`, `npm run build-storybook`; `stories/` as the home for design-track work.

- [ ] **Step 1: Init Storybook with react-vite**

```bash
npx storybook@latest init --yes
npx storybook add @storybook/addon-a11y
```

- [ ] **Step 2: Strip the React Router plugin from Storybook's Vite config**

The RR7 plugin aborts inside Storybook ("requires the use of a Vite config file"). `reactRouter()` returns an *array* of plugins, so a flat name filter misses it. In `.storybook/main.ts`:

```ts
import type { StorybookConfig } from '@storybook/react-vite';
import type { PluginOption } from 'vite';

function withoutReactRouter(plugins: PluginOption[]): PluginOption[] {
  const isReactRouter = (plugin: PluginOption): boolean =>
    Array.isArray(plugin)
      ? plugin.some(isReactRouter)
      : Boolean(
          plugin &&
            typeof plugin === 'object' &&
            'name' in plugin &&
            typeof plugin.name === 'string' &&
            plugin.name.startsWith('react-router'),
        );
  return plugins.filter((p) => !isReactRouter(p));
}

const config: StorybookConfig = {
  framework: '@storybook/react-vite',
  stories: ['../stories/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y'],
  async viteFinal(cfg) {
    const { default: react } = await import('@vitejs/plugin-react');
    return {
      ...cfg,
      plugins: [...withoutReactRouter(cfg.plugins ?? []), react()],
    };
  },
};
export default config;
```

(`npm install -D @vitejs/plugin-react` — supplies the JSX transform the RR plugin was providing. Also make sure vite-plugin-pwa, added in Task 6, does NOT need stripping — it is inert without build.)

`.storybook/preview.ts` imports the app stylesheet (`../app/app.css`) so Tailwind tokens apply in stories.

- [ ] **Step 3: Placeholder tokens story**

`stories/tokens.stories.tsx`:

```tsx
import type { Meta, StoryObj } from '@storybook/react-vite';

function Tokens() {
  return (
    <div className="p-8 font-sans">
      <h1 className="text-2xl">Editorial Italiana v2 — tokens</h1>
      <p className="text-sm opacity-70">
        Placeholder. The design-track tokens issue replaces this with the full
        palette and type scale.
      </p>
    </div>
  );
}

const meta: Meta<typeof Tokens> = { title: 'Design/Tokens', component: Tokens };
export default meta;
export const Default: StoryObj<typeof Tokens> = {};
```

Delete any example stories the init generated.

- [ ] **Step 4: Verify build**

Run: `npm run build-storybook`
Expected: exit 0, `storybook-static/` produced.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(ui): add storybook workbench with a11y addon"
```

---

### Task 6: PWA

**Files:**
- Modify: `vite.config.ts`
- Create: `public/icons/icon-192.png`, `public/icons/icon-512.png` (placeholder solid-color icons; generate with an inline node script or ImageMagick)

- [ ] **Step 1: Install and configure**

```bash
npm install -D vite-plugin-pwa
```

`vite.config.ts` — add to plugins (after the RR plugin):

```ts
import { VitePWA } from 'vite-plugin-pwa';

VitePWA({
  registerType: 'autoUpdate',
  manifest: {
    name: 'Cifra',
    short_name: 'Cifra',
    description: 'Privacy-first personal finance — local, encrypted',
    theme_color: '#1a1a1a',
    background_color: '#faf7f2',
    display: 'standalone',
    start_url: '/',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  },
})
```

If the RR7 build rejects the plugin ordering, consult vite-pwa's React Router integration docs via context7 (`vite-plugin-pwa` + `react router`); the contract is Step 2's expected output, not this exact snippet.

- [ ] **Step 2: Verify build emits PWA assets**

Run: `npm run build && ls build/client`
Expected: `manifest.webmanifest` and `sw.js` (or `registerSW.js`) present in `build/client/`.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(app): add pwa manifest and service worker"
```

---

### Task 7: Playwright smoke e2e

**Files:**
- Create: `playwright.config.ts`, `test/e2e/smoke.spec.ts`
- Modify: `app/routes/home.tsx` (or template equivalent) — ensure it renders a `<h1>Cifra</h1>`

- [ ] **Step 1: Install**

```bash
npm install -D @playwright/test
npx playwright install chromium
```

- [ ] **Step 2: Config with static preview server**

`playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'test/e2e',
  webServer: {
    command: 'npm run build && npm run preview',
    port: 4173,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  use: { baseURL: 'http://localhost:4173' },
});
```

Ensure `"preview": "vite preview --port 4173"` script exists.

- [ ] **Step 3: Write smoke test**

`test/e2e/smoke.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test('app shell loads', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Cifra' })).toBeVisible();
});
```

Adjust the home route so the heading exists (replace template welcome content with a minimal `<main><h1>Cifra</h1></main>`).

- [ ] **Step 4: Run to verify pass**

Run: `npx playwright test`
Expected: 1 passed.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(app): add playwright smoke e2e"
```

---

### Task 8: The `verify` contract

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add scripts**

```json
"typecheck": "react-router typegen && tsc --noEmit",
"verify": "npm run typecheck && npm run lint && npm run format:check && npm run test:unit && npm run build && npm run build-storybook"
```

- [ ] **Step 2: Full green run**

Run: `npm run verify`
Expected: exit 0 end-to-end. Fix any typecheck fallout from earlier tasks now.

- [ ] **Step 3: Commit**

```bash
git add -A && git commit -m "feat(infra): wire verify contract"
```

---

### Task 9: Port docs — architecture.md, CLAUDE.md, README

**Files:**
- Create: `docs/architecture.md`, `CLAUDE.md`
- Modify: `README.md`
- Read (old repo, read-only): `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/research/SUMMARY.md`, `.planning/research/PITFALLS.md`, `docs/1-inception/ADR-003-bank-report-parsing.md` — all under `/Volumes/Ext Storage/Code/cifra/`

- [ ] **Step 1: Write `docs/architecture.md`**

Synthesize (not copy-paste) the old planning corpus into this structure:

1. **Product** — core value, target user (Italian personal finance), non-goals for v1 (AI features, OFX/QIF)
2. **Requirements** — the 56 requirement IDs grouped by area (FOUN/IMPT/TXNS/CASH/RECN/ANLY/BDGT/GOAL/FCST/SYNC/ACCT), one line each, from `.planning/REQUIREMENTS.md`
3. **Roadmap** — the 9 phases with goals and success criteria, from `.planning/ROADMAP.md`
4. **Decisions** — D1–D15 copied from the spec's decision log, plus carried-over v1 decisions still binding (integer cents; per-user random Argon2id salt; semantic design tokens only; Italian number parsing rules)
5. **Crypto & data layer** — key hierarchy, middleware, table allowlist (from spec)
6. **Bank import** — parser registry, two-stage detection, built-in profile table with the exact column mappings/encodings from ADR-003
7. **Workflow** — labels, sprints-as-milestones, review gates, `verify` contract (from spec)

- [ ] **Step 2: Write `CLAUDE.md`** (aperimonio style)

Sections: repo state (foundation gate landed, issue queue is `gh issue list --label ready`); authoritative docs in precedence order (`docs/architecture.md` → Storybook → code); the `verify` contract and that CI runs exactly it; commit scopes; old repo path marked read-only reference; "no real bank data in fixtures".

- [ ] **Step 3: Fill README**

Sections: what cifra is, privacy model in 3 bullets (local-first, E2E encrypted, no server data), development quickstart (`nvm use && npm ci && npm run dev`), `verify`, Storybook link placeholder, license badge (Apache 2.0), link to `docs/architecture.md`.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: port architecture, add claude.md and readme"
```

---

### Task 10: CI workflows + Renovate

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/semi-linear-merge.yml`, `.github/workflows/deploy-storybook.yml`, `.github/branch-protection.json`, `renovate.json`

- [ ] **Step 1: `ci.yml`**

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run verify
      - uses: actions/upload-artifact@v7
        if: github.event_name == 'pull_request'
        with:
          name: storybook-static
          path: storybook-static/
          retention-days: 14
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - id: playwright-version
        run: echo "value=$(node -p "require('@playwright/test/package.json').version")" >> "$GITHUB_OUTPUT"
      - id: playwright-cache
        uses: actions/cache@v6
        with:
          path: ~/.cache/ms-playwright
          key: playwright-${{ runner.os }}-${{ steps.playwright-version.outputs.value }}
      - if: steps.playwright-cache.outputs.cache-hit != 'true'
        run: npx playwright install --with-deps chromium
      - if: steps.playwright-cache.outputs.cache-hit == 'true'
        run: npx playwright install-deps chromium
      - run: npm run test:e2e
      - uses: actions/upload-artifact@v7
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

- [ ] **Step 2: `semi-linear-merge.yml`** — copy aperimonio's job verbatim (checkout PR head with `fetch-depth: 0`, assert `git merge-base --is-ancestor origin/main HEAD`, else fail with commits-behind count). Name the job `semi-linear`.

- [ ] **Step 3: `deploy-storybook.yml`**

```yaml
name: Deploy Storybook
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: actions/setup-node@v7
        with:
          node-version-file: .nvmrc
          cache: npm
      - run: npm ci
      - run: npm run build-storybook
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v4
        with:
          path: storybook-static
      - id: deployment
        uses: actions/deploy-pages@v4
```

Storybook must build with a base path for project pages: set `build-storybook` output to work under `/cifra/` — in `.storybook/main.ts` framework options or via `STORYBOOK_BASE_PATH`; verify locally with `npx http-server storybook-static` that assets resolve relatively (Storybook builds relative asset URLs by default — expected to just work).

- [ ] **Step 4: `branch-protection.json`**

```json
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["verify", "e2e", "semi-linear"]
  },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_linear_history": true
}
```

- [ ] **Step 5: `renovate.json`**

```json
{
  "$schema": "https://docs.renovatebot.com/renovate-schema.json",
  "extends": ["config:recommended", ":semanticCommits"],
  "labels": ["type:debt", "p2"],
  "rangeStrategy": "bump"
}
```

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(infra): add ci, storybook pages deploy, branch protection, renovate"
```

---

### Task 11: GitHub repo + Pages + protection + Vercel

**Files:** none new (operations task)

- [ ] **Step 1: Wire existing remote and push**

The repo already exists: `https://github.com/conteit/cifra.git` (user-created).

```bash
cd "/Volumes/Ext Storage/Code/GitHub/cifra"
git remote add origin https://github.com/conteit/cifra.git
git push -u origin main --no-verify   # --no-verify: lefthook blocks direct main pushes; this initial push is deliberate
gh repo edit conteit/cifra --description "Privacy-first personal finance PWA — local-first, end-to-end encrypted"
```

Confirm visibility is public: `gh repo view conteit/cifra --json visibility`.

- [ ] **Step 2: Enable Pages (workflow source)**

```bash
gh api -X POST repos/conteit/cifra/pages -f build_type=workflow || \
gh api -X PUT repos/conteit/cifra/pages -f build_type=workflow
```

Then trigger: push already ran `deploy-storybook.yml` on main. Verify: `gh run list --workflow deploy-storybook.yml` shows success and the Pages URL serves Storybook. Add the URL to README (`## Design system`) and commit via PR once protection is on — or before Step 3 directly on main.

- [ ] **Step 3: Apply branch protection**

```bash
gh api -X PUT repos/conteit/cifra/branches/main/protection --input .github/branch-protection.json
```

Verify: `gh api repos/conteit/cifra/branches/main/protection --jq .required_status_checks.contexts` returns the three contexts.

- [ ] **Step 4: Renovate** — installing the Renovate GitHub App is a user action; ask the user to enable it for the repo at github.com/apps/renovate (or approve fallback to a `dependabot.yml`). Not blocking.

- [ ] **Step 5: Vercel project** — interactive; run with the user present:

```bash
npx vercel link      # create new project "cifra"
npx vercel git connect
```

Framework preset: React Router. Output dir: `build/client`. Verify: PR later in this task list gets a preview deploy comment. If CLI auth is missing, ask the user to run `! npx vercel login` first.

- [ ] **Step 6: Labels**

```bash
for l in "type:planned|0e8a16" "type:bug|d73a4a" "type:security|b60205" "type:debt|fbca04" "type:design|c5def5" "p0|b60205" "p1|d93f0b" "p2|fbca04" "ready|0e8a16" "blocked|000000" "phase:1|ededed" "phase:2|ededed" "phase:3|ededed" "phase:4|ededed" "phase:5|ededed" "phase:6|ededed" "phase:7|ededed" "phase:8|ededed" "phase:9|ededed"; do
  gh label create "${l%%|*}" --color "${l##*|}" --force
done
```

- [ ] **Step 7: Sprint 1 milestone**

```bash
gh api repos/conteit/cifra/milestones -f title="Sprint 01" -f due_on="$(date -v+14d -u +%Y-%m-%dT23:59:59Z)" -f description="Phase 1 core + design tracks"
```

---

### Task 12: Phase 1–3 issue backlog

**Files:** none (operations task). Issue bodies reference `docs/architecture.md` sections.

- [ ] **Step 1: Create issues**

For each row, run `gh issue create --title "<title>" --label "<labels>" --body "<body>"`. Body pattern: one-paragraph goal + `Governed by: docs/architecture.md §<section>` + acceptance bullet(s). Design-track issues also state "ships component + stories (all states, EN+IT, mobile+desktop) in the same PR".

Phase 1 — design track (`type:design,phase:1,ready`):
1. `tokens: editorial italiana v2 palette + type scale` — replaces placeholder tokens story; Tailwind 4 `@theme`; tokens story shows palette, type, spacing. §Design
2. `ui: base components — button, input, card, modal` — stories with a11y checks. §Design
3. `ui: app shell — nav, header, responsive layout` — page-level story with mocked routes. §Design

Phase 1 — core track (`type:planned,phase:1,ready`):
4. `crypto: argon2id kdf module` — hash-wasm; params from architecture; vector tests. §Crypto
5. `crypto: aes-gcm encrypt/decrypt + key wrap/unwrap` — non-extractable keys; tamper test. §Crypto
6. `db: dexie schema + encryption middleware` — DBCore; field allowlist; plaintext-leak test. §Crypto
7. `app: money utils — integer cents, italian parse/format` — parse `1.234,56`; Intl display. §Decisions D13
8. `app: firebase google sign-in + session store` — identity only; no encryption coupling. §Crypto

Phase 1 — pages (`type:planned,phase:1`, blocked-by noted in body, no `ready` label):
9. `app: sign-in + vault setup flow` — joins tracks; e2e: create vault → lock → unlock
10. `app: lock screen + idle auto-lock`

Phase 2 (`type:planned,phase:2`; design items also `type:design`):
11. `import: statement parser registry + container detection` — magic bytes; encoding/delimiter sniff. §Import
12. `import: csv parser (papaparse) + synthetic fixtures`
13. `import: xlsx parser (exceljs) + synthetic fixtures`
14. `import: profile signature matcher + built-in profiles` — Intesa/UniCredit/Fineco from §Import table
15. `import: dedup service + preview counts`
16. `ui: import wizard stories (4 steps, all states)` — `type:design`
17. `import: wizard page + store wiring`
18. `import: import history`

Phase 3 (`type:planned,phase:3`; design items also `type:design`):
19. `ui: transaction list + search stories` — `type:design`
20. `app: manual entry — electronic, cash, planned modes`
21. `app: categories + inline edit + remembered rules`
22. `app: planned→confirmed grace-period conversion`

Assign issues 1–8 to milestone "Sprint 01" (`--milestone "Sprint 01"`).

- [ ] **Step 2: Verify**

Run: `gh issue list --label ready` — expect 8 open issues; `gh issue list --milestone "Sprint 01"` — expect 8.

- [ ] **Step 3: Record queue in CLAUDE.md** — append one line noting backlog created and sprint 1 scope; commit through a PR (protection is on): branch `feat/12-backlog-note`, PR, merge when green. This PR is also the end-to-end validation of CI, preview deploy, semi-linear check, and branch protection — the foundation-gate exit test.

---

## Self-review notes

- Spec coverage: scaffold/toolchain (T1–T8), docs port (T9, i18n T4), CI + deploys (T10–T11), labels/sprint/issues (T11–T12), success criteria 1–6 all exercised (criterion 6 by construction — old repo only in read steps).
- Storybook base-path risk on GitHub Pages and vite-plugin-pwa × RR7 ordering flagged inline with fallback instructions.
- Firebase auth implementation is deliberately NOT in the foundation gate (issue 8) — only `.env.example` placeholders.
