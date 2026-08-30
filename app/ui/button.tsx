import type { ComponentPropsWithRef, KeyboardEvent, MouseEvent } from 'react';

import { cx, focusRing } from './cx';

/**
 * `primary`   — ink, not green. Green is money (see `--color-action-primary`).
 * `secondary` — inset paper with a rule; the peer action next to a primary.
 * `quiet`     — no chrome until hovered; toolbar and in-row affordances.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'quiet';

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  /** Stretches to the container — the sign-in and lock screens' single action. */
  fullWidth?: boolean;
  /**
   * Marks the action in flight: sets `aria-busy`, locks activation via
   * `aria-disabled`, and shows a pulse. The button stays focusable — see the
   * note on {@link Button}. The *label* stays the caller's job (`signin_btn` →
   * `signing_in`), because only the page knows the waiting copy in-locale.
   */
  loading?: boolean;
}

const baseClasses = cx(
  'inline-flex items-center justify-center gap-4 rounded-control px-8 py-5',
  'font-mono text-button uppercase transition-colors',
  focusRing,
);

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-action-primary text-action-on-primary',
  secondary: 'border border-rule bg-surface-inset text-text-secondary',
  quiet: 'text-text-secondary',
};

/**
 * Hover is a promise that a click will do something, so it is painted only
 * while the button can actually be activated. Gating it here rather than with
 * an `enabled:`/`aria-disabled:` CSS variant keeps one predicate — `inactive`
 * below — governing every inactive treatment, including the `loading` case
 * that carries no `disabled` attribute for `enabled:` to key off.
 */
const variantHoverClasses: Record<ButtonVariant, string> = {
  primary: 'hover:bg-action-primary-hover',
  secondary: 'hover:bg-surface-track',
  quiet: 'hover:bg-surface-inset',
};

/**
 * The keys the browser turns into a click on a `<button>`: Enter on keydown,
 * Space on keyup. `' '` is what `KeyboardEvent.key` reports for the space bar;
 * `'Spacebar'` is the legacy IE/Edge spelling, kept because the cost is one
 * string and the failure mode is a button that activates while busy.
 */
const ACTIVATION_KEYS = new Set([' ', 'Spacebar', 'Enter']);

/**
 * The one button in the system.
 *
 * Extends the native `<button>` element, so `onClick`, `form`, `name`,
 * `aria-*` and `ref` all pass through untouched (React 19 takes `ref` as a
 * plain prop — no `forwardRef` wrapper needed).
 *
 * `type` defaults to `"button"`, not the HTML default `"submit"`: a button
 * that silently submits an enclosing form is the more expensive accident.
 * Form submits opt in explicitly with `type="submit"`.
 *
 * ## `loading` is `aria-disabled`, never `disabled` (#54)
 *
 * A focused element that gains the `disabled` attribute is blurred by the
 * browser, and focus falls to `<body>`. So the keyboard or screen-reader user
 * who *presses* the sign-in button is thrown to the top of the document at the
 * exact moment they are waiting for it — the one moment they need the button
 * to keep speaking to them. `aria-disabled` keeps the element focusable and
 * keeps the focus it already has, so the busy state is announced on the
 * control the user is standing on.
 *
 * The price is that `aria-disabled` is a promise, not a lock: it changes what
 * assistive tech announces and nothing else. The lock is the two handlers
 * below — see `handleClick` and `handleKeyDown`.
 *
 * `disabled` (the prop) is untouched by all this: a genuinely unavailable
 * button is still a natively `disabled` one, and is correctly unreachable by
 * Tab. `loading` means "reachable, announced, and not listening".
 */
export function Button({
  variant = 'primary',
  fullWidth = false,
  loading = false,
  disabled = false,
  type = 'button',
  className,
  children,
  onClick,
  onKeyDown,
  onKeyUp,
  ...rest
}: ButtonProps) {
  /** Dimmed and inert to hover, whichever way it got there. */
  const inactive = disabled || loading;

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    if (loading) {
      // `preventDefault` is what stops an enclosing form from submitting:
      // submission is the *default action* of a click on `type="submit"`,
      // including the click the browser synthesises for implicit submission
      // from a text field. `stopPropagation` keeps the dead click from
      // reaching a delegated handler on an ancestor.
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onClick?.(event);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (loading && ACTIVATION_KEYS.has(event.key)) {
      // Suppressing the key at keydown stops the click from ever being
      // synthesised, so no click handler anywhere sees one. It also keeps the
      // caller's own `onKeyDown` — which the click guard cannot reach — from
      // running the action a second way.
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onKeyDown?.(event);
  }

  function handleKeyUp(event: KeyboardEvent<HTMLButtonElement>) {
    if (loading && ACTIVATION_KEYS.has(event.key)) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onKeyUp?.(event);
  }

  return (
    <button
      type={type}
      disabled={disabled}
      aria-disabled={loading || undefined}
      aria-busy={loading || undefined}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      className={cx(
        baseClasses,
        variantClasses[variant],
        inactive
          ? 'cursor-not-allowed opacity-45'
          : variantHoverClasses[variant],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className="h-4 w-4 animate-pulse rounded-pill bg-current"
        />
      ) : null}
      {children}
    </button>
  );
}
