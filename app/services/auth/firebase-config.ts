import { AuthConfigurationError } from './auth-error';

/**
 * The Firebase web config, read from Vite's `import.meta.env`.
 *
 * These values are **public by design**. A Firebase web config is shipped
 * inside every client bundle and is not a credential — see `.env.example`.
 * Access control comes from Firebase Auth's authorized-domains list and from
 * backend security rules, not from hiding these strings. Cifra's privacy
 * guarantee does not rest on them either: they identify a Firebase project,
 * they decrypt nothing.
 */
export interface FirebaseWebConfig {
  readonly apiKey: string;
  readonly authDomain: string;
  readonly projectId: string;
  readonly appId: string;
}

/** Env var name → config field. Auth-only: no storage/messaging/analytics keys. */
const REQUIRED_KEYS = {
  VITE_FIREBASE_API_KEY: 'apiKey',
  VITE_FIREBASE_AUTH_DOMAIN: 'authDomain',
  VITE_FIREBASE_PROJECT_ID: 'projectId',
  VITE_FIREBASE_APP_ID: 'appId',
} as const satisfies Record<string, keyof FirebaseWebConfig>;

/** The subset of `import.meta.env` this module needs. Injected so it is testable. */
export type FirebaseEnv = Record<string, unknown>;

/**
 * Validates the Firebase env at startup and fails loudly with the names of the
 * missing variables, rather than letting the SDK die somewhere deeper with an
 * opaque message.
 *
 * @throws {AuthConfigurationError} when any required variable is missing or blank.
 */
export function readFirebaseConfig(env: FirebaseEnv): FirebaseWebConfig {
  const values: Partial<Record<keyof FirebaseWebConfig, string>> = {};
  const missing: string[] = [];

  for (const [envName, field] of Object.entries(REQUIRED_KEYS)) {
    const value = env[envName];
    if (typeof value !== 'string' || value.trim() === '') {
      missing.push(envName);
      continue;
    }
    values[field] = value.trim();
  }

  if (missing.length > 0) {
    throw new AuthConfigurationError(
      `Firebase auth is not configured. Missing or empty environment ${
        missing.length === 1 ? 'variable' : 'variables'
      }: ${missing.join(', ')}. Copy .env.example to .env and fill in the values from the Firebase console (Project settings → Your apps → Web app).`,
    );
  }

  return values as FirebaseWebConfig;
}
