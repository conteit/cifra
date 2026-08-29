import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { Button } from '../app/ui/button';
import { Card } from '../app/ui/card';
import { type Bilingual, type Locale, localeFrom, t } from './locale';

/* ═══════════════════════════════════════════════════════════════════════════
   Card — the paper every panel is printed on.

   Presentational only: surface, rule, radius, elevation, padding. Width and
   placement come from the caller, which is why the stories set them here and
   the component never does.
   ═══════════════════════════════════════════════════════════════════════════ */

const copy = {
  tones: { en: 'Tones', it: 'Toni' },
  elevation: { en: 'Elevation', it: 'Elevazione' },
  unpadded: {
    en: 'Unpadded, for full-bleed rows',
    it: 'Senza padding, per righe a tutta larghezza',
  },
  semantics: { en: 'Semantics', it: 'Semantica' },
  semanticsNote: {
    en: '`as` picks the element. A card standing for a region of the page is a section; a card in a list is an li.',
    it: '`as` sceglie l’elemento. Una scheda che rappresenta una regione della pagina è una section; una scheda in una lista è un li.',
  },
  balanceLabel: { en: 'Distributable surplus', it: 'Surplus distribuibile' },
  monthLabel: { en: 'March 2026', it: 'Marzo 2026' },
  income: { en: 'Income', it: 'Entrate' },
  spend: { en: 'Spend', it: 'Uscite' },
  defaultTone: { en: 'default', it: 'default' },
  inverseTone: { en: 'inverse', it: 'inverse' },
} satisfies Record<string, Bilingual>;

const rows = [
  {
    desc: 'Esselunga Milano',
    meta: { en: 'Groceries · 12 Mar', it: 'Spesa · 12 mar' },
    amount: '−€ 84,20',
  },
  {
    desc: 'Stipendio',
    meta: { en: 'Salary · 27 Mar', it: 'Stipendio · 27 mar' },
    amount: '+€ 2.940,00',
  },
  {
    desc: 'Caffè Sant’Eustachio',
    meta: { en: 'Bar · 14 Mar', it: 'Bar · 14 mar' },
    amount: '−€ 4,50',
  },
];

function Frame({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-surface-page p-10">
      <h2 className="font-mono text-label uppercase text-text-muted">
        {title}
      </h2>
      {note ? (
        <p className="mt-4 max-w-page font-body text-row-sub text-text-secondary">
          {note}
        </p>
      ) : null}
      <div className="mt-8">{children}</div>
    </section>
  );
}

const meta = {
  title: 'UI/Card',
  component: Card,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Card>;

export default meta;

type Story = StoryObj<typeof meta>;

/* ── Tones ──────────────────────────────────────────────────────────────── */

function Tones({ locale }: { locale: Locale }) {
  return (
    <Frame title={copy.tones[locale]}>
      <div className="grid grid-cols-1 gap-8 desktop:grid-cols-2">
        <Card as="section">
          <p className="font-mono text-label uppercase text-text-muted">
            {copy.defaultTone[locale]}
          </p>
          <p className="mt-4 font-mono text-label-sm uppercase text-text-secondary">
            {copy.balanceLabel[locale]}
          </p>
          <p className="mt-3 font-display text-stat text-text-primary">
            € 1.284,50
          </p>
        </Card>

        <Card as="section" tone="inverse" elevation="float">
          <p className="font-mono text-label uppercase text-text-inverse">
            {copy.inverseTone[locale]}
          </p>
          <p className="mt-4 font-mono text-label-sm uppercase text-text-inverse">
            {copy.monthLabel[locale]}
          </p>
          <p className="mt-3 font-display text-stat text-text-inverse">
            € 1.284,50
          </p>
          <div className="mt-8 flex gap-10">
            <div>
              <p className="font-mono text-label-sm uppercase text-text-inverse">
                {copy.income[locale]}
              </p>
              <p className="mt-2 font-display text-numeral-sm text-accent-income-surface">
                € 2.940,00
              </p>
            </div>
            <div>
              <p className="font-mono text-label-sm uppercase text-text-inverse">
                {copy.spend[locale]}
              </p>
              <p className="mt-2 font-display text-numeral-sm text-accent-spend-surface">
                € 1.655,50
              </p>
            </div>
          </div>
        </Card>
      </div>
    </Frame>
  );
}

export const Tone: Story = {
  render: (_args, ctx) => <Tones locale={localeFrom(ctx.globals)} />,
};

export const ToneItalian: Story = {
  globals: { locale: 'it' },
  render: (_args, ctx) => <Tones locale={localeFrom(ctx.globals)} />,
};

export const ToneMobile: Story = {
  globals: { viewport: { value: 'mobile' } },
  render: (_args, ctx) => <Tones locale={localeFrom(ctx.globals)} />,
};

/* ── Elevation ──────────────────────────────────────────────────────────── */

export const Elevation: Story = {
  render: (_args, ctx) => {
    const locale = localeFrom(ctx.globals);
    return (
      <Frame title={copy.elevation[locale]}>
        <div className="flex flex-wrap gap-10">
          <Card className="w-full desktop:w-auto">
            <p className="font-mono text-label uppercase text-text-muted">
              shadow-card
            </p>
          </Card>
          <Card elevation="float" className="w-full desktop:w-auto">
            <p className="font-mono text-label uppercase text-text-muted">
              shadow-float
            </p>
          </Card>
        </div>
      </Frame>
    );
  },
};

/* ── Unpadded, hosting a divided list ───────────────────────────────────── */

function ListCard({ locale }: { locale: Locale }) {
  return (
    <Frame title={copy.unpadded[locale]}>
      <Card as="section" padded={false} className="max-w-page">
        <div className="border-b border-rule px-8 py-6">
          <h3 className="font-display text-title text-text-primary">
            {t(locale, 'txn_title')}
          </h3>
        </div>
        <ul>
          {rows.map((row) => (
            <li
              key={row.desc}
              className="flex items-center gap-6 border-b border-rule-soft px-8 py-6 last:border-b-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-body text-row text-text-primary">
                  {row.desc}
                </p>
                <p className="truncate font-body text-row-sub text-text-muted">
                  {row.meta[locale]}
                </p>
              </div>
              <p className="shrink-0 font-display text-numeral-sm text-text-primary">
                {row.amount}
              </p>
            </li>
          ))}
        </ul>
        <div className="flex justify-end px-8 py-6">
          <Button variant="secondary">{t(locale, 'txn_import_btn')}</Button>
        </div>
      </Card>
    </Frame>
  );
}

export const Unpadded: Story = {
  render: (_args, ctx) => <ListCard locale={localeFrom(ctx.globals)} />,
};

export const UnpaddedMobile: Story = {
  globals: { viewport: { value: 'mobile' } },
  render: (_args, ctx) => <ListCard locale={localeFrom(ctx.globals)} />,
};

export const UnpaddedItalian: Story = {
  globals: { locale: 'it' },
  render: (_args, ctx) => <ListCard locale={localeFrom(ctx.globals)} />,
};

/* ── Semantics: `as` really changes the element ─────────────────────────── */

export const Semantics: Story = {
  render: (_args, ctx) => {
    const locale = localeFrom(ctx.globals);
    return (
      <Frame title={copy.semantics[locale]} note={copy.semanticsNote[locale]}>
        <ul className="flex flex-col gap-6">
          <Card as="li" data-testid="card-li">
            <p className="font-mono text-label uppercase text-text-muted">
              as=&quot;li&quot;
            </p>
          </Card>
        </ul>
        <Card as="article" className="mt-6" data-testid="card-article">
          <p className="font-mono text-label uppercase text-text-muted">
            as=&quot;article&quot;
          </p>
        </Card>
      </Frame>
    );
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByTestId('card-li').tagName).toBe('LI');
    await expect(canvas.getByTestId('card-article').tagName).toBe('ARTICLE');
    // A card in a list must still be reachable as a listitem.
    await expect(canvas.getAllByRole('listitem')).toHaveLength(1);
  },
};
