import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  extractModuleReferences,
  type ModuleReference,
  packagesMatching,
} from '../support/import-graph';
import { REPO_ROOT, repoImportGraph } from '../support/repo-graph';

/**
 * Mechanical enforcement of the FOUN-07 delivery rule.
 *
 * The rule: **no module the app renders may name a string table.** The locale
 * is resolved once from the browser's language preferences and delivered
 * through the locale store; a page reads `useStrings()`, the shell and the
 * `app/ui` primitives take strings as props, and only `app/i18n/locale.ts`
 * imports `en` and `it` as values.
 *
 * This suite exists because the defect it guards had already shipped twice:
 * `app/routes/home.tsx` and `app/routes/app-layout.tsx` both imported `en`
 * directly, which pinned the app to English whatever a resolver might decide
 * (#47, seam 2). A comment asking future authors not to do that again is not a
 * guard — indeed the comment that stood there was actively wrong — so the rule
 * is read off the TypeScript AST instead, with the same walker
 * `test/unit/auth-boundary.test.ts` uses (`test/support/import-graph.ts`).
 *
 * The scan is file-wise over all of `app/`, not a walk from an entry point.
 * Two reasons: `app/routes.ts` registers routes by *string* path, so no import
 * edge connects a page to the root, and a rule that only covered reachable
 * files would go quiet exactly when a new page is added but not yet routed.
 */

/** The string tables. Reachable from app code only through the resolver. */
const TABLES = ['app/i18n/en', 'app/i18n/it'] as const;

/** The one module allowed to name them. */
const RESOLVER = 'app/i18n/locale.ts';

/** Repo-relative, extensionless target of a relative or `~/` specifier. */
function targetOf(fromFile: string, specifier: string): string | null {
  let absolute: string;
  if (specifier.startsWith('.')) {
    absolute = resolve(dirname(join(REPO_ROOT, fromFile)), specifier);
  } else if (specifier.startsWith('~/')) {
    absolute = resolve(REPO_ROOT, 'app', specifier.slice(2));
  } else {
    return null;
  }
  return relative(REPO_ROOT, absolute).replace(/\.(?:tsx?|jsx?)$/, '');
}

/** `true` when this reference pulls a string table in as a *value*. */
function namesATable(fromFile: string, reference: ModuleReference): boolean {
  if (reference.typeOnly) return false; // a shape, not a table
  const target = targetOf(fromFile, reference.specifier);
  return target !== null && (TABLES as readonly string[]).includes(target);
}

/** Every `.ts`/`.tsx` file under `app/`, repo-relative. */
function appSources(directory = 'app'): string[] {
  return readdirSync(join(REPO_ROOT, directory), { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return appSources(path);
      return /\.tsx?$/.test(entry.name) ? [path] : [];
    })
    .sort();
}

const sources = appSources();

describe('locale delivery boundary', () => {
  it('scans the whole app source tree', () => {
    expect(sources.length).toBeGreaterThan(20);
    expect(sources).toContain('app/routes/home.tsx');
    expect(sources).toContain('app/routes/app-layout.tsx');
    expect(sources).toContain(RESOLVER);
  });

  it('names a table from the resolver and nowhere else', () => {
    const offenders: string[] = [];
    let resolverEdges = 0;

    for (const file of sources) {
      const source = readFileSync(join(REPO_ROOT, file), 'utf8');
      const { references, computed } = extractModuleReferences(source, file);
      // A specifier the parser cannot read statically would make every
      // assertion below a guess. The walker's own suite covers the forms.
      expect(computed, `${file} has a non-literal module specifier`).toEqual(
        [],
      );

      for (const reference of references) {
        if (!namesATable(file, reference)) continue;
        if (file === RESOLVER) {
          resolverEdges += 1;
          continue;
        }
        offenders.push(`${file}:${reference.line} imports its own copy table`);
      }
    }

    expect(offenders).toEqual([]);
    // Non-vacuity: the resolver really does pull both tables in.
    expect(resolverEdges).toBe(TABLES.length);
  });

  it('detects the exact defect it exists to prevent', () => {
    // The line that shipped in `app/routes/home.tsx`. If the predicate above
    // ever stopped recognising it, the suite would pass by seeing nothing.
    const { references } = extractModuleReferences(
      "import { en } from '../i18n/en';\nexport const x = en;\n",
      'app/routes/home.tsx',
    );
    expect(
      references.filter((reference) =>
        namesATable('app/routes/home.tsx', reference),
      ),
    ).toHaveLength(1);

    // …and a type-only import of the shape is not the defect.
    const typeOnly = extractModuleReferences(
      "import type { Strings } from '../i18n/en';\n",
      'app/routes/home.tsx',
    );
    expect(
      typeOnly.references.filter((reference) =>
        namesATable('app/routes/home.tsx', reference),
      ),
    ).toHaveLength(0);
  });

  it('routes read their copy from the locale store', () => {
    for (const route of ['app/routes/home.tsx', 'app/routes/app-layout.tsx']) {
      const source = readFileSync(join(REPO_ROOT, route), 'utf8');
      const targets = extractModuleReferences(source, route).references.map(
        (reference) => targetOf(route, reference.specifier),
      );
      expect(targets, route).toContain('app/stores/use-locale');
    }
  });
});

describe('locale layer contract', () => {
  it('keeps the resolver and the store free of React', () => {
    // docs/architecture.md §Stack and layering: the React binding lives in
    // `use-locale.ts` alone, so everything under it is plain TS and this
    // project (Node, no DOM) can test it.
    for (const entry of [RESOLVER, 'app/stores/locale.ts']) {
      const graph = repoImportGraph(entry);
      expect(graph.files.size, entry).toBeGreaterThan(1);
      expect(packagesMatching(graph, 'react', 'react-dom'), entry).toEqual([]);
    }
  });
});
