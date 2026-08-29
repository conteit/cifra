import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Makes V1-3 self-policing.
 *
 * "Semantic design tokens only — components reference token names, never raw
 * colour or size values" is otherwise a reviewer's job, and reviewers miss a
 * `#fff` in a 200-line component. This suite reads every source that paints
 * something — the `app/ui` primitives, the `app/shell` layout, and the route
 * modules, **recursively** — and fails on the concrete ways a raw value gets
 * in.
 *
 * It is intentionally a source-text check rather than a rendered-CSS check:
 * the rule is about what a component is allowed to *write*, and a text check
 * fails at the exact line rather than somewhere downstream.
 *
 * ## What review finding C-1 found
 *
 * The scan used a non-recursive `readdirSync` over three directories. A file
 * placed in `app/ui/sub/` with five violations left the suite at 122/122
 * passing: the guard read only the flat top level of each directory, so the
 * first subdirectory anyone creates would have been unpoliced. `sourceFiles`
 * now walks the tree, and `describe('the scan reaches every painting source')`
 * fails if a `.tsx` file appears under `app/` outside the scanned set without
 * being listed — so a *new* painting directory cannot go unscanned either.
 *
 * The same finding noted the detection was narrower than the docstring above
 * it claimed. Every rule now carries an `example` it must flag and a
 * `counterExample` it must not, and `describe('each rule detects what it
 * claims')` runs both — so a rule that stops matching is a failing test rather
 * than a quietly widened licence.
 */

/**
 * Directories scanned, relative to `app/`, walked recursively. `ui` holds the
 * primitives, `shell` the layout that composes them, and `routes` the pages
 * that mount inside it — V1-3 binds all three.
 *
 * This list is not the safety net: `the scan reaches every painting source`
 * below is, and it fails if a new `.tsx` appears under `app/` that neither
 * lives in one of these directories nor is named in {@link UNSCANNED}.
 */
const scannedDirs = ['ui', 'shell', 'routes'] as const;

/**
 * Painting sources under `app/` that are deliberately outside the scan, with
 * the reason. Adding to this list is a decision, not a formality.
 */
const UNSCANNED: ReadonlyArray<{ file: string; why: string }> = [
  {
    file: 'app/root.tsx',
    why: 'the document shell: <meta name="theme-color"> must carry a literal colour, because a CSS variable cannot reach the browser chrome. It paints nothing else.',
  },
];

const APP_ROOT = fileURLToPath(new URL('../../app', import.meta.url));

function isSource(name: string): boolean {
  return name.endsWith('.ts') || name.endsWith('.tsx');
}

/** Every `.ts`/`.tsx` under `directory`, at any depth, as `app/`-relative paths. */
function sourcesUnder(directory: string, prefix: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      return sourcesUnder(join(directory, entry.name), path);
    }
    return isSource(entry.name) ? [path] : [];
  });
}

function sourceFiles(): Array<{ name: string; text: string }> {
  return scannedDirs
    .flatMap((dir) => sourcesUnder(join(APP_ROOT, dir), dir))
    .sort()
    .map((name) => ({
      name,
      text: readFileSync(join(APP_ROOT, name), 'utf8'),
    }));
}

/** Strips block and line comments so prose about `#fff` never trips the scan. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

type Rule = {
  /** Named in the test title: "contains no <what>". */
  what: string;
  pattern: RegExp;
  /** A line the rule MUST flag. Proves the rule still fires. */
  example: string;
  /** A legitimate line the rule must NOT flag. Proves it is not a blunt ban. */
  counterExample: string;
};

/**
 * Lengths a component may not write. `%` gets its own rule below: it is not a
 * word character, so a trailing `\b` would never fire on `100%"` — exactly the
 * kind of near-miss that made the old scan narrower than it read.
 */
const CSS_UNIT =
  '(?:px|rem|em|ex|ch|vh|vw|vmin|vmax|svh|lvh|dvh|svw|lvw|dvw|pt|pc|cm|mm)(?![a-z0-9-])';

const rules: Rule[] = [
  {
    what: 'a literal hex colour',
    pattern: /#[0-9a-fA-F]{3,8}\b/,
    example: 'className="border-b" style={{ color: \'#c4382a\' }}',
    counterExample: 'href="#main-content"',
  },
  {
    what: 'a literal rgb()/hsl()/oklch()/lab() colour',
    pattern: /\b(?:rgba?|hsla?|hwb|oklch|oklab|lab|lch|color-mix)\s*\(/,
    example: 'const wash = `rgb(28 28 26 / 0.45)`;',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: sample source text, never expanded
    counterExample: 'const label = t(`nav_${item.id}`);',
  },
  {
    what: 'a raw CSS colour keyword',
    // `currentColor`, `transparent` and `inherit` are the three keywords the
    // theme deliberately keeps (see `--color-*: initial` in app.css).
    pattern:
      /\b(?:white|black|red|green|blue|gray|grey|silver|navy|teal|olive|maroon|orange|purple|pink|brown|yellow|cyan|magenta|gold|beige|ivory|crimson|indigo|violet|turquoise|tomato|coral|salmon|khaki|lavender|orchid|aqua|lime|fuchsia|goldenrod|darkgoldenrod)\b/i,
    example: 'const ring = "outline-red";',
    counterExample: 'className={cx(variantClasses.bar, focusRing)}',
  },
  {
    what: 'a Tailwind arbitrary value, e.g. bg-[#fff] or w-[13px]',
    pattern: /\b[a-z-]+-\[[^\]]+\]/,
    example: 'className="bg-[#abc] p-[13px]"',
    counterExample: 'className="bg-surface-card px-8 py-5"',
  },
  {
    what: 'a Tailwind arbitrary property, e.g. [color:red] or [--x:1px]',
    pattern: /(?:^|[\s"'`{])\[[a-z-]{2,}:[^\]\s]+\]/,
    example: 'className="[color:oklch(0.5_0.1_20)]"',
    counterExample: 'const [first] = items;',
  },
  {
    what: 'an inline style object',
    // `style={{ … }}` and `style={someObject}` both bypass the class scan.
    pattern: /\bstyle=\{/,
    example: 'return <div style={{ padding: 12 }} />;',
    counterExample: 'return <div className={styles} />;',
  },
  {
    what: 'an SVG paint attribute with a value that is not a token',
    // `none`, `currentColor`, `inherit` and `transparent` are the four values a
    // glyph may name; anything else is a pigment written into a component.
    pattern:
      /\b(?:fill|stroke|stopColor|floodColor|lightingColor)=(?!["'](?:none|currentColor|inherit|transparent)["'])/,
    example: '<path fill="#2d5a27" stroke="darkgoldenrod" />',
    counterExample: '<path fill="none" stroke="currentColor" />',
  },
  {
    what: "a stock Tailwind colour utility (issue #1 cleared Tailwind's palette)",
    pattern:
      /\b(?:bg|text|border|outline|fill|stroke|ring|from|via|to|decoration|divide|accent|caret|shadow|placeholder)-(?:slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
    example: 'className="bg-slate-100 text-rose-500"',
    counterExample: 'className="bg-surface-inset text-text-muted"',
  },
  {
    what: 'a stock Tailwind type-scale utility (the scale is roles, not sizes)',
    pattern: /\btext-(?:xs|sm|base|lg|xl|[2-9]xl)\b/,
    example: 'className="text-sm"',
    counterExample: 'className="text-label-sm"',
  },
  {
    what: 'a stock Tailwind radius utility (radii are named for what they wrap)',
    pattern:
      /\brounded(?:-[trbl]{1,2})?-(?:none|xs|sm|md|lg|xl|2xl|3xl|full)\b/,
    example: 'className="rounded-lg"',
    counterExample: 'className="rounded-card"',
  },
  {
    what: 'a stock Tailwind shadow utility (elevation is card or float)',
    pattern: /\bshadow-(?:xs|sm|md|lg|xl|2xl|inner|none)\b/,
    example: 'className="shadow-md"',
    counterExample: 'className="shadow-float"',
  },
  {
    what: 'a stock Tailwind breakpoint (FOUN-09 has one: desktop:)',
    pattern: /(?:^|[\s"'`])(?:sm|md|lg|xl|2xl):/m,
    example: 'className="hidden md:flex"',
    counterExample: 'className="hidden desktop:flex"',
  },
  {
    what: 'a raw CSS length',
    pattern: new RegExp(String.raw`\b\d+(?:\.\d+)?${CSS_UNIT}`),
    example: 'const gutter = "24px";',
    counterExample: 'className="px-8 py-5"',
  },
  {
    what: 'a raw percentage length',
    pattern: /\b\d+(?:\.\d+)?%/,
    example: 'const half = "50%";',
    counterExample: 'const remainder = total % columns;',
  },
  {
    what: 'a raw CSS unit appended to an interpolated value',
    // `${size}px` carries no digit, so the length rule above cannot see it.
    pattern: new RegExp(String.raw`\}\s*${CSS_UNIT}`),
    // biome-ignore lint/suspicious/noTemplateCurlyInString: sample source text, never expanded
    example: 'const width = `${column}px`;',
    // biome-ignore lint/suspicious/noTemplateCurlyInString: sample source text, never expanded
    counterExample: 'const label = `${item.id}-nav`;',
  },
];

/* ── The scan ───────────────────────────────────────────────────────────── */

describe('app components use semantic tokens only (V1-3)', () => {
  const files = sourceFiles();

  it('finds the sources to check', () => {
    // Anti-vacuity: the walk must reach the known primitives and the layout,
    // and it must not silently return nothing.
    expect(files.length).toBeGreaterThanOrEqual(11);
    expect(files.map((f) => f.name)).toEqual(
      expect.arrayContaining([
        'routes/app-layout.tsx',
        'routes/home.tsx',
        'shell/app-shell.tsx',
        'shell/nav-items.ts',
        'ui/button.tsx',
        'ui/card.tsx',
        'ui/input.tsx',
        'ui/modal.tsx',
      ]),
    );
  });

  for (const file of files) {
    describe(file.name, () => {
      const code = withoutComments(file.text);
      const lines = code.split('\n');

      for (const rule of rules) {
        it(`contains no ${rule.what}`, () => {
          const offenders = lines
            .map((line, index) => ({ line, number: index + 1 }))
            .filter(({ line }) => rule.pattern.test(line))
            .map(
              ({ line, number }) => `${file.name}:${number}: ${line.trim()}`,
            );

          expect(offenders, offenders.join('\n')).toEqual([]);
        });
      }
    });
  }
});

/* ── The scan's own coverage ────────────────────────────────────────────── */

describe('the scan reaches every painting source', () => {
  it('walks subdirectories, not just the top level of each directory', () => {
    // The defect C-1 demonstrated: `readdirSync` without recursion. A file in
    // `app/ui/sub/` with five violations left the suite at 122/122 passing.
    // `app/services/auth/` is the repo's own two-level-deep directory, so this
    // asserts descent against real files rather than a fixture.
    expect(sourcesUnder(APP_ROOT, 'app')).toContain(
      'app/services/auth/types.ts',
    );
  });

  it('leaves no .tsx under app/ unscanned without a written reason', () => {
    const scanned = new Set(sourceFiles().map((f) => `app/${f.name}`));
    const exempt = new Set(UNSCANNED.map((entry) => entry.file));
    const unaccounted = sourcesUnder(APP_ROOT, 'app')
      .filter((path) => path.endsWith('.tsx'))
      .filter((path) => !scanned.has(path) && !exempt.has(path))
      .sort();

    expect(
      unaccounted,
      `these paint but are not scanned — add the directory to scannedDirs or the file to UNSCANNED with a reason:\n${unaccounted.join('\n')}`,
    ).toEqual([]);
  });

  it('every exemption names a real file and a reason', () => {
    const all = new Set(sourcesUnder(APP_ROOT, 'app'));
    for (const entry of UNSCANNED) {
      expect(all, `${entry.file} is exempt but does not exist`).toContain(
        entry.file,
      );
      expect(entry.why.length).toBeGreaterThan(20);
    }
  });
});

describe('each rule detects what it claims', () => {
  it.each(rules)('$what — fires on its example', (rule) => {
    expect(
      rule.pattern.test(rule.example),
      `"${rule.example}" should have been flagged as ${rule.what}`,
    ).toBe(true);
  });

  it.each(rules)('$what — leaves legitimate code alone', (rule) => {
    expect(
      rule.pattern.test(rule.counterExample),
      `"${rule.counterExample}" is legitimate but was flagged as ${rule.what}`,
    ).toBe(false);
  });

  it('has a distinct description per rule', () => {
    const names = rules.map((rule) => rule.what);
    expect(new Set(names).size).toBe(names.length);
  });
});
