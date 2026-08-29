import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

/**
 * The port is deliberately **not** Vite's default 4173, and the server is
 * deliberately **never** reused.
 *
 * Review finding C-10, second half. With `reuseExistingServer: !process.env.CI`
 * a `vite preview` left running by another checkout of this repo silently
 * served *its* build on 4173. Four separate agents ran the suite against a
 * foreign build during Sprint 01 and each drew a confidently wrong conclusion
 * from the result. Nothing in the output said which build had been tested.
 *
 * Two changes, and why they beat the alternative:
 *
 *   1. `reuseExistingServer: false`, unconditionally. Playwright then *refuses
 *      to start* when anything already listens here, rather than adopting it.
 *      The considered alternative was a preflight assertion that the served
 *      build matches the working tree — but that is strictly weaker: it needs
 *      a fingerprint baked into the build, it only detects the mismatch after
 *      paying to start a run, and it is one more mechanism that can itself
 *      rot. Refusing to adopt a server this run did not start makes serving a
 *      foreign build *impossible* rather than *detectable*. The cost is a
 *      rebuild per run — `webServer.command` already rebuilds whenever it
 *      starts a server, so the only thing lost is the fast repeat loop that
 *      caused the bug in the first place.
 *   2. Port 4318 rather than 4173. This does not address the same-repo
 *      collision — only (1) does — but 4173 is the port every Vite project on
 *      the machine reaches for by default, so moving off it removes the much
 *      larger class of collisions with unrelated projects.
 */
const PORT = 4318;

/**
 * `npm run preview` pins the port too, and the two must agree or the suite
 * would wait two minutes for a server that is listening elsewhere. Cheap
 * enough to check at config load, so the drift can never happen quietly.
 */
const previewScript: string = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./package.json', import.meta.url)),
    'utf8',
  ),
).scripts.preview;

if (!previewScript.includes(`--port ${PORT}`)) {
  throw new Error(
    `playwright.config.ts expects port ${PORT}, but package.json's preview script is "${previewScript}"`,
  );
}

export default defineConfig({
  testDir: 'test/e2e',
  webServer: {
    command: 'npm run build && npm run preview',
    port: PORT,
    // Never adopt a server this run did not start. See the note above.
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: { baseURL: `http://localhost:${PORT}` },
});
