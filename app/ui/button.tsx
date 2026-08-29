import type { ComponentPropsWithRef } from 'react';

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
   * Marks the action in flight: disables the button, sets `aria-busy` and
   * shows a pulse. The *label* stays the caller's job (`signin_btn` →
   * `signing_in`), because only the page knows the waiting copy in-locale.
   */
  loading?: boolean;
}

const baseClasses = cx(
  'inline-flex items-center justify-center gap-4 rounded-control px-8 py-5',
  'font-mono text-button uppercase transition-colors',
  'disabled:cursor-not-allowed disabled:opacity-45',
  focusRing,
);

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-action-primary text-action-on-primary enabled:hover:bg-action-primary-hover',
  secondary:
    'border border-rule bg-surface-inset text-text-secondary enabled:hover:bg-surface-track',
  quiet: 'text-text-secondary enabled:hover:bg-surface-inset',
};

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
 */
export function Button({
  variant = 'primary',
  fullWidth = false,
  loading = false,
  disabled = false,
  type = 'button',
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        baseClasses,
        variantClasses[variant],
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
