/**
 * Byte-buffer helpers shared by the crypto layer.
 *
 * Pure TypeScript with no dependencies; per the layer contract it imports
 * neither React nor Dexie.
 */

/**
 * Narrows a caller-supplied byte array to one that is known to sit on a private
 * `ArrayBuffer`, copying only when it does not.
 *
 * Two reasons this exists rather than a cast:
 *
 * - **Correctness.** Web Crypto's `BufferSource` is `ArrayBufferView<ArrayBuffer>`,
 *   while a plain `Uint8Array` parameter is `Uint8Array<ArrayBufferLike>` and so
 *   may be backed by a `SharedArrayBuffer`. TypeScript rejects the assignment,
 *   and it is right to.
 * - **Security.** A `SharedArrayBuffer` can be written by another thread while
 *   Web Crypto reads it. For an authenticated cipher that is a genuine
 *   time-of-check/time-of-use hazard: the bytes whose tag was verified need not
 *   be the bytes anyone later acts on. Copying into memory only this call can
 *   see removes the window.
 *
 * The common case — a `Uint8Array` over an ordinary `ArrayBuffer` — is returned
 * unchanged, so nothing is copied on the hot path.
 */
export function asPrivateBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  if (bytes.buffer instanceof ArrayBuffer) {
    return bytes as Uint8Array<ArrayBuffer>;
  }
  const copy = new Uint8Array(new ArrayBuffer(bytes.length));
  copy.set(bytes);
  return copy;
}
