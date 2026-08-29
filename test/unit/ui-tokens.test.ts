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
 * modules — and fails on the concrete ways a raw value gets in:
 *
 *   1. literal colours (`#rrggbb`, `rgb(...)`, `hsl(...)`, named CSS colours);
 *   2. Tailwind arbitrary values (`bg-[#fff]`, `w-[13px]`, `text-[0.8rem]`);
 *   3. inline `style={{ … }}`, which bypasses the class scan entirely;
 *   4. stock Tailwind utilities that issue #1 cleared to `initial` — they no
 *      longer compile, so catching them here is a better error than a silently
 *      unstyled element;
 *   5. the stock `sm:`/`md:`/`lg:`/`xl:` breakpoints — FOUN-09 has exactly one
 *      breakpoint, `desktop:`.
 *
 * It is intentionally a source-text check rather than a rendered-CSS check:
 * the rule is about what a component is allowed to *write*, and a text check
 * fails at the exact line rather than somewhere downstream.
 */

/**
 * Directories scanned, relative to `app/`. `ui` holds the primitives, `shell`
 * the layout that composes them, and `routes` the pages that mount inside it —
 * V1-3 binds all three, so all three are scanned. A new painting directory
 * under `app/` must be added here.
 */
const scannedDirs = ['ui', 'shell', 'routes'] as const;

function sourceFiles(): Array<{ name: string; text: string }> {
  return scannedDirs.flatMap((dir) => {
    const abs = fileURLToPath(new URL(`../../app/${dir}`, import.meta.url));
    return readdirSync(abs)
      .filter((name) => name.endsWith('.ts') || name.endsWith('.tsx'))
      .map((name) => ({
        name: `${dir}/${name}`,
        text: readFileSync(join(abs, name), 'utf8'),
      }));
  });
}

/** Strips block and line comments so prose about `#fff` never trips the scan. */
function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
}

type Rule = {
  what: string;
  pattern: RegExp;
};

const rules: Rule[] = [
  {
    what: 'a literal hex colour',
    pattern: /#[0-9a-fA-F]{3,8}\b/,
  },
  {
    what: 'a literal rgb()/rgba()/hsl()/hsla()/oklch() colour',
    pattern: /\b(?:rgba?|hsla?|oklch|color-mix)\s*\(/,
  },
  {
    what: 'a raw CSS colour keyword',
    // `currentColor`, `transparent` and `inherit` are the three keywords the
    // theme deliberately keeps (see `--color-*: initial` in app.css).
    pattern:
      /\b(?:white|black|red|green|blue|gray|grey|silver|navy|teal|olive|maroon)\b/i,
  },
  {
    what: 'a Tailwind arbitrary value, e.g. bg-[#fff] or w-[13px]',
    pattern: /\b[a-z-]+-\[[^\]]+\]/,
  },
  {
    what: 'an inline style object',
    pattern: /style=\{\{/,
  },
  {
    what: "a stock Tailwind colour utility (issue #1 cleared Tailwind's palette)",
    pattern:
      /\b(?:bg|text|border|outline|fill|stroke|ring|from|via|to|decoration|divide|accent|caret|shadow|placeholder)-(?:slate|gray|grey|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/,
  },
  {
    what: 'a stock Tailwind type-scale utility (the scale is roles, not sizes)',
    pattern: /\btext-(?:xs|sm|base|lg|xl|[2-9]xl)\b/,
  },
  {
    what: 'a stock Tailwind radius utility (radii are named for what they wrap)',
    pattern:
      /\brounded(?:-[trbl]{1,2})?-(?:none|xs|sm|md|lg|xl|2xl|3xl|full)\b/,
  },
  {
    what: 'a stock Tailwind shadow utility (elevation is card or float)',
    pattern: /\bshadow-(?:xs|sm|md|lg|xl|2xl|inner|none)\b/,
  },
  {
    what: 'a stock Tailwind breakpoint (FOUN-09 has one: desktop:)',
    pattern: /(?:^|[\s"'`])(?:sm|md|lg|xl|2xl):/m,
  },
  {
    what: 'a raw px/rem/em length',
    pattern: /\b\d+(?:\.\d+)?(?:px|rem|em|vh|vw)\b/,
  },
];

describe('app components use semantic tokens only (V1-3)', () => {
  const files = sourceFiles();

  it('finds the sources to check', () => {
    expect(files.map((f) => f.name).sort()).toEqual([
      'routes/app-layout.tsx',
      'routes/home.tsx',
      'shell/app-shell.tsx',
      'shell/index.ts',
      'shell/nav-items.ts',
      'ui/button.tsx',
      'ui/card.tsx',
      'ui/cx.ts',
      'ui/index.ts',
      'ui/input.tsx',
      'ui/modal.tsx',
    ]);
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
