import type { Strings } from '../i18n';
import type { AuthError, AuthErrorCode } from '../services/auth/types';

/**
 * Provider-neutral failure code → localised line.
 *
 * The session store deliberately carries a *code* and no copy
 * (`app/services/auth/types.ts`), so this is where the two meet. It lives at
 * the screen layer rather than in the store for the same reason the shell takes
 * its strings as props: a store that held English text could not be rendered in
 * Italian, and a store that reached for the locale would invert
 * `pages → stores`.
 *
 * The map is exhaustive by construction — `Record<AuthErrorCode, …>` fails to
 * compile when a code is added to the taxonomy without a line to say for it, so
 * a new failure mode cannot ship as a silent blank.
 */
const AUTH_ERROR_KEYS = {
  'popup-closed': 'auth_error_popup_closed',
  'popup-blocked': 'auth_error_popup_blocked',
  cancelled: 'auth_error_cancelled',
  network: 'auth_error_network',
  'account-exists-with-different-credential': 'auth_error_account_exists',
  'unauthorized-domain': 'auth_error_unauthorized_domain',
  'operation-not-allowed': 'auth_error_operation_not_allowed',
  'user-disabled': 'auth_error_user_disabled',
  'too-many-requests': 'auth_error_too_many_requests',
  configuration: 'auth_error_configuration',
  'storage-unsupported': 'auth_error_storage_unsupported',
  unknown: 'auth_error_unknown',
} as const satisfies Record<AuthErrorCode, keyof Strings>;

/** Every copy key this module can name. */
export type AuthErrorStringKey = (typeof AUTH_ERROR_KEYS)[AuthErrorCode];

export type AuthErrorStrings = Pick<Strings, AuthErrorStringKey>;

/** The line to show for a failure, or `null` when there is nothing to say. */
export function authErrorMessage(
  strings: AuthErrorStrings,
  error: AuthError | null,
): string | null {
  if (error === null) return null;
  return strings[AUTH_ERROR_KEYS[error.code]];
}
