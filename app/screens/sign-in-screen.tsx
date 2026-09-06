import type { Strings } from '../i18n';
import { Button } from '../ui/button';
import { ScreenError, ScreenFrame } from './screen-frame';

/* ═══════════════════════════════════════════════════════════════════════════
   Sign-in — key hierarchy step 1, and nothing more than step 1.

   The copy on this screen is load-bearing rather than decorative. Google
   sign-in identifies you; it does not unlock anything, and the three feature
   lines plus `signin_note` are where the app says so. The strings this screen
   renders were rewritten in #9 for exactly that reason: they used to advertise
   Gemini receipt scanning (an explicit v1 non-goal) on a screen whose job is to
   explain what signing in does and does not do.

   Presentational and controlled — status in, one callback out. The session
   store, the Firebase port and the locale all live above it.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Which of the session store's states this screen is painting.
 *
 * `'unavailable'` is a real user-facing state, not a developer's mistake: a
 * build with no `VITE_FIREBASE_*` variables and no emulator has no identity
 * provider at all, and before #9 that rendered as an app that simply never did
 * anything. It gets a screen that says so.
 */
export type SignInStatus = 'signed-out' | 'signing-in' | 'unavailable';

export type SignInStrings = Pick<
  Strings,
  | 'tagline_line1'
  | 'tagline_line2'
  | 'signin_title'
  | 'signin_sub'
  | 'signin_feat1_title'
  | 'signin_feat1_body'
  | 'signin_feat2_title'
  | 'signin_feat2_body'
  | 'signin_feat3_title'
  | 'signin_feat3_body'
  | 'signin_btn'
  | 'signing_in'
  | 'signin_note'
  | 'signin_unavailable_title'
  | 'signin_unavailable_body'
  | 'signin_unavailable_hint'
  | 'error_auth_heading'
>;

export interface SignInScreenProps {
  status: SignInStatus;
  strings: SignInStrings;
  /** Already localised — see `auth-error-copy.ts`. `null` when there is none. */
  errorMessage?: string | null;
  onSignIn: () => void;
}

function Feature({ title, body }: { title: string; body: string }) {
  return (
    <li>
      <p className="font-mono text-label uppercase text-text-primary">
        {title}
      </p>
      <p className="mt-2 font-body text-row-sub text-text-secondary">{body}</p>
    </li>
  );
}

export function SignInScreen({
  status,
  strings,
  errorMessage = null,
  onSignIn,
}: SignInScreenProps) {
  if (status === 'unavailable') {
    return (
      <ScreenFrame
        screen="sign-in-unavailable"
        taglineLine1={strings.tagline_line1}
        taglineLine2={strings.tagline_line2}
        title={strings.signin_unavailable_title}
        subtitle={strings.signin_unavailable_body}
      >
        {/* No sign-in button. There is nothing behind it, and a button that
            can only fail is worse than an explanation. */}
        <p className="font-body text-row-sub text-text-muted">
          {strings.signin_unavailable_hint}
        </p>
      </ScreenFrame>
    );
  }

  const signingIn = status === 'signing-in';

  return (
    <ScreenFrame
      screen="sign-in"
      taglineLine1={strings.tagline_line1}
      taglineLine2={strings.tagline_line2}
      title={strings.signin_title}
      subtitle={strings.signin_sub}
      footer={
        <p className="text-center font-body text-row-sub text-text-muted">
          {strings.signin_note}
        </p>
      }
    >
      <ul className="flex flex-col gap-6">
        <Feature
          title={strings.signin_feat1_title}
          body={strings.signin_feat1_body}
        />
        <Feature
          title={strings.signin_feat2_title}
          body={strings.signin_feat2_body}
        />
        <Feature
          title={strings.signin_feat3_title}
          body={strings.signin_feat3_body}
        />
      </ul>

      {errorMessage ? (
        <div>
          <p className="font-mono text-label uppercase text-accent-spend">
            {strings.error_auth_heading}
          </p>
          <ScreenError>{errorMessage}</ScreenError>
        </div>
      ) : null}

      <Button
        fullWidth
        loading={signingIn}
        onClick={onSignIn}
        data-testid="sign-in-button"
      >
        {signingIn ? strings.signing_in : strings.signin_btn}
      </Button>
    </ScreenFrame>
  );
}
