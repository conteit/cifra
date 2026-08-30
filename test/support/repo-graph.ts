import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildImportGraph,
  type ImportGraph,
  type WalkerOptions,
} from './import-graph';

/**
 * This repo's wiring for {@link buildImportGraph} — the root every graph path
 * is reported against, and the one path alias `tsconfig.json` declares.
 *
 * It lives beside the walker rather than inside it so the walker stays a
 * general tool with its own tests, and so the two boundary suites cannot drift
 * apart on how they configure it (they had two divergent copies before; see
 * review finding S-3).
 */
export const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);

/** `tsconfig.json`: `"paths": { "~/*": ["./app/*"] }`. */
export const REPO_WALKER_OPTIONS: WalkerOptions = {
  root: REPO_ROOT,
  alias: { '~/': 'app/' },
};

/**
 * Walks the module graph of a repo-relative entry point.
 *
 * `overrides` exists for {@link WalkerOptions.followKinds}: the crypto worker
 * boundary suite (#61) asks what `app/crypto/kdf.ts` can reach *without*
 * crossing the `new URL(…, import.meta.url)` worker edge, which is a different
 * question from what it can reach at all. Root and alias stay fixed, so the two
 * questions are asked of the same repo.
 */
export function repoImportGraph(
  entry: string,
  overrides: Omit<WalkerOptions, 'root' | 'alias'> = {},
): ImportGraph {
  return buildImportGraph(entry, { ...REPO_WALKER_OPTIONS, ...overrides });
}
