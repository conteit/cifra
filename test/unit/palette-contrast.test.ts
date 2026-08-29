import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Makes the palette's WCAG contrast floor self-policing (D16).
 *
 * Issue #45 found `--ramp-sepia-500` at 3.95:1 on the page and
 * `--ramp-amber-600` at 2.87:1 — both below the AA floor for the 8.5px and
 * 17px roles the type scale actually uses them at. axe caught it only because
 * the tokens story happens to paint those tokens; a pigment that no story
 * renders as text would have shipped broken, and re-lightening one later would
 * pass every check we had.
 *
 * This suite closes that hole. It reads the token values out of `app/app.css`
 * itself, resolves the `var()` chains from the raw ramp to the semantic alias,
 * and asserts the WCAG 2.x contrast ratio for every foreground/background pair
 * the design system permits. It is a node-environment test: the values are
 * static CSS, so no browser and no Playwright are needed. Storybook's axe pass
 * still checks live pixels; this checks the *contract*, including pairs no
 * story renders yet.
 *
 * Two rules make it a contract rather than a snapshot:
 *
 *   1. PERMITTED enumerates which surfaces each foreground may sit on. It is
 *      the design system's statement of intent, not a list drawn around the
 *      numbers — see the surface comments in `app/app.css`.
 *   2. The exhaustiveness test fails if *any* `--color-*` token is neither a
 *      line in PERMITTED nor an entry in NOT_A_FOREGROUND with a reason, so
 *      the matrix cannot quietly fall behind the theme.
 *
 * ## What review finding C-11 found
 *
 * `--color-focus-ring` sat outside the matrix. A reviewer repainted the focus
 * ring to invisible cream and all 84 assertions still passed — the ring is the
 * one affordance a keyboard user has, and nothing checked it.
 *
 * The exhaustiveness test was supposed to prevent exactly that and did not,
 * because it derived the token list from the same three families the matrix
 * already covered (`--color-text-*`, `--color-accent-*`, `--color-category-*`,
 * plus `--color-action-on-*`). It asserted that the matrix covered its own
 * families — a tautology — rather than that it covered the theme. Any token in
 * a family nobody had thought of was invisible to both. It now enumerates
 * every `--color-*` declaration in the sheet and demands each be classified.
 */

const cssPath = fileURLToPath(new URL('../../app/app.css', import.meta.url));
const css = readFileSync(cssPath, 'utf8');

/* ── Token resolution ───────────────────────────────────────────────────── */

/** Every `--name: value;` declaration in the sheet, comments stripped. */
function declarations(source: string): Map<string, string> {
  const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const out = new Map<string, string>();
  for (const match of withoutComments.matchAll(
    /(--[a-z0-9-]+)\s*:\s*([^;]+);/g,
  )) {
    out.set(match[1], match[2].trim());
  }
  return out;
}

const tokens = declarations(css);

/** Follows `var(--x)` chains down to a literal value. */
function resolve(name: string, seen = new Set<string>()): string {
  if (seen.has(name)) throw new Error(`circular token reference at ${name}`);
  seen.add(name);
  const value = tokens.get(name);
  if (value === undefined) throw new Error(`unknown token ${name}`);
  const indirection = /^var\(\s*(--[a-z0-9-]+)\s*\)$/.exec(value);
  return indirection ? resolve(indirection[1], seen) : value;
}

/* ── WCAG 2.x relative luminance and contrast ───────────────────────────── */

function channels(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`not an opaque hex colour: ${hex}`);
  const int = Number.parseInt(match[1], 16);
  return [(int >> 16) & 0xff, (int >> 8) & 0xff, int & 0xff];
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const srgb = value / 255;
    return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** https://www.w3.org/TR/WCAG21/#dfn-contrast-ratio */
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/* ── The permitted pairs ────────────────────────────────────────────────── */

const AA_TEXT = 4.5; // WCAG 1.4.3, body-size text
const NON_TEXT = 3; // WCAG 1.4.11, graphical objects

/** Content surfaces: any text token may be placed on these. */
const TEXT_SURFACES = [
  '--color-surface-page',
  '--color-surface-card',
  '--color-surface-inset',
] as const;

type Pair = {
  /** The foreground token. */
  fg: string;
  /** Backgrounds it is permitted to sit on. */
  on: readonly string[];
  /** 4.5:1 for text, 3:1 for tokens that are only ever drawn as graphics. */
  min: number;
  /** Why this token's permitted set is what it is. */
  note: string;
};

/** The wash each money accent is paired with for chips and badges. */
const accentWash = (name: string) => `--color-accent-${name}-surface`;
const categoryWash = (name: string) => `--color-category-${name}-surface`;

const CATEGORIES = [
  'groceries',
  'housing',
  'transport',
  'dining',
  'subscriptions',
  'health',
  'sport',
  'utilities',
  'bar',
  'other',
] as const;

const PERMITTED: Pair[] = [
  {
    fg: '--color-text-primary',
    // `surface-track` is a graphic surface, but the secondary button's hover
    // fill uses it under `text-secondary`, and the ink tokens clear AA there.
    on: [...TEXT_SURFACES, '--color-surface-track'],
    min: AA_TEXT,
    note: 'body copy and numerals, anywhere',
  },
  {
    fg: '--color-text-secondary',
    on: [...TEXT_SURFACES, '--color-surface-track'],
    min: AA_TEXT,
    note: 'supporting copy; the secondary button hover puts it on track',
  },
  {
    fg: '--color-text-muted',
    on: TEXT_SURFACES,
    min: AA_TEXT,
    note: 'labels and disabled input text; never on a progress track',
  },
  {
    fg: '--color-text-meta',
    on: TEXT_SURFACES,
    min: AA_TEXT,
    note: 'units and timestamps at text-label-sm; never on a progress track',
  },
  {
    fg: '--color-text-inverse',
    on: ['--color-surface-inverse'],
    min: AA_TEXT,
    note: 'copy on the dark hero panel',
  },
  {
    fg: '--color-action-on-primary',
    on: ['--color-action-primary', '--color-action-primary-hover'],
    min: AA_TEXT,
    note: 'the primary button label, at rest and on hover',
  },
  {
    fg: '--color-action-primary',
    on: TEXT_SURFACES,
    min: NON_TEXT,
    // The button's fill is what makes the control visible as a control, so it
    // is a "user interface component" under WCAG 1.4.11: 3:1, not 4.5:1. Its
    // *label* is the pair above, at the text bar.
    note: 'the primary button body against the surface it sits on',
  },
  {
    fg: '--color-action-primary-hover',
    on: TEXT_SURFACES,
    min: NON_TEXT,
    note: 'the primary button body on hover',
  },
  {
    fg: '--color-focus-ring',
    // C-11. The ring is drawn with `outline-offset-2`, so the 2px gap shows
    // the surface the control sits on: the ring's neighbouring colour is that
    // surface, not the control's own fill. Every focusable control in the app
    // today sits on one of these four (`surface-track` is the secondary
    // button's hover fill). `surface-inverse` is deliberately absent — no
    // focusable control is placed on the dark panel yet, and the ring does not
    // clear 3:1 there (2.12:1); issue #65 tracks that.
    on: [...TEXT_SURFACES, '--color-surface-track'],
    // WCAG 1.4.11 non-text contrast: a focus indicator is a graphical object
    // that identifies a UI component's state, so the bar is 3:1, not the 4.5:1
    // that applies to body text.
    min: NON_TEXT,
    note: 'the one keyboard-focus treatment, on every surface a control sits on',
  },
  {
    fg: '--color-accent-income',
    on: [...TEXT_SURFACES, accentWash('income')],
    min: AA_TEXT,
    note: 'income amounts and their badge',
  },
  {
    fg: '--color-accent-income-strong',
    on: [...TEXT_SURFACES, '--color-surface-track', accentWash('income')],
    min: NON_TEXT,
    note: 'D17: bars, chart series and fills only — never drawn as text',
  },
  {
    fg: '--color-accent-spend',
    on: [...TEXT_SURFACES, accentWash('spend')],
    min: AA_TEXT,
    note: 'spend amounts, errors and their badge',
  },
  {
    fg: '--color-accent-planned',
    on: [...TEXT_SURFACES, accentWash('planned')],
    min: AA_TEXT,
    note: 'every planned/forecast amount and its badge',
  },
  {
    fg: '--color-accent-cash',
    on: [...TEXT_SURFACES, accentWash('cash')],
    min: AA_TEXT,
    note: 'cash-wallet amounts and their badge',
  },
  // The accent washes double as text on the dark hero panel (the income and
  // spend figures in the tokens sheet's specimen).
  ...(['income', 'spend', 'planned', 'cash'] as const).map((name) => ({
    fg: accentWash(name),
    on: ['--color-surface-inverse'],
    min: AA_TEXT,
    note: 'wash used as a figure colour on the dark hero panel',
  })),
  // Category colours are drawn as chip labels on their own wash, and as text
  // on the page and on cards.
  ...CATEGORIES.map((name) => ({
    fg: `--color-category-${name}`,
    on: [...TEXT_SURFACES, categoryWash(name)],
    min: AA_TEXT,
    note: 'category chip label, dot and inline text',
  })),
];

/**
 * Every other `--color-*` token, with why it carries no contrast obligation.
 *
 * This is the other half of the exhaustiveness contract: a token is either a
 * foreground with permitted backgrounds, or it is here with a reason. There is
 * no third state, so a new token cannot be added to `app.css` without someone
 * deciding which it is.
 */
const NOT_A_FOREGROUND: Readonly<Record<string, string>> = {
  '--color-transparent':
    'a CSS keyword, not a pigment — kept so `bg-transparent` still compiles.',
  '--color-current':
    'a CSS keyword (`currentcolor`) — resolves to whatever the inherited text colour is.',
  '--color-inherit':
    'a CSS keyword — resolves to the parent, so it has no fixed value to measure.',
  '--color-surface-page':
    'a background. It appears in the matrix as something foregrounds sit on, never as ink.',
  '--color-surface-card':
    'a background. It appears in the matrix as something foregrounds sit on, never as ink.',
  '--color-surface-inset':
    'a background. It appears in the matrix as something foregrounds sit on, never as ink.',
  '--color-surface-track':
    'a graphic background — progress tracks and the secondary button hover fill. Never ink.',
  '--color-surface-inverse':
    'the dark hero panel background. Carries text-inverse and the accent washes; never ink itself.',
  '--color-rule':
    'a structural hairline at 12% ink. Decorative separation, not the sole means of identifying any control, so WCAG 1.4.11 does not bind it. Also non-opaque, which this suite cannot compose.',
  '--color-rule-soft':
    'the 6% ink hairline that divides list rows. Same reasoning as --color-rule, one step softer.',
  '--color-scrim':
    'the 45% ink wash a modal lays over the page. Its job is to dim, not to be legible against anything.',
  ...Object.fromEntries(
    CATEGORIES.map((name) => [
      categoryWash(name),
      'a category wash: only ever the fill behind its own chip, never drawn as ink.',
    ]),
  ),
};

/* ── Tests ──────────────────────────────────────────────────────────────── */

describe('palette contrast (D16)', () => {
  describe.each(PERMITTED)('$fg — $note', ({ fg, on, min }) => {
    const foreground = resolve(fg);

    it.each(on)(`on %s is at least ${min}:1`, (bg) => {
      const background = resolve(bg);
      const ratio = contrast(foreground, background);
      expect(
        Number(ratio.toFixed(2)),
        `${fg} ${foreground} on ${bg} ${background} is ${ratio.toFixed(2)}:1, below ${min}:1`,
      ).toBeGreaterThanOrEqual(min);
    });
  });

  it('classifies every --color-* token in the sheet', () => {
    // C-11: the old version of this test derived `declared` from the same
    // families the matrix already covered, so it could never notice a token in
    // a family nobody had thought of — which is how `--color-focus-ring` went
    // unchecked. It now starts from every declaration in app.css.
    const declared = [...tokens.keys()]
      .filter((name) => name.startsWith('--color-'))
      .sort();
    const covered = new Set(PERMITTED.map((pair) => pair.fg));
    const excused = new Set(Object.keys(NOT_A_FOREGROUND));

    const unclassified = declared.filter(
      (name) => !covered.has(name) && !excused.has(name),
    );
    expect(
      unclassified,
      `these colour tokens are neither a permitted foreground nor an explicit non-foreground:\n${unclassified.join('\n')}`,
    ).toEqual([]);
  });

  it('does not excuse a token that no longer exists', () => {
    const declared = new Set(tokens.keys());
    const stale = Object.keys(NOT_A_FOREGROUND)
      .filter((name) => !declared.has(name))
      .sort();
    expect(stale).toEqual([]);
  });

  it('names a real reason for every non-foreground', () => {
    for (const [name, why] of Object.entries(NOT_A_FOREGROUND)) {
      expect(why.length, `${name} has no reason`).toBeGreaterThan(20);
    }
  });

  it('never lists a token as both a foreground and a non-foreground', () => {
    const covered = new Set(PERMITTED.map((pair) => pair.fg));
    const both = Object.keys(NOT_A_FOREGROUND).filter((name) =>
      covered.has(name),
    );
    expect(both).toEqual([]);
  });

  it('resolves the two pigments issue #45 repainted', () => {
    // Pins the fix itself: re-lightening either ramp fails here as well as in
    // the pair matrix, and names the issue in the failure.
    expect(resolve('--color-text-meta')).toBe('#7b6346');
    expect(resolve('--color-accent-planned')).toBe('#876000');
    expect(resolve('--color-category-utilities')).toBe('#876000');
    expect(resolve('--color-accent-spend')).toBe('#bf3326');
    expect(resolve('--color-category-health')).toBe('#bf3326');
  });
});
