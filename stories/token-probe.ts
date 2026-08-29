/**
 * Resolves a colour token to the exact string `getComputedStyle` returns.
 *
 * Reading `--color-focus-ring` off the root gives the *authored* text
 * (`rgb(28 28 26 / 0.45)`), while computed styles come back serialised
 * (`rgba(28, 28, 26, 0.45)`), so the two can never be compared directly.
 * Painting the token onto a throw-away element and reading it back makes the
 * comparison exact — which is what turns "the focus ring is not transparent"
 * (true even with the ring deleted, because the UA draws its own) into "the
 * focus ring is *this token*".
 */
export function resolveColorToken(doc: Document, token: string): string {
  const probe = doc.createElement('div');
  probe.style.color = `var(${token})`;
  doc.body.appendChild(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value;
}
