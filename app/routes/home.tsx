import { en } from '../i18n/en';
import { Card } from '../ui';
import type { Route } from './+types/home';

export function meta(_: Route.MetaArgs) {
  return [
    { title: 'Cifra' },
    {
      name: 'description',
      content: 'Privacy-first personal finance — local, encrypted',
    },
  ];
}

/**
 * Overview — the destination sign-in lands on. Phase 1 has no data to show
 * yet, so it renders the ported welcome/empty state; the figures arrive with
 * the transaction loop (Phase 3).
 *
 * The page owns no chrome: the `<h1>`, the nav and the responsive frame belong
 * to the shell it is mounted inside (`app/routes/app-layout.tsx`), so the
 * page's own headings start at `<h2>`.
 */
export default function Home() {
  return (
    <Card as="section" className="max-w-page">
      <h2 className="font-display text-stat text-text-primary">
        {en.welcome_heading}
      </h2>
      <p className="mt-6 font-body text-body text-text-secondary">
        {en.welcome_body}
      </p>
      <ul className="mt-8 flex flex-col gap-4">
        <li className="font-mono text-label uppercase text-text-secondary">
          {en.welcome_hint1}
        </li>
        <li className="font-mono text-label uppercase text-text-secondary">
          {en.welcome_hint2}
        </li>
      </ul>
    </Card>
  );
}
