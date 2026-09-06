import { useId } from 'react';

import type { InstallAffordance } from '../services/pwa/install-prompt';
import { Button } from '../ui/button';
import { Card } from '../ui/card';

/* ═══════════════════════════════════════════════════════════════════════════
   The install affordance — FOUN-06's user-facing half.

   A strip of paper at the top of the page offering to put Cifra on the home
   screen. Like everything else in `app/shell`, it is deliberately dumb: it
   takes its state and its copy as props and calls back. Deciding *whether*
   there is anything to offer belongs to `app/services/pwa/install-prompt.ts`;
   wiring the two together is the layout route's job.

   Two variants, one component (see D25 in `docs/architecture.md`):

     · `available` — Chromium captured a `beforeinstallprompt`, so there is a
       real button that opens the browser's install dialog.
     · `guidance`  — iOS/iPadOS, where that event never fires and the only
       install path is the browser's own Share menu. The strip carries the
       two-step instruction instead of a button. Dismiss is still offered, and
       it is the only way out on this platform: there is no `appinstalled`
       event on iOS either, so an undismissed strip would outlive the install.

   `hidden` renders nothing at all — no wrapper, no spacing, no landmark.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The copy this component needs. `app/i18n/en.ts` satisfies it structurally,
 * so a route hands the active string table straight in.
 */
export type InstallPromptStrings = Readonly<{
  install_title: string;
  /** The offer, on a platform where the browser will do the installing. */
  install_body: string;
  /** The Share → Add to Home Screen instruction, for iOS/iPadOS. */
  install_ios_body: string;
  install_action: string;
  install_dismiss: string;
}>;

export interface InstallPromptProps {
  state: InstallAffordance;
  strings: InstallPromptStrings;
  /** Fires the captured browser prompt. Only reachable in `available`. */
  onInstall: () => void;
  onDismiss: () => void;
}

export function InstallPrompt({
  state,
  strings,
  onInstall,
  onDismiss,
}: InstallPromptProps) {
  // Hooks run before the early return: `useId` is unconditional so the
  // component keeps a stable hook order across a state change.
  const titleId = useId();

  if (state === 'hidden') return null;

  return (
    // A named `region`, not an `aside`: `aside` inside `<main>` is a
    // complementary landmark nested in a content landmark, which axe flags as
    // a best-practice violation. A section with an accessible name says the
    // same thing — "this is a self-contained offer, not part of the page" —
    // without the nesting problem.
    <Card
      as="section"
      aria-labelledby={titleId}
      data-testid="install-prompt"
      data-install-state={state}
      className="mb-8 flex flex-col gap-6 desktop:flex-row desktop:items-center desktop:justify-between"
    >
      <div className="min-w-0">
        <h2 id={titleId} className="font-display text-title text-text-primary">
          {strings.install_title}
        </h2>
        <p className="mt-2 font-body text-body text-text-secondary">
          {state === 'guidance'
            ? strings.install_ios_body
            : strings.install_body}
        </p>
      </div>

      <div className="flex shrink-0 items-center gap-4">
        {state === 'available' ? (
          <Button onClick={onInstall}>{strings.install_action}</Button>
        ) : null}
        <Button variant="quiet" onClick={onDismiss}>
          {strings.install_dismiss}
        </Button>
      </div>
    </Card>
  );
}
