import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import ts from 'typescript';

/**
 * The module-graph walker the boundary suites are built on.
 *
 * `test/unit/auth-boundary.test.ts` and `test/unit/db/layer-boundary.test.ts`
 * are the *only* mechanical guard on two contracts:
 *
 *   · CLAUDE.md's layer contract — "services never import React; crypto never
 *     imports Dexie";
 *   · `docs/architecture.md` §Crypto key hierarchy step 1 — Firebase identity
 *     "never touches encryption material".
 *
 * Both suites originally carried their own copy of a regular expression over
 * the source text. The Sprint 01 close review (finding S-3) demonstrated that
 * it was defeatable: a file containing three live module references —
 * a template-literal `import(`…`)`, an `import(/* comment *\/ '…')` and a
 * `new URL('…', import.meta.url)` — yielded **zero** specifiers. The suites
 * passed not because the boundary held but because nobody had written those
 * forms yet.
 *
 * This module replaces the regex with the TypeScript compiler's own parser.
 * Every edge is read off the AST, so the form a reference is written in cannot
 * hide it:
 *
 *   | form                                     | node                        |
 *   |------------------------------------------|-----------------------------|
 *   | `import x from '…'` (and type-only)      | ImportDeclaration           |
 *   | `import '…'` (side-effect only)          | ImportDeclaration           |
 *   | `export * from '…'`, `export { x } from` | ExportDeclaration           |
 *   | `import x = require('…')`                | ImportEqualsDeclaration     |
 *   | `import('…')`, `` import(`…`) ``          | CallExpression(ImportKeyword)|
 *   | `import(/* c *\/ '…')`                    | CallExpression(ImportKeyword)|
 *   | `require('…')`                           | CallExpression(require)     |
 *   | `new URL('…', import.meta.url)`          | NewExpression(URL)          |
 *
 * Anything the parser sees as a module reference but whose specifier is not a
 * static string — `import(someVariable)`, `` import(`./${name}`) `` — is a hole
 * in the graph, and a hole makes every negative assertion downstream vacuous.
 * Those throw {@link ComputedSpecifierError} rather than being skipped. So do
 * relative and aliased specifiers that resolve to nothing
 * ({@link UnresolvedModuleError}). Failing loudly is the whole point: a walker
 * that silently sees less than the file contains is worse than no walker.
 */

/** How a module reference was written. */
export type ReferenceKind =
  | 'static-import'
  | 'static-export'
  | 'import-equals'
  | 'dynamic-import'
  | 'require'
  | 'module-url';

export interface ModuleReference {
  /** The literal specifier text, e.g. `./schema` or `firebase/auth`. */
  readonly specifier: string;
  readonly kind: ReferenceKind;
  /** 1-based line the reference sits on, for failure messages. */
  readonly line: number;
  /** `true` for `import type` / `export type` forms. */
  readonly typeOnly: boolean;
}

/** A module reference whose specifier is not statically known. */
export interface ComputedReference {
  /** The source text of the expression that stood where a literal should. */
  readonly expression: string;
  readonly kind: ReferenceKind;
  readonly line: number;
}

export interface ExtractedReferences {
  readonly references: readonly ModuleReference[];
  readonly computed: readonly ComputedReference[];
}

export class UnresolvedModuleError extends Error {
  override readonly name = 'UnresolvedModuleError';
}

export class ComputedSpecifierError extends Error {
  override readonly name = 'ComputedSpecifierError';
}

/* ── Extraction ─────────────────────────────────────────────────────────── */

function isImportMetaUrl(node: ts.Expression): boolean {
  return (
    ts.isPropertyAccessExpression(node) &&
    node.name.text === 'url' &&
    ts.isMetaProperty(node.expression) &&
    node.expression.keywordToken === ts.SyntaxKind.ImportKeyword
  );
}

function staticText(node: ts.Expression): string | null {
  if (ts.isStringLiteralLike(node)) return node.text;
  return null;
}

/**
 * Reads every module reference out of one source file.
 *
 * `fileName` decides the dialect: a `.tsx` name is parsed as TSX, so JSX in a
 * component file does not derail the parse.
 */
export function extractModuleReferences(
  source: string,
  fileName = 'module.ts',
): ExtractedReferences {
  const file = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
  );

  const references: ModuleReference[] = [];
  const computed: ComputedReference[] = [];

  const lineOf = (node: ts.Node): number =>
    file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;

  const record = (
    node: ts.Node,
    specifierNode: ts.Expression,
    kind: ReferenceKind,
    typeOnly = false,
  ) => {
    const text = staticText(specifierNode);
    if (text === null) {
      computed.push({
        expression: specifierNode.getText(file),
        kind,
        line: lineOf(node),
      });
      return;
    }
    references.push({ specifier: text, kind, line: lineOf(node), typeOnly });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node)) {
      record(
        node,
        node.moduleSpecifier,
        'static-import',
        node.importClause?.isTypeOnly ?? false,
      );
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier) {
      record(node, node.moduleSpecifier, 'static-export', node.isTypeOnly);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      record(
        node,
        node.moduleReference.expression,
        'import-equals',
        node.isTypeOnly,
      );
    } else if (ts.isCallExpression(node)) {
      const [first] = node.arguments;
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword && first) {
        record(node, first, 'dynamic-import');
      } else if (
        ts.isIdentifier(node.expression) &&
        node.expression.text === 'require' &&
        first
      ) {
        record(node, first, 'require');
      }
    } else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'URL'
    ) {
      // `new URL('./worker.ts', import.meta.url)` is how a bundler-resolved
      // module reference is written when it must survive as a URL. It is a real
      // graph edge and the old regex was blind to it.
      const [specifier, base] = node.arguments ?? [];
      if (specifier && base && isImportMetaUrl(base)) {
        record(node, specifier, 'module-url');
      }
    }
    ts.forEachChild(node, visit);
  };

  ts.forEachChild(file, visit);
  return { references, computed };
}

/**
 * Just the specifier strings, in source order. Convenience for checks that ask
 * "does this file mention X at all" rather than walking a graph.
 *
 * Throws on a computed dynamic specifier for the same reason the graph walker
 * does: an unreadable reference would make a "no offenders" result a lie.
 */
export function moduleSpecifiers(
  source: string,
  fileName = 'module.ts',
): string[] {
  const { references, computed } = extractModuleReferences(source, fileName);
  if (computed.length > 0) {
    throw new ComputedSpecifierError(describeComputed(fileName, computed));
  }
  return references.map((reference) => reference.specifier);
}

function describeComputed(
  fileName: string,
  computed: readonly ComputedReference[],
): string {
  const lines = computed
    .map((c) => `  ${fileName}:${c.line} ${c.kind} of ${c.expression}`)
    .join('\n');
  return `module reference with a non-literal specifier — the graph would be incomplete:\n${lines}`;
}

/* ── Resolution and graph walking ───────────────────────────────────────── */

/** Extensions tried, in order, when a specifier omits one. */
const RESOLVE_EXTENSIONS = [
  '',
  '.ts',
  '.tsx',
  '.mts',
  '.cts',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '/index.ts',
  '/index.tsx',
  '/index.js',
] as const;

/** Only these are parsed for further edges; anything else is a leaf asset. */
const PARSEABLE = /\.(?:[mc]?tsx?|[mc]?jsx?)$/;

export interface WalkerOptions {
  /** Paths in the graph are reported relative to this directory. */
  readonly root: string;
  /**
   * Path-alias prefixes, longest match wins. Values are resolved against
   * `root`. The repo's `tsconfig.json` declares `~/* -> ./app/*`.
   */
  readonly alias?: Readonly<Record<string, string>>;
}

export interface ImportGraph {
  /** The entry point, repo-relative. */
  readonly entry: string;
  /** Every local file reachable from the entry point, repo-relative. */
  readonly files: ReadonlySet<string>;
  /** Every bare (node_modules or virtual) specifier reachable from it. */
  readonly packages: ReadonlySet<string>;
  /** Every reference found, keyed by the repo-relative file it was written in. */
  readonly references: ReadonlyMap<string, readonly ModuleReference[]>;
}

function resolveFile(fromDirectory: string, specifier: string): string | null {
  const base = resolve(fromDirectory, specifier);
  for (const extension of RESOLVE_EXTENSIONS) {
    const candidate = base + extension;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/**
 * Splits a specifier into "a local file this walker must follow" and "a bare
 * package specifier". Returns `null` for the latter.
 */
function localTarget(
  specifier: string,
  fromFile: string,
  options: WalkerOptions,
): { directory: string; request: string } | null {
  if (specifier.startsWith('.')) {
    return { directory: dirname(fromFile), request: specifier };
  }
  const aliases = Object.entries(options.alias ?? {}).sort(
    (a, b) => b[0].length - a[0].length,
  );
  for (const [prefix, target] of aliases) {
    if (specifier.startsWith(prefix)) {
      return {
        directory: resolve(options.root, target),
        request: `./${specifier.slice(prefix.length)}`,
      };
    }
  }
  return null;
}

/**
 * Walks the transitive module graph from `entry`.
 *
 * @throws {ComputedSpecifierError} if any reachable file writes a module
 * reference whose specifier is not a literal — the graph would be incomplete.
 * @throws {UnresolvedModuleError} if a relative or aliased specifier resolves
 * to no file — same reason.
 */
export function buildImportGraph(
  entry: string,
  options: WalkerOptions,
): ImportGraph {
  const entryPath = resolve(options.root, entry);
  if (!existsSync(entryPath)) {
    throw new UnresolvedModuleError(`entry point does not exist: ${entry}`);
  }

  const files = new Set<string>();
  const packages = new Set<string>();
  const references = new Map<string, readonly ModuleReference[]>();
  const queue = [entryPath];

  while (queue.length > 0) {
    const current = queue.pop();
    if (current === undefined) continue;

    const key = relative(options.root, current);
    if (files.has(key)) continue;
    files.add(key);
    if (!PARSEABLE.test(current)) continue;

    const source = readFileSync(current, 'utf8');
    const extracted = extractModuleReferences(source, current);
    if (extracted.computed.length > 0) {
      throw new ComputedSpecifierError(
        describeComputed(key, extracted.computed),
      );
    }
    references.set(key, extracted.references);

    for (const reference of extracted.references) {
      const target = localTarget(reference.specifier, current, options);
      if (target === null) {
        packages.add(reference.specifier);
        continue;
      }
      const resolved = resolveFile(target.directory, target.request);
      if (resolved === null) {
        throw new UnresolvedModuleError(
          `unresolved local import "${reference.specifier}" (${reference.kind}) at ${key}:${reference.line}`,
        );
      }
      queue.push(resolved);
    }
  }

  return {
    entry: relative(options.root, entryPath),
    files,
    packages,
    references,
  };
}

/**
 * Bare specifiers in `graph` that are, or live under, one of `names`.
 * `dexie` matches `dexie` and `dexie/foo` but never `dexieish`.
 */
export function packagesMatching(
  graph: ImportGraph,
  ...names: string[]
): string[] {
  return [...graph.packages]
    .filter((specifier) =>
      names.some(
        (name) => specifier === name || specifier.startsWith(`${name}/`),
      ),
    )
    .sort();
}

/** Files in `graph` whose repo-relative path starts with one of `prefixes`. */
export function filesUnder(
  graph: ImportGraph,
  ...prefixes: string[]
): string[] {
  return [...graph.files]
    .filter((file) => prefixes.some((prefix) => file.startsWith(prefix)))
    .sort();
}
