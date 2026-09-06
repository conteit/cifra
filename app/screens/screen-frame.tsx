import type { ReactNode } from 'react';

import { Card } from '../ui/card';

/* ═══════════════════════════════════════════════════════════════════════════
   The frame the three pre-shell screens are printed on.

   Sign-in, vault setup and unlock all render *outside* `AppShell`: there is no
   nav to offer, no page to title, and nothing the user could usefully reach.
   They share one frame instead — the wordmark, the tagline, and a single card
   on the page measure, centred at both breakpoints.

   Like everything else below the routes, this takes its copy as props and
   holds no locale of its own.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ScreenFrameProps {
  /** `tagline_line1` / `tagline_line2`, the app's two-line signature. */
  taglineLine1: string;
  taglineLine2: string;
  /** The card's heading. Rendered as the `<h2>` under the tagline's `<h1>`. */
  title: string;
  /** Optional line under the heading. */
  subtitle?: string;
  /** Identifies the screen to the e2e suite without coupling it to copy. */
  screen: string;
  children: ReactNode;
  /** Rendered under the card, outside it — footnotes and secondary actions. */
  footer?: ReactNode;
}

export function ScreenFrame({
  taglineLine1,
  taglineLine2,
  title,
  subtitle,
  screen,
  children,
  footer,
}: ScreenFrameProps) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-surface-page px-6 py-12 desktop:px-8">
      <main
        data-screen={screen}
        className="flex w-full max-w-dialog flex-col gap-8"
      >
        <div>
          <p className="font-mono text-label uppercase text-text-muted">
            Cifra
          </p>
          <h1 className="mt-3 font-display text-stat text-text-primary">
            {taglineLine1}
            <br />
            {taglineLine2}
          </h1>
        </div>

        <Card as="section" elevation="float" className="flex flex-col gap-7">
          <div>
            <h2 className="font-display text-title text-text-primary">
              {title}
            </h2>
            {subtitle ? (
              <p className="mt-3 font-body text-body text-text-secondary">
                {subtitle}
              </p>
            ) : null}
          </div>
          {children}
        </Card>

        {footer ? <div>{footer}</div> : null}
      </main>
    </div>
  );
}

/**
 * A short, loud paragraph for the consequences a user has to have read: losing
 * both secrets, or a vault that cannot be re-created.
 *
 * `accent-spend` on its own wash — the one pair D16 permits for that pigment
 * outside the plain text surfaces, and the pair the money accents already use
 * for badges.
 */
export function ScreenNotice({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-control bg-accent-spend-surface px-6 py-5 font-body text-row-sub text-accent-spend">
      {children}
    </p>
  );
}

/**
 * The failure line for a screen-level error.
 *
 * `role="alert"` rather than a plain paragraph: these appear in response to an
 * action the user just took (a rejected password, a blocked popup) and are the
 * only feedback that anything happened, so they have to be announced rather
 * than merely painted.
 */
export function ScreenError({ children }: { children: ReactNode }) {
  return (
    <p
      role="alert"
      className="font-body text-row-sub text-accent-spend"
      data-testid="screen-error"
    >
      {children}
    </p>
  );
}
