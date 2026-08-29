import { type ComponentPropsWithRef, useId } from 'react';

import { cx, focusRing } from './cx';

export interface InputProps
  extends Omit<
    ComponentPropsWithRef<'input'>,
    'aria-invalid' | 'aria-describedby'
  > {
  /**
   * Required, and rendered as a real `<label for>`: an unlabelled text field
   * is the single most common a11y defect in a form, so the primitive makes
   * it impossible rather than optional. Copy is a prop — the primitive has no
   * locale of its own (see the note on `app/i18n` in the PR).
   */
  label: string;
  /** Persistent helper text, announced via `aria-describedby`. */
  hint?: string;
  /**
   * The validation message. Its presence *is* the error state: it paints the
   * field, sets `aria-invalid="true"` and joins `aria-describedby`. There is
   * deliberately no separate `invalid` boolean — an errored field with no
   * message is not a state we want to be able to express.
   */
  error?: string;
}

const fieldClasses = cx(
  'w-full rounded-control border bg-surface-card px-6 py-5',
  'font-body text-row text-text-primary placeholder:text-text-muted',
  'transition-colors',
  'disabled:cursor-not-allowed disabled:bg-surface-inset disabled:text-text-muted',
  focusRing,
);

/**
 * A labelled text field.
 *
 * Extends the native `<input>`, so `type`, `value`, `onChange`, `required`,
 * `autoComplete`, `inputMode` and `ref` pass straight through. `className`
 * lands on the `<input>` itself; the wrapper is a bare column, so layout is
 * the caller's job.
 */
export function Input({
  label,
  hint,
  error,
  id,
  className,
  ...rest
}: InputProps) {
  const generatedId = useId();
  const inputId = id ?? `${generatedId}-input`;
  const hintId = `${generatedId}-hint`;
  const errorId = `${generatedId}-error`;

  const describedBy =
    [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ') ||
    undefined;

  return (
    <div className="flex flex-col gap-3">
      <label
        htmlFor={inputId}
        className="font-mono text-label uppercase text-text-muted"
      >
        {label}
      </label>
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx(
          fieldClasses,
          error ? 'border-accent-spend' : 'border-rule',
          className,
        )}
        {...rest}
      />
      {hint ? (
        <p id={hintId} className="font-body text-row-sub text-text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p
          id={errorId}
          // Announced when validation flips it on mid-session; `polite` rather
          // than `assertive` so it never interrupts the user mid-keystroke.
          aria-live="polite"
          className="font-body text-row-sub text-accent-spend"
        >
          {error}
        </p>
      ) : null}
    </div>
  );
}
