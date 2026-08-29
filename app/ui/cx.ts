/**
 * Joins class names, dropping anything falsy.
 *
 * Deliberately *not* `tailwind-merge`: the primitives own their base classes
 * and expose `className` as an additive escape hatch for layout (margins, grid
 * placement, width), not as a way to repaint them. Conflict resolution would
 * invite exactly the raw-value overrides V1-3 forbids, so a plain join is both
 * simpler and the stricter contract.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ');
}

/**
 * The one keyboard-focus treatment in the system, shared by every interactive
 * primitive so focus never drifts per component. `focus-visible` (not `focus`)
 * keeps the ring off pointer interactions.
 */
export const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring';
