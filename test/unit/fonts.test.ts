import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Keeps the hand-declared @font-face block in `app/app.css` honest.
 *
 * `app/app.css` used to `@import` the @fontsource entrypoints wholesale. Those
 * stylesheets declare every subset Google publishes — cyrillic, cyrillic-ext,
 * greek, vietnamese — so the build emitted 21 `.woff2` files and the service
 * worker precached all of them, though an EN/IT app can only ever request
 * latin and latin-ext (issue #63). The variable packages ship no per-subset
 * entrypoint, and the static ones drop `unicode-range` — two of those imported
 * together would leave the later face claiming the whole range and the earlier
 * one unreachable — so the rules are written out in `app/app.css` instead.
 *
 * Copied rules rot. This suite is the contract that stops them rotting: it
 * re-parses the installed @fontsource stylesheets and fails if what
 * `app/app.css` declares is no longer exactly their latin + latin-ext blocks.
 * A Renovate bump that changes a unicode-range, renames a file, or adds a
 * subset becomes a red test rather than a silently wrong bundle.
 */

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/**
 * Comments are stripped before anything is matched: `app/app.css` explains the
 * import it no longer performs, and a prose mention of `@import "@fontsource…"`
 * must not read as the rule itself.
 */
function stripComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

const appCss = stripComments(
  readFileSync(join(repoRoot, 'app/app.css'), 'utf8'),
);

/**
 * The upstream stylesheets `app/app.css` is a filtered copy of. Adding a family
 * to the app means adding its entrypoint here, or the "declares exactly the
 * latin faces" test below will not know to demand it.
 */
const UPSTREAM_ENTRYPOINTS = [
  '@fontsource-variable/cormorant-garamond/wght.css',
  '@fontsource-variable/cormorant-garamond/wght-italic.css',
  '@fontsource-variable/ibm-plex-sans/wght.css',
  '@fontsource/ibm-plex-mono/400.css',
] as const;

/** The only subsets an EN/IT app can request. Anything else is dead payload. */
const KEPT_SUBSETS = /-latin(-ext)?-/;

type Face = {
  /** Basename of the `.woff2` the face points at — the identity of the face. */
  readonly file: string;
  readonly family: string;
  readonly style: string;
  readonly weight: string;
  readonly display: string;
  readonly unicodeRange: string;
  /** Every `url(...)` the `src` descriptor lists, as written. */
  readonly sources: readonly string[];
};

function descriptor(block: string, name: string): string {
  const match = block.match(new RegExp(`${name}:\\s*([^;]+);`));
  return match ? match[1].trim().replace(/['"]/g, '') : '';
}

function parseFaces(css: string): Face[] {
  return [...css.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((match) => {
    const block = match[1];
    const sources = [
      ...block.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g),
    ].map((url) => url[1]);
    const woff2 = sources.find((source) => source.endsWith('.woff2')) ?? '';
    return {
      file: woff2.split('/').pop() ?? '',
      family: descriptor(block, 'font-family'),
      style: descriptor(block, 'font-style'),
      weight: descriptor(block, 'font-weight'),
      display: descriptor(block, 'font-display'),
      unicodeRange: descriptor(block, 'unicode-range').replace(/\s+/g, ''),
      sources,
    };
  });
}

/** Every face the installed packages declare, keyed by its `.woff2` basename. */
const upstreamFaces = new Map<string, Face>();
for (const entrypoint of UPSTREAM_ENTRYPOINTS) {
  const css = readFileSync(join(repoRoot, 'node_modules', entrypoint), 'utf8');
  for (const face of parseFaces(css)) {
    upstreamFaces.set(face.file, face);
  }
}

const appFaces = parseFaces(appCss);
const keptUpstream = [...upstreamFaces.values()].filter((face) =>
  KEPT_SUBSETS.test(face.file),
);

describe('self-hosted typefaces (FOUN-08, issue #63)', () => {
  it('parses the upstream stylesheets it is meant to police', () => {
    expect(upstreamFaces.size).toBeGreaterThan(0);
    expect(keptUpstream.length).toBeGreaterThan(0);
    expect(keptUpstream.length).toBeLessThan(upstreamFaces.size);
  });

  it('declares exactly the latin and latin-ext faces, and no other subset', () => {
    expect(appFaces.map((face) => face.file).sort()).toEqual(
      keptUpstream.map((face) => face.file).sort(),
    );
  });

  it.each(keptUpstream.map((face) => [face.file, face] as const))(
    '%s matches the installed @fontsource declaration verbatim',
    (file, upstream) => {
      const declared = appFaces.find((face) => face.file === file);
      expect(declared).toBeDefined();
      expect({
        family: declared?.family,
        style: declared?.style,
        weight: declared?.weight,
        display: declared?.display,
        unicodeRange: declared?.unicodeRange,
      }).toEqual({
        family: upstream.family,
        style: upstream.style,
        weight: upstream.weight,
        display: upstream.display,
        unicodeRange: upstream.unicodeRange,
      });
    },
  );

  it('points at files that exist in the installed packages', () => {
    for (const face of appFaces) {
      for (const source of face.sources) {
        expect(existsSync(join(repoRoot, 'node_modules', source)), source).toBe(
          true,
        );
      }
    }
  });

  it('ships no legacy .woff fallback — WOFF2 only', () => {
    for (const face of appFaces) {
      expect(
        face.sources.filter((source) => source.endsWith('.woff')),
        face.file,
      ).toEqual([]);
    }
  });

  it('no longer @imports a whole-family @fontsource stylesheet', () => {
    expect(appCss).not.toMatch(/@import\s+["']@fontsource/);
  });
});
