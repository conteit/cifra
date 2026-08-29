import { describe, expect, it } from 'vitest';

import { AuthConfigurationError } from '../../app/services/auth/auth-error';
import { readFirebaseConfig } from '../../app/services/auth/firebase-config';

const COMPLETE_ENV = {
  VITE_FIREBASE_API_KEY: 'AIza-fake-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'cifra-test.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'cifra-test',
  VITE_FIREBASE_APP_ID: '1:1234567890:web:abcdef',
};

describe('readFirebaseConfig', () => {
  it('maps the four VITE_ variables onto the Firebase web config', () => {
    expect(readFirebaseConfig(COMPLETE_ENV)).toEqual({
      apiKey: 'AIza-fake-key',
      authDomain: 'cifra-test.firebaseapp.com',
      projectId: 'cifra-test',
      appId: '1:1234567890:web:abcdef',
    });
  });

  it('trims surrounding whitespace from values', () => {
    const config = readFirebaseConfig({
      ...COMPLETE_ENV,
      VITE_FIREBASE_PROJECT_ID: '  cifra-test \n',
    });
    expect(config.projectId).toBe('cifra-test');
  });

  it('ignores unrelated env vars rather than forwarding them to Firebase', () => {
    const config = readFirebaseConfig({
      ...COMPLETE_ENV,
      VITE_FIREBASE_MEASUREMENT_ID: 'G-XXXX',
      SOME_SECRET: 'do-not-leak',
    });
    expect(Object.keys(config).sort()).toEqual([
      'apiKey',
      'appId',
      'authDomain',
      'projectId',
    ]);
  });

  it.each(Object.keys(COMPLETE_ENV))(
    'fails loudly, naming %s, when it is missing',
    (missing) => {
      const env: Record<string, unknown> = { ...COMPLETE_ENV };
      delete env[missing];

      expect(() => readFirebaseConfig(env)).toThrow(AuthConfigurationError);
      expect(() => readFirebaseConfig(env)).toThrow(missing);
    },
  );

  it('treats a blank value as missing', () => {
    expect(() =>
      readFirebaseConfig({ ...COMPLETE_ENV, VITE_FIREBASE_API_KEY: '   ' }),
    ).toThrow('VITE_FIREBASE_API_KEY');
  });

  it('treats a non-string value as missing', () => {
    expect(() =>
      readFirebaseConfig({ ...COMPLETE_ENV, VITE_FIREBASE_APP_ID: 42 }),
    ).toThrow('VITE_FIREBASE_APP_ID');
  });

  it('names every missing variable at once, not just the first', () => {
    expect(() => readFirebaseConfig({})).toThrow(
      /VITE_FIREBASE_API_KEY.*VITE_FIREBASE_AUTH_DOMAIN.*VITE_FIREBASE_PROJECT_ID.*VITE_FIREBASE_APP_ID/,
    );
  });

  it('points the reader at .env.example', () => {
    expect(() => readFirebaseConfig({})).toThrow(/\.env\.example/);
  });
});
