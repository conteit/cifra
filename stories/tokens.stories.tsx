import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';

/* ═══════════════════════════════════════════════════════════════════════════
   Editorial Italiana v2 — the design token reference sheet.

   This story is the living spec for `app/app.css`. Every swatch and every
   specimen is drawn with the semantic token it documents (via `var(--…)` or a
   Tailwind utility), and the hex column is read back from the live cascade at
   render time — so the sheet cannot drift from the stylesheet.

   V1-3: components reference intent, never colour identity. The `--ramp-*`
   pigments below generate no utilities; only the semantic aliases do.
   ═══════════════════════════════════════════════════════════════════════════ */

type Locale = 'en' | 'it';

type Bilingual = Record<Locale, string>;

const chrome = {
  title: { en: 'Editorial Italiana v2', it: 'Editorial Italiana v2' },
  subtitle: {
    en: 'Semantic tokens. Components name intent, never a colour or a size.',
    it: 'Token semantici. I componenti nominano l’intento, mai un colore o una misura.',
  },
  palette: { en: 'Palette', it: 'Tavolozza' },
  surfaces: { en: 'Surfaces', it: 'Superfici' },
  text: { en: 'Text', it: 'Testo' },
  money: { en: 'Money, by intent', it: 'Denaro, per intento' },
  actions: { en: 'Actions and rules', it: 'Azioni e filetti' },
  categories: { en: 'Categories', it: 'Categorie' },
  type: { en: 'Type scale', it: 'Scala tipografica' },
  spacing: { en: 'Spacing scale', it: 'Scala delle spaziature' },
  shape: { en: 'Radii and elevation', it: 'Raggi ed elevazione' },
  context: { en: 'In context', it: 'In contesto' },
  rampNote: {
    en: 'The ramp is private: --ramp-* names generate no utilities. Only the semantic aliases are component-facing.',
    it: 'Il pigmento è privato: i nomi --ramp-* non generano utility. Solo gli alias semantici sono esposti ai componenti.',
  },
  spacingNote: {
    en: 'One 2px step drives the whole scale. p-4 is 8px, not 16px.',
    it: 'Un passo da 2px genera l’intera scala. p-4 vale 8px, non 16px.',
  },
} satisfies Record<string, Bilingual>;

/* ── Palette data ───────────────────────────────────────────────────────── */

type Swatch = {
  /** Component-facing custom property. */
  token: string;
  /** The private pigment it aliases, or a literal for the rules. */
  ramp: string;
  use: Bilingual;
  /** Draw the swatch as a bordered tile — needed for pale surfaces. */
  outlined?: boolean;
};

const surfaces: Swatch[] = [
  {
    token: '--color-surface-page',
    ramp: '--ramp-cream-100',
    use: { en: 'The page itself', it: 'La pagina stessa' },
    outlined: true,
  },
  {
    token: '--color-surface-card',
    ramp: '--ramp-cream-50',
    use: { en: 'Cards, header, nav', it: 'Schede, header, nav' },
    outlined: true,
  },
  {
    token: '--color-surface-inset',
    ramp: '--ramp-cream-200',
    use: { en: 'Inset panels, chips', it: 'Pannelli incassati, chip' },
    outlined: true,
  },
  {
    token: '--color-surface-track',
    ramp: '--ramp-cream-300',
    use: { en: 'Progress tracks', it: 'Barre di avanzamento' },
    outlined: true,
  },
  {
    token: '--color-surface-inverse',
    ramp: '--ramp-ink-900',
    use: { en: 'Dark hero panels', it: 'Pannelli scuri in evidenza' },
  },
];

const textColours: Swatch[] = [
  {
    token: '--color-text-primary',
    ramp: '--ramp-ink-900',
    use: { en: 'Body copy, numerals', it: 'Testo corrente, numeri' },
  },
  {
    token: '--color-text-secondary',
    ramp: '--ramp-ink-700',
    use: { en: 'Supporting copy', it: 'Testo di supporto' },
  },
  {
    token: '--color-text-muted',
    ramp: '--ramp-ink-500',
    use: { en: 'Labels, inactive nav', it: 'Etichette, nav inattiva' },
  },
  {
    token: '--color-text-meta',
    ramp: '--ramp-sepia-500',
    use: { en: 'Units, timestamps', it: 'Unità, orari' },
  },
  {
    token: '--color-text-inverse',
    ramp: '--ramp-cream-100',
    use: { en: 'Copy on inverse panels', it: 'Testo su pannelli scuri' },
    outlined: true,
  },
];

const money: Swatch[] = [
  {
    token: '--color-accent-income',
    ramp: '--ramp-green-700',
    use: { en: 'Income, success', it: 'Entrate, conferme' },
  },
  {
    token: '--color-accent-income-strong',
    ramp: '--ramp-green-500',
    use: { en: 'Hover, secondary income', it: 'Hover, entrate secondarie' },
  },
  {
    token: '--color-accent-income-surface',
    ramp: '--ramp-green-100',
    use: { en: 'Wash behind income', it: 'Fondo per le entrate' },
    outlined: true,
  },
  {
    token: '--color-accent-spend',
    ramp: '--ramp-red-600',
    use: { en: 'Spend, error, danger', it: 'Spese, errori, pericolo' },
  },
  {
    token: '--color-accent-spend-surface',
    ramp: '--ramp-red-50',
    use: { en: 'Wash behind spend', it: 'Fondo per le spese' },
    outlined: true,
  },
  {
    token: '--color-accent-planned',
    ramp: '--ramp-amber-600',
    use: { en: 'Planned entries, warnings', it: 'Voci previste, avvisi' },
  },
  {
    token: '--color-accent-planned-surface',
    ramp: '--ramp-amber-50',
    use: { en: 'Wash behind planned', it: 'Fondo per le voci previste' },
    outlined: true,
  },
  {
    token: '--color-accent-cash',
    ramp: '--ramp-violet-700',
    use: { en: 'Cash wallet entries', it: 'Voci del portafoglio contanti' },
  },
  {
    token: '--color-accent-cash-surface',
    ramp: '--ramp-violet-50',
    use: { en: 'Wash behind cash', it: 'Fondo per i contanti' },
    outlined: true,
  },
];

const actions: Swatch[] = [
  {
    token: '--color-action-primary',
    ramp: '--ramp-ink-900',
    use: {
      en: 'Primary button — ink, because green is money',
      it: 'Bottone primario — inchiostro, perché il verde è denaro',
    },
  },
  {
    token: '--color-action-primary-hover',
    ramp: '--ramp-ink-700',
    use: { en: 'Primary button hover', it: 'Hover del bottone primario' },
  },
  {
    token: '--color-action-on-primary',
    ramp: '--ramp-cream-100',
    use: { en: 'Label on a primary button', it: 'Testo sul bottone primario' },
    outlined: true,
  },
  {
    token: '--color-focus-ring',
    ramp: '--ramp-green-700',
    use: { en: 'Keyboard focus ring', it: 'Anello di focus da tastiera' },
  },
  {
    token: '--color-rule',
    ramp: 'ink 12%',
    use: { en: 'Structural borders', it: 'Bordi strutturali' },
    outlined: true,
  },
  {
    token: '--color-rule-soft',
    ramp: 'ink 6%',
    use: { en: 'List row dividers', it: 'Separatori tra righe' },
    outlined: true,
  },
];

const categoryNames = [
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

const categoryLabels: Record<(typeof categoryNames)[number], Bilingual> = {
  groceries: { en: 'Groceries', it: 'Spesa' },
  housing: { en: 'Housing', it: 'Casa' },
  transport: { en: 'Transport', it: 'Trasporti' },
  dining: { en: 'Dining', it: 'Ristoranti' },
  subscriptions: { en: 'Subscriptions', it: 'Abbonamenti' },
  health: { en: 'Health', it: 'Salute' },
  sport: { en: 'Sport', it: 'Sport' },
  utilities: { en: 'Utilities', it: 'Utenze' },
  bar: { en: 'Bar', it: 'Bar' },
  other: { en: 'Other', it: 'Altro' },
};

/* ── Type data ──────────────────────────────────────────────────────────── */

type TypeRole = {
  /** Tailwind utility trio that fully expresses the role. */
  className: string;
  name: string;
  metrics: string;
  sample: Bilingual;
};

const typeRoles: TypeRole[] = [
  {
    className: 'font-display text-display',
    name: 'text-display',
    metrics: 'clamp(2.6rem, 5vw, 3.9rem) · 300 · -0.02em',
    sample: { en: '€ 4.318,20', it: '€ 4.318,20' },
  },
  {
    className: 'font-display text-stat',
    name: 'text-stat',
    metrics: 'clamp(1.7rem, 2.6vw, 2.3rem) · 300 · -0.015em',
    sample: { en: '€ 1.284,50', it: '€ 1.284,50' },
  },
  {
    className: 'font-display text-title',
    name: 'text-title',
    metrics: '21px / 1.15 · 400',
    sample: { en: 'Distributable surplus', it: 'Surplus distribuibile' },
  },
  {
    className: 'font-display text-numeral',
    name: 'text-numeral',
    metrics: '24px / 1 · 300',
    sample: { en: '€ 312,90', it: '€ 312,90' },
  },
  {
    className: 'font-display text-numeral-sm',
    name: 'text-numeral-sm',
    metrics: '17px / 1 · 300',
    sample: { en: '€ 46,10', it: '€ 46,10' },
  },
  {
    className: 'font-body text-body',
    name: 'text-body',
    metrics: '13px / 1.65 · 400',
    sample: {
      en: 'Your money is encrypted on this device before it is stored.',
      it: 'I tuoi soldi sono cifrati su questo dispositivo prima di essere salvati.',
    },
  },
  {
    className: 'font-body text-row',
    name: 'text-row',
    metrics: '13px / 1.2 · 500',
    sample: { en: 'Esselunga Milano', it: 'Esselunga Milano' },
  },
  {
    className: 'font-body text-row-sub',
    name: 'text-row-sub',
    metrics: '11.5px / 1.6 · 400',
    sample: { en: 'Groceries · Card ••4417', it: 'Spesa · Carta ••4417' },
  },
  {
    className: 'font-mono text-label uppercase',
    name: 'text-label',
    metrics: '9px / 1.4 · 0.14em · uppercase',
    sample: { en: 'This month', it: 'Questo mese' },
  },
  {
    className: 'font-mono text-label-sm uppercase',
    name: 'text-label-sm',
    metrics: '8.5px / 1.4 · 0.12em · uppercase',
    sample: { en: 'Updated 09:41', it: 'Aggiornato 09:41' },
  },
  {
    className: 'font-mono text-badge uppercase',
    name: 'text-badge',
    metrics: '8.5px / 1.4 · 0.10em · uppercase',
    sample: { en: 'Reconciled', it: 'Riconciliato' },
  },
  {
    className: 'font-mono text-button uppercase',
    name: 'text-button',
    metrics: '11px / 1 · 0.12em · uppercase',
    sample: { en: 'Import statement', it: 'Importa estratto' },
  },
];

/* ── Spacing / shape data ───────────────────────────────────────────────── */

const spacingSteps = [
  { utility: 'p-2', px: 4 },
  { utility: 'p-3', px: 6 },
  { utility: 'p-4', px: 8 },
  { utility: 'p-5', px: 10 },
  { utility: 'p-6', px: 12 },
  { utility: 'p-7', px: 14 },
  { utility: 'p-8', px: 16 },
  { utility: 'p-9', px: 18 },
  { utility: 'p-10', px: 20 },
  { utility: 'p-11', px: 22 },
  { utility: 'p-13', px: 26 },
  { utility: 'p-16', px: 32 },
  { utility: 'p-22', px: 44 },
];

const radii = [
  { className: 'rounded-badge', name: 'rounded-badge', use: '2px · badges' },
  {
    className: 'rounded-control',
    name: 'rounded-control',
    use: '4px · buttons, inputs, chips',
  },
  { className: 'rounded-card', name: 'rounded-card', use: '8px · cards' },
  {
    className: 'rounded-sheet',
    name: 'rounded-sheet',
    use: '12px · sheets, frames',
  },
  { className: 'rounded-pill', name: 'rounded-pill', use: '20px · pills' },
];

/* ── Live token readback ────────────────────────────────────────────────── */

const allSwatches = [...surfaces, ...textColours, ...money, ...actions];
const readbackNames = [
  ...allSwatches.map((s) => s.token),
  ...categoryNames.map((c) => `--color-category-${c}`),
];

/**
 * Resolves the documented custom properties against the live cascade, so the
 * value column is the stylesheet's answer rather than a hand-copied hex.
 */
function useResolvedTokens(): Record<string, string> {
  const [resolved, setResolved] = useState<Record<string, string>>({});
  useEffect(() => {
    const computed = getComputedStyle(document.documentElement);
    setResolved(
      Object.fromEntries(
        readbackNames.map((name) => [
          name,
          computed.getPropertyValue(name).trim(),
        ]),
      ),
    );
  }, []);
  return resolved;
}

/* ── Presentational pieces ──────────────────────────────────────────────── */

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="font-mono text-label uppercase text-text-muted">
      {children}
    </span>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-16 first:mt-0">
      <div className="flex items-baseline justify-between gap-6 border-b border-rule pb-4">
        <h2 className="font-display text-title text-text-primary">{title}</h2>
        {note ? (
          <p className="hidden font-body text-row-sub text-text-meta desktop:block">
            {note}
          </p>
        ) : null}
      </div>
      {note ? (
        <p className="mt-4 font-body text-row-sub text-text-meta desktop:hidden">
          {note}
        </p>
      ) : null}
      <div className="mt-8">{children}</div>
    </section>
  );
}

function SwatchRow({
  swatch,
  value,
  locale,
}: {
  swatch: Swatch;
  value: string | undefined;
  locale: Locale;
}) {
  return (
    <div className="flex items-center gap-6 border-b border-rule-soft py-5 last:border-b-0">
      <div
        aria-hidden="true"
        className={`h-11 w-11 shrink-0 rounded-control ${
          swatch.outlined ? 'border border-rule' : ''
        }`}
        style={{ backgroundColor: `var(${swatch.token})` }}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate font-mono text-row-sub text-text-primary">
          {swatch.token}
        </p>
        <p className="truncate font-body text-row-sub text-text-muted">
          {swatch.use[locale]}
        </p>
      </div>
      <div className="hidden shrink-0 text-right desktop:block">
        <p className="font-mono text-label-sm uppercase text-text-meta">
          {swatch.ramp}
        </p>
        <p className="font-mono text-row-sub text-text-secondary">
          {value || '—'}
        </p>
      </div>
    </div>
  );
}

function SwatchGroup({
  title,
  swatches,
  resolved,
  locale,
}: {
  title: string;
  swatches: Swatch[];
  resolved: Record<string, string>;
  locale: Locale;
}) {
  return (
    <div className="rounded-card border border-rule bg-surface-card px-8 py-6 shadow-card">
      <Label>{title}</Label>
      <div className="mt-4">
        {swatches.map((swatch) => (
          <SwatchRow
            key={swatch.token}
            swatch={swatch}
            value={resolved[swatch.token]}
            locale={locale}
          />
        ))}
      </div>
    </div>
  );
}

function PaletteSection({ locale }: { locale: Locale }) {
  const resolved = useResolvedTokens();
  return (
    <Section title={chrome.palette[locale]} note={chrome.rampNote[locale]}>
      <div className="grid grid-cols-1 gap-8 desktop:grid-cols-2">
        <SwatchGroup
          title={chrome.surfaces[locale]}
          swatches={surfaces}
          resolved={resolved}
          locale={locale}
        />
        <SwatchGroup
          title={chrome.text[locale]}
          swatches={textColours}
          resolved={resolved}
          locale={locale}
        />
        <SwatchGroup
          title={chrome.money[locale]}
          swatches={money}
          resolved={resolved}
          locale={locale}
        />
        <SwatchGroup
          title={chrome.actions[locale]}
          swatches={actions}
          resolved={resolved}
          locale={locale}
        />
      </div>

      <div className="mt-8 rounded-card border border-rule bg-surface-card px-8 py-6 shadow-card">
        <Label>{chrome.categories[locale]}</Label>
        <div className="mt-6 flex flex-wrap gap-4">
          {categoryNames.map((name) => (
            <span
              key={name}
              className="inline-flex items-center gap-3 rounded-pill px-6 py-3 font-mono text-badge uppercase"
              style={{
                backgroundColor: `var(--color-category-${name}-surface)`,
                color: `var(--color-category-${name})`,
              }}
            >
              <span
                aria-hidden="true"
                className="h-3 w-3 rounded-pill"
                style={{ backgroundColor: `var(--color-category-${name})` }}
              />
              {categoryLabels[name][locale]}
            </span>
          ))}
        </div>
      </div>
    </Section>
  );
}

function TypeSection({ locale }: { locale: Locale }) {
  return (
    <Section title={chrome.type[locale]}>
      <div className="rounded-card border border-rule bg-surface-card px-8 py-6 shadow-card">
        {typeRoles.map((role) => (
          <div
            key={role.name}
            className="grid grid-cols-1 gap-4 border-b border-rule-soft py-8 last:border-b-0 desktop:grid-cols-[13rem_1fr] desktop:items-baseline desktop:gap-8"
          >
            <div>
              <p className="font-mono text-row-sub text-text-primary">
                {role.name}
              </p>
              <p className="font-mono text-label-sm uppercase text-text-meta">
                {role.metrics}
              </p>
            </div>
            <p className={`${role.className} text-text-primary`}>
              {role.sample[locale]}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}

function SpacingSection({ locale }: { locale: Locale }) {
  return (
    <Section title={chrome.spacing[locale]} note={chrome.spacingNote[locale]}>
      <div className="rounded-card border border-rule bg-surface-card px-8 py-6 shadow-card">
        <div className="flex items-end gap-4">
          {spacingSteps.map((step) => (
            <div
              key={step.utility}
              className="flex flex-col items-center gap-3"
            >
              <div
                aria-hidden="true"
                className="w-6 rounded-badge bg-accent-income-surface"
                style={{ height: `${step.px}px` }}
              />
              <span className="font-mono text-label-sm uppercase text-text-meta">
                {step.px}
              </span>
            </div>
          ))}
        </div>
        <dl className="mt-8 grid grid-cols-2 gap-x-8 gap-y-3 desktop:grid-cols-4">
          {spacingSteps.map((step) => (
            <div key={step.utility} className="flex justify-between gap-4">
              <dt className="font-mono text-row-sub text-text-primary">
                {step.utility}
              </dt>
              <dd className="font-mono text-row-sub text-text-meta">
                {step.px}px
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}

function ShapeSection({ locale }: { locale: Locale }) {
  return (
    <Section title={chrome.shape[locale]}>
      <div className="grid grid-cols-1 gap-8 desktop:grid-cols-2">
        <div className="rounded-card border border-rule bg-surface-card px-8 py-6 shadow-card">
          <Label>radius</Label>
          <div className="mt-6 flex flex-wrap gap-8">
            {radii.map((radius) => (
              <div key={radius.name} className="flex flex-col gap-3">
                <div
                  aria-hidden="true"
                  className={`h-22 w-22 border border-rule bg-surface-inset ${radius.className}`}
                />
                <span className="font-mono text-label-sm uppercase text-text-meta">
                  {radius.use}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="rounded-card border border-rule bg-surface-card px-8 py-6 shadow-card">
          <Label>shadow</Label>
          <div className="mt-6 flex flex-wrap gap-8">
            <div className="flex flex-col gap-3">
              <div
                aria-hidden="true"
                className="h-22 w-22 rounded-card bg-surface-card shadow-card"
              />
              <span className="font-mono text-label-sm uppercase text-text-meta">
                shadow-card
              </span>
            </div>
            <div className="flex flex-col gap-3">
              <div
                aria-hidden="true"
                className="h-22 w-22 rounded-card bg-surface-card shadow-float"
              />
              <span className="font-mono text-label-sm uppercase text-text-meta">
                shadow-float
              </span>
            </div>
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ── Composed specimen ──────────────────────────────────────────────────── */

const specimen = {
  heading: { en: 'March 2026', it: 'Marzo 2026' },
  balanceLabel: { en: 'Distributable surplus', it: 'Surplus distribuibile' },
  balance: { en: '€ 1.284,50', it: '€ 1.284,50' },
  incomeLabel: { en: 'Income', it: 'Entrate' },
  income: { en: '€ 2.940,00', it: '€ 2.940,00' },
  spendLabel: { en: 'Spend', it: 'Uscite' },
  spend: { en: '€ 1.655,50', it: '€ 1.655,50' },
  primaryAction: { en: 'Import statement', it: 'Importa estratto' },
  secondaryAction: { en: 'Add expense', it: 'Aggiungi spesa' },
  rows: [
    {
      desc: 'Esselunga Milano',
      meta: { en: 'Groceries · 12 Mar', it: 'Spesa · 12 mar' },
      amount: '−€ 84,20',
      tone: 'spend' as const,
      badge: { en: 'Reconciled', it: 'Riconciliato' },
    },
    {
      desc: 'Stipendio',
      meta: { en: 'Salary · 27 Mar', it: 'Stipendio · 27 mar' },
      amount: '+€ 2.940,00',
      tone: 'income' as const,
      badge: { en: 'Bank', it: 'Banca' },
    },
    {
      desc: 'Caffè Sant’Eustachio',
      meta: { en: 'Bar · 14 Mar', it: 'Bar · 14 mar' },
      amount: '−€ 4,50',
      tone: 'cash' as const,
      badge: { en: 'Cash', it: 'Contanti' },
    },
    {
      desc: 'Assicurazione auto',
      meta: { en: 'Insurance · 31 Mar', it: 'Assicurazione · 31 mar' },
      amount: '−€ 312,90',
      tone: 'planned' as const,
      badge: { en: 'Planned', it: 'Prevista' },
    },
  ],
};

const toneClasses = {
  spend: { text: 'text-accent-spend', surface: 'bg-accent-spend-surface' },
  income: { text: 'text-accent-income', surface: 'bg-accent-income-surface' },
  cash: { text: 'text-accent-cash', surface: 'bg-accent-cash-surface' },
  planned: {
    text: 'text-accent-planned',
    surface: 'bg-accent-planned-surface',
  },
};

function ContextSection({ locale }: { locale: Locale }) {
  return (
    <Section title={chrome.context[locale]}>
      <div className="grid grid-cols-1 gap-8 desktop:grid-cols-[20rem_1fr]">
        <div className="rounded-card bg-surface-inverse px-10 py-9 shadow-float">
          <Label>
            <span className="text-text-inverse opacity-70">
              {specimen.heading[locale]}
            </span>
          </Label>
          <p className="mt-6 font-mono text-label-sm uppercase text-text-inverse opacity-60">
            {specimen.balanceLabel[locale]}
          </p>
          <p className="mt-3 font-display text-stat text-text-inverse">
            {specimen.balance[locale]}
          </p>
          <div className="mt-9 flex gap-10">
            <div>
              <p className="font-mono text-label-sm uppercase text-text-inverse opacity-60">
                {specimen.incomeLabel[locale]}
              </p>
              <p className="mt-2 font-display text-numeral-sm text-accent-income-surface">
                {specimen.income[locale]}
              </p>
            </div>
            <div>
              <p className="font-mono text-label-sm uppercase text-text-inverse opacity-60">
                {specimen.spendLabel[locale]}
              </p>
              <p className="mt-2 font-display text-numeral-sm text-accent-spend-surface">
                {specimen.spend[locale]}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-card border border-rule bg-surface-card px-8 py-6 shadow-card">
          {specimen.rows.map((row) => (
            <div
              key={row.desc}
              className="flex items-center gap-6 border-b border-rule-soft py-6 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-body text-row text-text-primary">
                  {row.desc}
                </p>
                <p className="truncate font-body text-row-sub text-text-muted">
                  {row.meta[locale]}
                </p>
              </div>
              <span
                className={`hidden shrink-0 rounded-badge px-3 py-2 font-mono text-badge uppercase desktop:inline ${toneClasses[row.tone].surface} ${toneClasses[row.tone].text}`}
              >
                {row.badge[locale]}
              </span>
              <p
                className={`shrink-0 font-display text-numeral-sm ${toneClasses[row.tone].text}`}
              >
                {row.amount}
              </p>
            </div>
          ))}
          <div className="mt-8 flex flex-wrap gap-4">
            <button
              type="button"
              className="rounded-control bg-action-primary px-8 py-5 font-mono text-button uppercase text-action-on-primary transition-colors hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              {specimen.primaryAction[locale]}
            </button>
            <button
              type="button"
              className="rounded-control border border-rule bg-surface-inset px-8 py-5 font-mono text-button uppercase text-text-secondary transition-colors hover:bg-surface-track focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
            >
              {specimen.secondaryAction[locale]}
            </button>
          </div>
        </div>
      </div>
    </Section>
  );
}

/* ── The sheet ──────────────────────────────────────────────────────────── */

type SectionId = 'palette' | 'type' | 'spacing' | 'shape' | 'context';

function Tokens({
  locale = 'en',
  sections = ['palette', 'type', 'spacing', 'shape', 'context'],
}: {
  locale?: Locale;
  sections?: SectionId[];
}) {
  return (
    <div className="min-h-screen bg-surface-page px-8 py-12 desktop:px-16">
      <header className="border-b border-rule pb-8">
        <Label>Cifra</Label>
        <h1 className="mt-3 font-display text-display text-text-primary">
          {chrome.title[locale]}
        </h1>
        <p className="mt-4 max-w-page font-body text-body text-text-secondary">
          {chrome.subtitle[locale]}
        </p>
      </header>
      <div className="mt-16">
        {sections.includes('palette') && <PaletteSection locale={locale} />}
        {sections.includes('type') && <TypeSection locale={locale} />}
        {sections.includes('spacing') && <SpacingSection locale={locale} />}
        {sections.includes('shape') && <ShapeSection locale={locale} />}
        {sections.includes('context') && <ContextSection locale={locale} />}
      </div>
    </div>
  );
}

const meta = {
  title: 'Design/Tokens',
  component: Tokens,
  parameters: { layout: 'fullscreen' },
  // Locale comes from the toolbar global so every story is bilingual by
  // construction; the explicit *Italian stories pin it for regression cover.
  render: (args, context) => (
    <Tokens {...args} locale={context.globals.locale as Locale} />
  ),
} satisfies Meta<typeof Tokens>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Overview: Story = {};

export const OverviewItalian: Story = {
  globals: { locale: 'it' },
};

export const OverviewMobile: Story = {
  globals: { viewport: { value: 'mobile' } },
};

export const OverviewMobileItalian: Story = {
  globals: { locale: 'it', viewport: { value: 'mobile' } },
};

export const Palette: Story = {
  args: { sections: ['palette'] },
};

export const Typography: Story = {
  args: { sections: ['type'] },
};

export const SpacingAndShape: Story = {
  args: { sections: ['spacing', 'shape'] },
};

export const InContext: Story = {
  args: { sections: ['context'] },
};

export const InContextItalian: Story = {
  args: { sections: ['context'] },
  globals: { locale: 'it' },
};

export const InContextMobile: Story = {
  args: { sections: ['context'] },
  globals: { viewport: { value: 'mobile' } },
};
