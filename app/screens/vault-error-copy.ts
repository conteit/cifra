import type { Strings } from '../i18n';
import type { VaultErrorCode } from '../stores/vault';

/**
 * Vault failure code → localised line, for the two screens that can hit one.
 *
 * Same division of labour as `auth-error-copy.ts`: the store carries a code and
 * no copy, so the mapping lives at the screen layer where a locale is in scope.
 *
 * The map is exhaustive by construction — `Record<VaultErrorCode, …>` fails to
 * compile if a failure mode is added without a line to say for it.
 *
 * ## Why `environment` reads differently on the two screens
 *
 * `app/crypto/vault.ts` splits its failures in two: conditions the user can act
 * on come back as results, and environment failures throw. The store folds the
 * thrown half into a single `environment` code, but what to *say* about it
 * depends on what was being attempted. During setup no vault exists yet and the
 * honest message is that creation failed and nothing was lost; during unlock a
 * vault does exist and the honest message is that the browser could not run the
 * unlock. One code, two truths — so `context` picks between them rather than a
 * single line hedging both.
 */

const SHARED = {
  'vault/exists': 'unlock_error_vault_exists',
  'secret/rejected': 'unlock_error_secret_rejected',
  'phrase/malformed': 'unlock_error_phrase_malformed',
  'password/malformed': 'unlock_error_password_malformed',
  'record/invalid': 'unlock_error_record_invalid',
} as const satisfies Record<
  Exclude<VaultErrorCode, 'environment'>,
  keyof Strings
>;

const ENVIRONMENT = {
  setup: 'error_vault',
  unlock: 'unlock_error_environment',
} as const satisfies Record<'setup' | 'unlock', keyof Strings>;

export type VaultErrorStringKey =
  | (typeof SHARED)[keyof typeof SHARED]
  | (typeof ENVIRONMENT)[keyof typeof ENVIRONMENT];

export type VaultErrorStrings = Pick<Strings, VaultErrorStringKey>;

/** The line to show for a vault failure, or `null` when there is none. */
export function vaultErrorMessage(
  strings: VaultErrorStrings,
  error: VaultErrorCode | null,
  context: 'setup' | 'unlock',
): string | null {
  if (error === null) return null;
  if (error === 'environment') return strings[ENVIRONMENT[context]];
  return strings[SHARED[error]];
}
