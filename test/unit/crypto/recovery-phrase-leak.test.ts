import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { afterEach, describe, expect, it } from 'vitest';
import {
  decodeRecoveryPhrase,
  normalizeRecoveryPhrase,
} from '../../../app/crypto/recovery-phrase';
import { createVault } from '../../../app/crypto/vault';
import { recordingKdfWorkerFactory } from '../../support/kdf-worker-port';
import { occurrences, scan } from '../../support/raw-scan';
import { REPO_ROOT } from '../../support/repo-graph';
import { openTestVault, rawDump, type TestVault } from '../db/support';

/**
 * "The phrase is never persisted anywhere by the app, never logged, and never
 * sent anywhere. **Assert this, do not merely intend it.**" — issue #68.
 *
 * An intention is a code review; this is three independent proofs, because each
 * one alone has an obvious way to be vacuous:
 *
 * 1. **Persistence** — a vault is created and its record stored through the
 *    real db layer, then raw IndexedDB is dumped and searched for the phrase in
 *    every shape it could survive in: as written, normalized, ungrouped, and as
 *    its 20 raw entropy bytes inside any binary blob. The same scan must *find*
 *    the salt and the wrapped copy that are supposed to be in that row — a
 *    scanner that looked in the wrong place would otherwise report "clean".
 * 2. **Transmission** — the only message-passing boundary in the crypto layer
 *    is the Argon2id worker. Every byte the recovery path would put across it is
 *    captured (the port records what the worker side received *before*
 *    serialization) and searched. Unlocking by phrase must not even spawn one.
 * 3. **Logging and storage APIs** — the two modules that ever hold the phrase
 *    as a value are read with the TypeScript parser and asserted to name no
 *    storage, network or console API at all. Written against the AST rather
 *    than a regular expression for the reason review finding S-3 gave: a regex
 *    over source text misses the forms nobody has written yet.
 *
 * The scanner in leg 1 is the shared `test/support/raw-scan.ts` — the same one
 * the plaintext-leak test uses — for the same reason it was moved there: two
 * copies drift into two definitions of "found".
 */

const PHRASE_MODULES = [
  'app/crypto/recovery-phrase.ts',
  'app/crypto/vault.ts',
] as const;

/**
 * APIs that would persist, log or transmit whatever they are handed. `Worker`
 * and `postMessage` are in the list because the Argon2id worker is the one
 * boundary the phrase could plausibly be pushed across by a future refactor
 * that "unified" the two unlock paths onto the KDF.
 */
const SINKS = [
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'openDatabase',
  'caches',
  'cookie',
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'sendBeacon',
  'navigator',
  'document',
  'console',
  'postMessage',
  'Worker',
  'BroadcastChannel',
  'history',
  'alert',
] as const;

let vault: TestVault | undefined;

afterEach(() => {
  vault?.close();
  vault = undefined;
});

/** Every identifier and string literal the parser sees in a module. */
function namesIn(source: string, path: string): Set<string> {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      names.add(node.text);
    }
    // String literals too: `globalThis['localStorage']` names the sink without
    // ever writing it as an identifier.
    if (ts.isStringLiteralLike(node)) names.add(node.text);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return names;
}

/** Whether `needle` appears in any binary buffer of a raw dump. */
function bytesAppear(
  buffers: readonly Uint8Array[],
  needle: Uint8Array,
): boolean {
  return buffers.some((buffer) => {
    if (needle.length === 0 || needle.length > buffer.length) return false;
    outer: for (let at = 0; at <= buffer.length - needle.length; at++) {
      for (let index = 0; index < needle.length; index++) {
        if (buffer[at + index] !== needle[index]) continue outer;
      }
      return true;
    }
    return false;
  });
}

describe('the recovery phrase never reaches storage', () => {
  it('is nowhere in the meta row the vault writes, in any shape', async () => {
    const created = await createVault('una password per il test', {
      createWorker: recordingKdfWorkerFactory(),
    });
    vault = await openTestVault({ dataKey: created.dataKey });
    // Exactly what #9 will store: the whole record as one plaintext `meta` row.
    await vault.db.meta.put({ key: 'vault', ...created.record });

    const dump = await rawDump(vault.name);
    const scanned = scan(dump);

    // Liveness: the scan really is looking at the row that was just written.
    // If these fail, every negative assertion below is vacuous.
    expect(scanned.strings).toContain('vault');
    expect(
      bytesAppear(scanned.buffers, created.record.recoveryWrappedDataKey),
      'the wrapped recovery copy must be in the dump',
    ).toBe(true);
    expect(
      bytesAppear(scanned.buffers, created.record.recoverySalt),
      'the recovery salt must be in the dump',
    ).toBe(true);

    const phrase = created.recoveryPhrase;
    const forms = [
      phrase,
      phrase.toLowerCase(),
      phrase.replaceAll('-', ''),
      phrase.replaceAll('-', ' '),
      normalizeRecoveryPhrase(phrase),
      ...phrase.split('-'),
    ];
    for (const form of forms) {
      expect(occurrences(scanned, form), `phrase form "${form}"`).toEqual([]);
    }
    // And the secret behind the writing: the 20 bytes themselves.
    expect(
      bytesAppear(scanned.buffers, decodeRecoveryPhrase(phrase)),
      'the phrase entropy must not appear in any stored buffer',
    ).toBe(false);
  });
});

describe('the recovery phrase never crosses a message boundary', () => {
  it('is in nothing the Argon2id worker was sent or answered', async () => {
    const factory = recordingKdfWorkerFactory();
    const created = await createVault('una password per il test', {
      createWorker: factory,
    });

    // Liveness: creation really did drive a worker, so there is traffic to scan.
    expect(factory.ports).toHaveLength(1);
    const traffic = scan({
      requests: factory.ports.flatMap((port) => port.requests),
      responses: factory.ports.flatMap((port) => port.responses),
    });
    expect(traffic.strings.length).toBeGreaterThan(0);

    const phrase = created.recoveryPhrase;
    for (const form of [
      phrase,
      phrase.replaceAll('-', ''),
      ...phrase.split('-'),
    ]) {
      expect(occurrences(traffic, form), `phrase form "${form}"`).toEqual([]);
    }
    expect(bytesAppear(traffic.buffers, decodeRecoveryPhrase(phrase))).toBe(
      false,
    );
  });
});

describe('the modules that hold the phrase name no sink at all', () => {
  it.each(PHRASE_MODULES)(
    '%s reaches for nothing that persists, logs or sends',
    (module) => {
      const path = resolve(REPO_ROOT, module);
      const names = namesIn(readFileSync(path, 'utf8'), path);
      expect([...SINKS].filter((sink) => names.has(sink))).toEqual([]);
    },
  );

  it('finds those sinks when they are there (positive control)', () => {
    const source = `
      export function leak(phrase: string): void {
        localStorage.setItem('recovery', phrase);
        console.log(phrase);
        void fetch('/telemetry', { method: 'POST', body: phrase });
        globalThis['sessionStorage'].setItem('recovery', phrase);
      }
    `;
    const names = namesIn(source, resolve(REPO_ROOT, 'leak-fixture.ts'));
    expect([...SINKS].filter((sink) => names.has(sink)).sort()).toEqual([
      'console',
      'fetch',
      'localStorage',
      'sessionStorage',
    ]);
  });
});
