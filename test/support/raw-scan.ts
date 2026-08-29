/**
 * The plaintext-leak scanner: flatten anything that came out of raw IndexedDB,
 * then say every way a sentinel value appears in it.
 *
 * `docs/architecture.md` §Table field allowlist requires "a plaintext-leak test
 * that dumps raw IndexedDB after writes and fails if any known plaintext value
 * appears", and CLAUDE.md makes that test permanent: "do not weaken or skip it".
 *
 * It lives here, beside the import-graph walker, because there are now **two**
 * leak tests over the same guarantee and they must not drift into two different
 * definitions of "found":
 *
 *   · `test/unit/db/plaintext-leak.test.ts` — Node, `fake-indexeddb`;
 *   · `test/e2e/db-liveness.spec.ts` — Chromium, real IndexedDB, rows carried
 *     back out of page context (#42).
 *
 * A second, subtly weaker copy of this scanner in the browser spec would be the
 * easiest possible way to ship a green leak test that finds nothing because it
 * cannot look. One implementation, two callers, and both of them carry a
 * scanner-liveness assertion and a positive control against unencrypted writes.
 */

/** Every scalar and every binary buffer reachable in a raw dump. */
export interface RawScan {
  readonly strings: string[];
  readonly numbers: number[];
  readonly buffers: Uint8Array[];
}

function walk(node: unknown, scan: RawScan, seen: Set<object>): void {
  if (typeof node === 'string') {
    scan.strings.push(node);
    return;
  }
  if (typeof node === 'number') {
    scan.numbers.push(node);
    return;
  }
  if (typeof node === 'bigint') {
    scan.strings.push(node.toString());
    return;
  }
  if (node instanceof ArrayBuffer) {
    scan.buffers.push(new Uint8Array(node));
    return;
  }
  if (ArrayBuffer.isView(node)) {
    const view = node as ArrayBufferView;
    scan.buffers.push(
      new Uint8Array(view.buffer, view.byteOffset, view.byteLength),
    );
    return;
  }
  if (node === null || typeof node !== 'object') return;
  if (seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    for (const item of node) walk(item, scan, seen);
    return;
  }
  for (const [key, value] of Object.entries(node)) {
    // Property *names* are part of the stored representation too: a leaked
    // field would show up as a key long before its value did.
    scan.strings.push(key);
    walk(value, scan, seen);
  }
}

/** Flattens anything — a whole dump, one store, one row — into scannable parts. */
export function scan(node: unknown): RawScan {
  const collected: RawScan = { strings: [], numbers: [], buffers: [] };
  walk(node, collected, new Set());
  return collected;
}

function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  if (needle.length === 0 || needle.length > haystack.length) return -1;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

/**
 * Every way `sentinel` shows up in a scan, described in words.
 *
 * A value can plausibly survive into storage in three shapes, so all three are
 * searched:
 *
 * 1. as a JavaScript string (or as a property name);
 * 2. as a number, both by exact numeric equality and by its decimal digits
 *    appearing inside a string;
 * 3. as UTF-8 bytes inside any binary buffer — which is what a "blob" that is
 *    not actually encrypted would look like.
 *
 * An empty result means the sentinel is nowhere in the dump. A non-empty result
 * is a leak (or, for the positive control, proof the scanner works).
 */
export function occurrences(
  scanned: RawScan,
  sentinel: string | number,
): string[] {
  const text = typeof sentinel === 'number' ? String(sentinel) : sentinel;
  const needle = new TextEncoder().encode(text);
  const hits: string[] = [];

  if (typeof sentinel === 'number') {
    const exact = scanned.numbers.filter((value) => value === sentinel).length;
    if (exact > 0) hits.push(`${exact} numeric value(s) equal to ${text}`);
  }
  const inStrings = scanned.strings.filter((value) =>
    value.includes(text),
  ).length;
  if (inStrings > 0) hits.push(`${inStrings} string(s) containing "${text}"`);

  const inBuffers = scanned.buffers.filter(
    (buffer) => indexOfBytes(buffer, needle) !== -1,
  ).length;
  if (inBuffers > 0) {
    hits.push(`${inBuffers} binary buffer(s) containing the UTF-8 bytes`);
  }
  return hits;
}
