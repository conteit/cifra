import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractModuleReferences } from '../../support/import-graph';
import { REPO_ROOT } from '../../support/repo-graph';

/**
 * #92: `beforeinstallprompt` fires once per page load, seconds in, and is
 * gone if nobody is listening. After #9 the only consumer of the controller
 * was `AppLayout`, which mounts after sign-in *and* unlock — so the listener
 * attached minutes late, the affordance never appeared on Chromium, and
 * Chrome's own mini-infobar showed because nothing called `preventDefault`.
 *
 * The fix is that the root module reaches the composition root directly, so
 * the controller exists from first paint. This pins that import as a value
 * import of `app/root.tsx`; `test/e2e/auth-emulator.spec.ts` proves the
 * timing in a browser.
 */
describe('the install-prompt controller is created at app start', () => {
  it('is a value import of app/root.tsx, not only of a route', () => {
    const path = 'app/root.tsx';
    const { references } = extractModuleReferences(
      readFileSync(join(REPO_ROOT, path), 'utf8'),
      path,
    );
    expect(
      references.some(
        (reference) =>
          reference.specifier === './stores/install-prompt-instance' &&
          !reference.typeOnly,
      ),
    ).toBe(true);
  });
});
