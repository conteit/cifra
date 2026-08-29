import { type ReactNode, useEffect, useId, useRef } from 'react';

import { cx, focusRing } from './cx';

export interface ModalProps {
  open: boolean;
  /**
   * Called for every route out of the modal: the close button, `Escape`, a
   * backdrop click, and any native `close` we did not initiate. The parent
   * owns `open` — the modal never closes itself behind the state's back.
   */
  onClose: () => void;
  /** Rendered as the dialog's heading and wired to `aria-labelledby`. */
  title: string;
  /** Accessible name of the close button, e.g. `strings.modal_close`. */
  closeLabel: string;
  /** Optional supporting line, wired to `aria-describedby`. */
  description?: string;
  /**
   * `false` removes every implicit exit — no `Escape`, no backdrop click, no
   * close button — for the rare flow that must be resolved through its own
   * actions. Default `true`.
   */
  dismissible?: boolean;
  /** Action row pinned under the content, above the panel's bottom edge. */
  footer?: ReactNode;
  children: ReactNode;
  /** Lands on the panel, for the occasional wider or taller dialog. */
  className?: string;
}

/**
 * A modal dialog built on the native `<dialog>` element.
 *
 * `showModal()` is the browser's own implementation of everything that makes
 * modality hard, and it is specified rather than approximated: the dialog
 * enters the top layer (so stacking never needs a portal or a z-index token),
 * the rest of the document becomes inert (a real focus trap, including the
 * browser chrome loop that JS traps famously miss), focus is restored to the
 * previously focused element on close, and `Escape` fires `cancel`. Hand-
 * rolling those is the classic source of subtle a11y bugs; taking a
 * dependency to get them is unnecessary weight for four primitives.
 *
 * What is *not* free and is implemented here: React state synchronisation,
 * deterministic body scroll lock, backdrop-click dismissal, and the
 * `dismissible={false}` escape hatch.
 */
export function Modal({
  open,
  onClose,
  title,
  closeLabel,
  description,
  dismissible = true,
  footer,
  children,
  className,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // True while *we* are closing the dialog because `open` went false, so the
  // resulting native `close` event does not bounce back into `onClose`.
  const closingRef = useRef(false);
  // Records whether the pointer went down on the backdrop, so a drag that
  // starts inside the panel and ends outside it does not dismiss.
  const pressedBackdropRef = useRef(false);

  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      closingRef.current = true;
      dialog.close();
    }
  }, [open]);

  // Scroll lock. `showModal()` already blocks scrolling in current browsers,
  // but it is not something the spec guarantees for the document element, so
  // pin it explicitly and restore the previous inline value on close.
  useEffect(() => {
    if (!open) return;
    const { body } = document;
    const previous = body.style.overflow;
    body.style.overflow = 'hidden';
    return () => {
      body.style.overflow = previous;
    };
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onKeyDown={(event) => {
        // Escape is handled here rather than left to the browser's own close
        // request. Two reasons: React state must stay the single source of
        // truth for `open`, and the UA path fires only for real key input, so
        // leaving it implicit would make the most important keyboard exit in
        // the app impossible to assert in a test. `preventDefault` suppresses
        // the UA's close request so the two paths cannot both run.
        if (event.key !== 'Escape') return;
        event.preventDefault();
        if (dismissible) onClose();
      }}
      onCancel={(event) => {
        // Backstop for close requests that do not arrive as a keydown on the
        // dialog. Same contract: cancel the UA close, re-enter through onClose.
        event.preventDefault();
        if (dismissible) onClose();
      }}
      onClose={() => {
        if (closingRef.current) {
          closingRef.current = false;
          return;
        }
        onClose();
      }}
      onPointerDown={(event) => {
        pressedBackdropRef.current = event.target === dialogRef.current;
      }}
      onClick={(event) => {
        if (!dismissible) return;
        if (!pressedBackdropRef.current) return;
        if (event.target !== dialogRef.current) return;
        onClose();
      }}
      className={cx(
        // The dialog element *is* the backdrop hit area: it fills the viewport,
        // paints nothing itself, and centres the panel. `open:flex` is required
        // because a bare `flex` would defeat the UA's `display: none` on a
        // closed dialog.
        'fixed inset-0 m-0 h-full max-h-full w-full max-w-full',
        'overflow-y-auto bg-transparent p-8',
        'open:flex open:items-center open:justify-center',
        'backdrop:bg-scrim',
      )}
    >
      {/* The panel. Deliberately not `Card`: the dialog panel is unpadded (its
          regions own their own padding) and uses the sheet radius, so composing
          `Card` here would mean fighting its defaults with overrides. */}
      <div
        className={cx(
          'w-full max-w-dialog rounded-sheet border border-rule bg-surface-card shadow-float',
          className,
        )}
      >
        <div className="flex items-start justify-between gap-6 px-10 pt-9">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="font-display text-title text-text-primary"
            >
              {title}
            </h2>
            {description ? (
              <p
                id={descriptionId}
                className="mt-3 font-body text-body text-text-secondary"
              >
                {description}
              </p>
            ) : null}
          </div>
          {dismissible ? (
            <button
              type="button"
              aria-label={closeLabel}
              onClick={onClose}
              className={cx(
                'shrink-0 rounded-control p-3 text-text-muted transition-colors',
                'hover:bg-surface-inset hover:text-text-primary',
                focusRing,
              )}
            >
              <svg
                aria-hidden="true"
                viewBox="0 0 16 16"
                className="h-8 w-8 stroke-current"
                fill="none"
                strokeWidth="1.25"
                strokeLinecap="round"
              >
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          ) : null}
        </div>

        <div className="px-10 py-8 font-body text-body text-text-secondary">
          {children}
        </div>

        {footer ? (
          <div className="flex flex-wrap justify-end gap-4 border-t border-rule-soft px-10 py-8">
            {footer}
          </div>
        ) : null}
      </div>
    </dialog>
  );
}
