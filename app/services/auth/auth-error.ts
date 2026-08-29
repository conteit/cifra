import type { AuthErrorCode } from './types';

/**
 * Maps a raw provider error onto the neutral `AuthErrorCode` taxonomy.
 *
 * Pure and Firebase-free on purpose: the mapping table is the only place that
 * knows Firebase's `auth/*` string codes, and it can be unit-tested without
 * loading the SDK.
 */
const FIREBASE_CODE_MAP: Readonly<Record<string, AuthErrorCode>> = {
  'auth/popup-closed-by-user': 'popup-closed',
  'auth/user-cancelled': 'popup-closed',
  'auth/popup-blocked': 'popup-blocked',
  'auth/cancelled-popup-request': 'cancelled',
  'auth/network-request-failed': 'network',
  'auth/account-exists-with-different-credential':
    'account-exists-with-different-credential',
  'auth/unauthorized-domain': 'unauthorized-domain',
  'auth/operation-not-allowed': 'operation-not-allowed',
  'auth/user-disabled': 'user-disabled',
  'auth/too-many-requests': 'too-many-requests',
  'auth/web-storage-unsupported': 'storage-unsupported',
  'auth/invalid-api-key': 'configuration',
  'auth/api-key-not-valid': 'configuration',
  'auth/app-not-authorized': 'configuration',
  'auth/invalid-app-id': 'configuration',
};

/** Marker for a config failure raised by us rather than by the SDK. */
export class AuthConfigurationError extends Error {
  readonly name = 'AuthConfigurationError';
}

function readCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  try {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : undefined;
  } catch {
    // A throwing getter must not turn an auth failure into a crash.
    return undefined;
  }
}

/**
 * Never throws and never returns `undefined` — an unrecognised failure becomes
 * `'unknown'` so the store always has a code to surface.
 */
export function mapAuthErrorCode(error: unknown): AuthErrorCode {
  if (error instanceof AuthConfigurationError) return 'configuration';

  const raw = readCode(error);
  if (raw === undefined) return 'unknown';

  const mapped = FIREBASE_CODE_MAP[raw];
  if (mapped !== undefined) return mapped;

  // Firebase occasionally appends detail after the code, e.g.
  // "auth/api-key-not-valid.-please-pass-a-valid-api-key.".
  for (const [prefix, code] of Object.entries(FIREBASE_CODE_MAP)) {
    if (raw.startsWith(prefix)) return code;
  }

  return 'unknown';
}
