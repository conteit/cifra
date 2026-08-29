import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  AUTH_EMULATOR_CONFIG,
  AUTH_EMULATOR_HOST,
  AUTH_EMULATOR_MODE,
  AUTH_EMULATOR_PORT,
  AUTH_EMULATOR_URL,
} from '../../app/services/auth/auth-emulator';
import { readFirebaseConfig } from '../../app/services/auth/firebase-config';
import { SESSION_TEST_HANDLE } from '../../app/stores/session-test-handle';
import { REPO_ROOT } from '../support/repo-graph';

/**
 * The Auth-emulator wiring (#44) is spread over six files that have to agree
 * with each other and cannot be checked by the type system:
 *
 *   · `firebase.json`            — the port the emulator binds
 *   · `auth-emulator.ts`         — the port the app dials
 *   · `package.json`             — the project id and mode the scripts pass
 *   · `firebase-auth-port.ts`    — the mode literals the branch tests
 *   · `session-instance.ts`      — the same literals, for the e2e handle
 *   · `vite.config.ts`           — the guard that reads the built bundle back
 *
 * A disagreement between any two of them fails as a two-minute e2e hang or, far
 * worse, as an emulator path that quietly survives into a production build. So
 * they are asserted against each other here, where the failure names the two
 * things that differ.
 *
 * `playwright.config.ts` carries the same firebase.json/app port check at config
 * load — deliberately duplicated, because a hang during `npm run test:e2e` must
 * not depend on somebody having run `test:unit` first.
 */

const read = (relativePath: string): string =>
  readFileSync(resolve(REPO_ROOT, relativePath), 'utf8');

const packageJson: { scripts: Record<string, string> } = JSON.parse(
  read('package.json'),
);

const firebaseJson: { emulators: Record<string, unknown> } = JSON.parse(
  read('firebase.json'),
);

/**
 * The build-time condition, written out exactly as it must appear in source.
 *
 * Not built from `AUTH_EMULATOR_MODE`: the point of the assertion is that the
 * literal is spelled out at the branch site so Vite can substitute
 * `import.meta.env.MODE` and the bundler can fold the comparison. A constant
 * would defeat the fold, and the check has to notice that.
 */
const MODE_GUARD = [
  "import.meta.env.MODE === 'development'",
  `import.meta.env.MODE === '${AUTH_EMULATOR_MODE}'`,
];

describe('emulator constants', () => {
  it('builds its URL from its own host and port', () => {
    expect(AUTH_EMULATOR_URL).toBe(
      `http://${AUTH_EMULATOR_HOST}:${AUTH_EMULATOR_PORT}`,
    );
  });

  it('uses a demo- project id, which can never name a real Firebase project', () => {
    // Firebase's own convention: tooling refuses to reach production for a
    // project id with this prefix. A typo here would otherwise be the one way
    // this feature could talk to something real.
    expect(AUTH_EMULATOR_CONFIG.projectId.startsWith('demo-')).toBe(true);
  });

  it('is a complete FirebaseWebConfig — the same four fields production needs', () => {
    // Feeding it back through the production reader proves the emulator branch
    // is not relying on a partially-filled config the real path would reject.
    expect(
      readFirebaseConfig({
        VITE_FIREBASE_API_KEY: AUTH_EMULATOR_CONFIG.apiKey,
        VITE_FIREBASE_AUTH_DOMAIN: AUTH_EMULATOR_CONFIG.authDomain,
        VITE_FIREBASE_PROJECT_ID: AUTH_EMULATOR_CONFIG.projectId,
        VITE_FIREBASE_APP_ID: AUTH_EMULATOR_CONFIG.appId,
      }),
    ).toEqual(AUTH_EMULATOR_CONFIG);
  });
});

describe('firebase.json', () => {
  it('binds the Auth emulator to the port the app dials', () => {
    expect(firebaseJson.emulators.auth).toMatchObject({
      host: AUTH_EMULATOR_HOST,
      port: AUTH_EMULATOR_PORT,
    });
  });

  it('configures no emulator other than auth', () => {
    // CLAUDE.md: "Firebase is auth only. No financial data in Firestore, ever."
    // `ui` and `singleProjectMode` are emulator-suite settings, not products.
    expect(Object.keys(firebaseJson.emulators).sort()).toEqual([
      'auth',
      'singleProjectMode',
      'ui',
    ]);
  });

  it('declares no Firebase product at the top level either', () => {
    const config: Record<string, unknown> = JSON.parse(read('firebase.json'));
    for (const product of [
      'firestore',
      'storage',
      'functions',
      'database',
      'hosting',
      'dataconnect',
    ]) {
      expect(config).not.toHaveProperty(product);
    }
  });
});

describe('npm scripts', () => {
  it('starts only the auth emulator, against the demo project', () => {
    const script = packageJson.scripts.emulators;
    expect(script).toContain('--only auth');
    expect(script).toContain(`--project ${AUTH_EMULATOR_CONFIG.projectId}`);
  });

  it('builds the e2e bundle in the mode the app branches on', () => {
    expect(packageJson.scripts['build:emulator']).toContain(
      `--mode ${AUTH_EMULATOR_MODE}`,
    );
  });

  it('leaves `build` in production mode, with no emulator flag', () => {
    expect(packageJson.scripts.build).not.toContain('--mode');
    expect(packageJson.scripts.build).not.toContain(AUTH_EMULATOR_MODE);
  });
});

describe('the emulator branch is written so the bundler can delete it', () => {
  const port = read('app/services/auth/firebase-auth-port.ts');
  const instance = read('app/stores/session-instance.ts');

  it.each(MODE_GUARD)(
    'firebase-auth-port.ts tests `%s` as a source literal',
    (clause) => {
      expect(port).toContain(clause);
    },
  );

  it.each(MODE_GUARD)(
    'session-instance.ts tests `%s` as a source literal',
    (clause) => {
      expect(instance).toContain(clause);
    },
  );

  it('calls connectAuthEmulator exactly once', () => {
    // More than one call site means more than one branch to keep foldable, and
    // the bundle guard only proves the *result*, not that every site was gated.
    expect(port.match(/connectAuthEmulator\(/g)).toHaveLength(1);
  });

  it('still reads the production config from the environment', () => {
    // The emulator must not become the only path. `readFirebaseConfig` throwing
    // on missing variables is what puts the store into 'unavailable', the branch
    // covered by test/unit/session-store.test.ts and firebase-config.test.ts.
    expect(port).toContain('readFirebaseConfig(import.meta.env)');
  });

  it('exposes the session store on the handle the e2e spec reads', () => {
    expect(instance).toContain('SESSION_TEST_HANDLE');
    expect(SESSION_TEST_HANDLE.startsWith('__cifra')).toBe(true);
  });
});

describe('the production-bundle guard', () => {
  const config = read('vite.config.ts');

  it('checks every emulator-only string the app can emit', () => {
    for (const token of [
      'AUTH_EMULATOR_BUILD_MARKER',
      'AUTH_EMULATOR_URL',
      'AUTH_EMULATOR_CONFIG.projectId',
      'SESSION_TEST_HANDLE',
    ]) {
      expect(config).toContain(token);
    }
  });

  it('asserts in both directions, so the negative check cannot go vacuous', () => {
    expect(config).toContain('!useEmulator && present.length > 0');
    expect(config).toContain('useEmulator && absent.length > 0');
  });
});
