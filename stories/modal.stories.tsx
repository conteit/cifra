import type { Meta, StoryObj } from '@storybook/react-vite';
import { useId, useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';

import { Button } from '../app/ui/button';
import { cx, focusRing } from '../app/ui/cx';
import { Modal } from '../app/ui/modal';
import { type Bilingual, type Locale, localeFrom, t } from './locale';

/* ═══════════════════════════════════════════════════════════════════════════
   Modal — a native <dialog> opened with showModal().

   The a11y contract the play functions below hold the component to:
     · the dialog is genuinely modal (`:modal`) — the browser's own focus trap
       and inertness, not a JS approximation;
     · it exposes the `dialog` role with an accessible name from its title;
     · Escape dismisses and returns focus to whatever opened it;
     · a nested widget that claims Escape keeps it — the modal only acts on an
       Escape no descendant has already handled;
     · a backdrop click dismisses, a drag out of the panel does not;
     · the page behind cannot scroll while it is open;
     · `dismissible={false}` removes every implicit exit.
   ═══════════════════════════════════════════════════════════════════════════ */

const copy = {
  trigger: { en: 'Delete import', it: 'Elimina importazione' },
  title: { en: 'Delete this import?', it: 'Eliminare questa importazione?' },
  description: {
    en: 'The 128 transactions it added will be removed from your vault. This cannot be undone.',
    it: 'Le 128 transazioni aggiunte verranno rimosse dal tuo vault. L’operazione non è reversibile.',
  },
  body: {
    en: 'Nothing leaves this device either way — the vault is decrypted in your browser and re-encrypted before it is written back.',
    it: 'In ogni caso nulla lascia questo dispositivo — il vault viene decifrato nel browser e ricifrato prima di essere riscritto.',
  },
  cancel: { en: 'Keep it', it: 'Mantieni' },
  confirm: { en: 'Delete', it: 'Elimina' },
  blockingTitle: {
    en: 'Finish setting up your vault',
    it: 'Completa la configurazione del vault',
  },
  blockingBody: {
    en: 'Your key has been generated but not yet bound to this device. Choose an option to continue — this step cannot be skipped.',
    it: 'La tua chiave è stata generata ma non è ancora associata a questo dispositivo. Scegli un’opzione per continuare — questo passaggio non è saltabile.',
  },
  longBody: {
    en: 'A long dialog scrolls inside the viewport, not the page behind it.',
    it: 'Un dialogo lungo scorre dentro la viewport, non nella pagina dietro.',
  },
  pageHeading: { en: 'Transactions', it: 'Transazioni' },
  categoryLabel: { en: 'Category', it: 'Categoria' },
  categoryPlaceholder: { en: 'Choose a category', it: 'Scegli una categoria' },
  categoryHint: {
    en: 'Escape closes this list first; a second Escape closes the dialog.',
    it: 'Esc chiude prima questa lista; un secondo Esc chiude il dialogo.',
  },
} satisfies Record<string, Bilingual>;

/** Categories offered by the nested combobox. Invented, like every fixture. */
const categories = [
  { id: 'groceries', en: 'Groceries', it: 'Spesa' },
  { id: 'transport', en: 'Transport', it: 'Trasporti' },
  { id: 'utilities', en: 'Utilities', it: 'Utenze' },
] satisfies { id: string; en: string; it: string }[];

/** Stable keys for repeated filler copy — the list never reorders. */
function filler(count: number, prefix: string): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
}

/**
 * The page behind the dialog. Tall on purpose, so the scroll lock is a visible
 * behaviour and not just an assertion.
 */
function Page({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-surface-page p-10">
      <h1 className="font-display text-stat text-text-primary">
        {copy.pageHeading[locale]}
      </h1>
      <div className="mt-8">{children}</div>
      <div className="mt-10 flex flex-col gap-6">
        {filler(24, 'page-row').map((key) => (
          <p key={key} className="font-body text-body text-text-secondary">
            {t(locale, 'welcome_body')}
          </p>
        ))}
      </div>
    </div>
  );
}

/**
 * A nested popover of the shape Phase 2's import wizard and Phase 3's manual
 * entry will drop inside a dialog — a category picker, a date picker: a
 * trigger plus a panel that is expected to close itself on `Escape`.
 *
 * It claims the key the one way `Modal` recognises: `preventDefault()` on its
 * own `keydown`, while the panel is open. Focus stays on the trigger, so the
 * event starts there and the modal's handler — sitting at the top of the same
 * bubble path — sees `defaultPrevented` and leaves it alone.
 */
function CategoryPicker({ locale }: { locale: Locale }) {
  const [expanded, setExpanded] = useState(true);
  const [chosen, setChosen] = useState<string | null>(null);
  const id = useId();
  const labelId = `${id}-label`;
  const triggerId = `${id}-trigger`;
  const panelId = `${id}-panel`;

  return (
    <div className="mt-8 flex flex-col gap-3">
      <span
        id={labelId}
        className="font-mono text-label uppercase text-text-muted"
      >
        {copy.categoryLabel[locale]}
      </span>
      <button
        type="button"
        id={triggerId}
        aria-labelledby={`${labelId} ${triggerId}`}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((value) => !value)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || !expanded) return;
          // The contract with Modal: claim the key and the modal stands down.
          event.preventDefault();
          setExpanded(false);
        }}
        className={cx(
          'w-full rounded-control border border-rule bg-surface-card px-6 py-5',
          'text-left font-body text-row text-text-primary',
          focusRing,
        )}
      >
        {chosen ?? copy.categoryPlaceholder[locale]}
      </button>
      <div
        id={panelId}
        hidden={!expanded}
        className="flex flex-col gap-2 rounded-control border border-rule bg-surface-card p-3 shadow-float"
      >
        {categories.map((category) => (
          <button
            key={category.id}
            type="button"
            onClick={() => {
              setChosen(category[locale]);
              setExpanded(false);
            }}
            className={cx(
              'rounded-control px-5 py-4 text-left font-body text-row text-text-primary',
              'hover:bg-surface-inset',
              focusRing,
            )}
          >
            {category[locale]}
          </button>
        ))}
      </div>
      <p className="font-body text-row-sub text-text-muted">
        {copy.categoryHint[locale]}
      </p>
    </div>
  );
}

type DemoProps = {
  locale: Locale;
  initiallyOpen?: boolean;
  dismissible?: boolean;
  withFooter?: boolean;
  longContent?: boolean;
  /** Renders a popover inside the panel that owns `Escape` while it is open. */
  nestedPicker?: boolean;
  onClose?: () => void;
};

function ModalDemo({
  locale,
  initiallyOpen = true,
  dismissible = true,
  withFooter = true,
  longContent = false,
  nestedPicker = false,
  onClose,
}: DemoProps) {
  const [open, setOpen] = useState(initiallyOpen);

  const close = () => {
    setOpen(false);
    onClose?.();
  };

  return (
    <Page locale={locale}>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        {copy.trigger[locale]}
      </Button>
      <Modal
        open={open}
        onClose={close}
        title={dismissible ? copy.title[locale] : copy.blockingTitle[locale]}
        description={
          dismissible ? copy.description[locale] : copy.blockingBody[locale]
        }
        closeLabel={t(locale, 'modal_close')}
        dismissible={dismissible}
        footer={
          withFooter ? (
            <>
              <Button variant="secondary" onClick={close}>
                {copy.cancel[locale]}
              </Button>
              <Button variant="primary" onClick={close}>
                {copy.confirm[locale]}
              </Button>
            </>
          ) : undefined
        }
      >
        {longContent ? (
          <div className="flex flex-col gap-6">
            <p>{copy.longBody[locale]}</p>
            {filler(12, 'dialog-para').map((key) => (
              <p key={key}>{copy.body[locale]}</p>
            ))}
          </div>
        ) : (
          <p>{copy.body[locale]}</p>
        )}
        {nestedPicker ? <CategoryPicker locale={locale} /> : null}
      </Modal>
    </Page>
  );
}

// Annotated rather than `satisfies`: Modal's props are all required and every
// story drives it through the stateful `ModalDemo` harness, so pinning args on
// the meta would only be ceremony.
const meta: Meta<typeof Modal> = {
  title: 'UI/Modal',
  component: Modal,
  parameters: { layout: 'fullscreen' },
};

export default meta;

type Story = StoryObj<typeof Modal> & {
  /** Story-local `fn()` spies, asserted in `play`. */
  args?: { onClose?: () => void };
};

function dialogOf(canvasElement: HTMLElement): HTMLDialogElement {
  // The dialog lives in the top layer, still parented in the canvas DOM.
  const dialog = canvasElement.ownerDocument.querySelector('dialog');
  if (!dialog) throw new Error('no <dialog> rendered');
  return dialog;
}

/* ── Open, with the full a11y contract asserted ─────────────────────────── */

export const Open: Story = {
  render: (_args, ctx) => <ModalDemo locale={localeFrom(ctx.globals)} />,
  play: async ({ canvasElement, globals }) => {
    const locale = localeFrom(globals);
    const dialog = dialogOf(canvasElement);
    const doc = canvasElement.ownerDocument;

    // Modality — the browser's focus trap and inertness in one assertion. A
    // dialog opened with `show()` instead of `showModal()` fails right here.
    await expect(dialog.matches(':modal')).toBe(true);
    await expect(dialog.open).toBe(true);

    // Role and accessible name.
    const inDialog = within(dialog);
    await expect(dialog).toHaveAttribute('aria-labelledby');
    await expect(
      inDialog.getByRole('heading', { name: copy.title[locale] }),
    ).toBeInTheDocument();
    await expect(dialog).toHaveAccessibleName(copy.title[locale]);
    await expect(dialog).toHaveAccessibleDescription(copy.description[locale]);

    // Focus is inside the dialog on open.
    await expect(dialog.contains(doc.activeElement)).toBe(true);

    // Scroll lock.
    await expect(doc.body.style.overflow).toBe('hidden');

    // The scrim must be the `--color-scrim` token, not merely "something
    // opaque". Chromium's UA stylesheet already paints ::backdrop with its own
    // translucent black, so a "not transparent" assertion would pass with the
    // token rule deleted — this compares against the resolved token instead.
    // The probe normalises `rgb(28 28 26 / 0.45)` into the same `rgba(...)`
    // serialisation getComputedStyle returns.
    const probe = doc.createElement('div');
    probe.style.backgroundColor = 'var(--color-scrim)';
    doc.body.appendChild(probe);
    const expectedScrim = getComputedStyle(probe).backgroundColor;
    probe.remove();

    await expect(expectedScrim).not.toBe('rgba(0, 0, 0, 0)');
    await expect(getComputedStyle(dialog, '::backdrop').backgroundColor).toBe(
      expectedScrim,
    );
  },
};

export const OpenItalian: Story = {
  globals: { locale: 'it' },
  render: (_args, ctx) => <ModalDemo locale={localeFrom(ctx.globals)} />,
};

export const OpenMobile: Story = {
  globals: { viewport: { value: 'mobile' } },
  render: (_args, ctx) => <ModalDemo locale={localeFrom(ctx.globals)} />,
};

export const OpenMobileItalian: Story = {
  globals: { locale: 'it', viewport: { value: 'mobile' } },
  render: (_args, ctx) => <ModalDemo locale={localeFrom(ctx.globals)} />,
};

/* ── Closed: the trigger, and the dialog absent from the a11y tree ──────── */

export const Closed: Story = {
  render: (_args, ctx) => (
    <ModalDemo locale={localeFrom(ctx.globals)} initiallyOpen={false} />
  ),
  play: async ({ canvasElement }) => {
    const dialog = dialogOf(canvasElement);
    await expect(dialog.open).toBe(false);
    await expect(dialog.matches(':modal')).toBe(false);
    await expect(canvasElement.ownerDocument.body.style.overflow).not.toBe(
      'hidden',
    );
  },
};

/* ── Opening from the trigger, and focus restoration on close ───────────── */

export const OpensAndRestoresFocus: Story = {
  args: { onClose: fn() },
  render: (args, ctx) => (
    <ModalDemo
      locale={localeFrom(ctx.globals)}
      initiallyOpen={false}
      onClose={args.onClose}
    />
  ),
  play: async ({ canvasElement, globals }) => {
    const locale = localeFrom(globals);
    const canvas = within(canvasElement);
    const doc = canvasElement.ownerDocument;

    const trigger = canvas.getByRole('button', { name: copy.trigger[locale] });
    await userEvent.click(trigger);

    const dialog = dialogOf(canvasElement);
    await expect(dialog.matches(':modal')).toBe(true);

    await userEvent.click(
      within(dialog).getByRole('button', { name: copy.cancel[locale] }),
    );

    await expect(dialog.open).toBe(false);
    // The native dialog returns focus to the element that opened it.
    await expect(doc.activeElement).toBe(trigger);
    await expect(doc.body.style.overflow).not.toBe('hidden');
  },
};

/* ── Escape ─────────────────────────────────────────────────────────────── */

export const EscapeDismisses: Story = {
  args: { onClose: fn() },
  render: (args, ctx) => (
    <ModalDemo locale={localeFrom(ctx.globals)} onClose={args.onClose} />
  ),
  play: async ({ args, canvasElement }) => {
    const dialog = dialogOf(canvasElement);
    await expect(dialog.matches(':modal')).toBe(true);

    await userEvent.keyboard('{Escape}');

    await expect(args.onClose).toHaveBeenCalledOnce();
    await expect(dialog.open).toBe(false);
    await expect(canvasElement.ownerDocument.body.style.overflow).not.toBe(
      'hidden',
    );
  },
};

/**
 * Escape belongs to the innermost widget that wants it.
 *
 * `Modal` still handles Escape itself rather than leaving it to the UA's
 * `cancel` event — the UA path fires only for trusted key input, so it cannot
 * be asserted here — but it now stands down when the event arrives already
 * `defaultPrevented`. That keeps the whole behaviour reachable from a
 * synthetic `keydown`: this play function never needs real UA key input, and
 * `EscapeDismisses` above still proves the unclaimed case.
 */
export const NestedWidgetOwnsEscape: Story = {
  args: { onClose: fn() },
  render: (args, ctx) => (
    <ModalDemo
      locale={localeFrom(ctx.globals)}
      nestedPicker
      onClose={args.onClose}
    />
  ),
  play: async ({ args, canvasElement, globals }) => {
    const locale = localeFrom(globals);
    const dialog = dialogOf(canvasElement);
    const inDialog = within(dialog);

    const trigger = inDialog.getByRole('button', {
      name: new RegExp(copy.categoryLabel[locale], 'i'),
    });
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');

    // Focus the widget, so the keydown starts inside it and bubbles out
    // through the modal — the path a real combobox or date picker takes.
    await userEvent.click(trigger);
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await userEvent.click(trigger);
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(canvasElement.ownerDocument.activeElement).toBe(trigger);

    // The widget claims Escape: its panel closes, the dialog does not.
    await userEvent.keyboard('{Escape}');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(args.onClose).not.toHaveBeenCalled();
    await expect(dialog.open).toBe(true);
    await expect(dialog.matches(':modal')).toBe(true);

    // With nothing left to claim it, the next Escape reaches the modal — even
    // though focus is still on the nested trigger.
    await userEvent.keyboard('{Escape}');
    await expect(args.onClose).toHaveBeenCalledOnce();
    await expect(dialog.open).toBe(false);
  },
};

/* ── Backdrop ───────────────────────────────────────────────────────────── */

export const BackdropDismisses: Story = {
  args: { onClose: fn() },
  render: (args, ctx) => (
    <ModalDemo locale={localeFrom(ctx.globals)} onClose={args.onClose} />
  ),
  play: async ({ args, canvasElement }) => {
    const dialog = dialogOf(canvasElement);

    // A press that starts inside the panel and releases on the backdrop must
    // not dismiss — that is a text selection dragged out, not a dismissal.
    const panel = within(dialog).getByRole('heading');
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: panel },
      { keys: '[/MouseLeft]', target: dialog, coords: { x: 4, y: 4 } },
    ]);
    await expect(args.onClose).not.toHaveBeenCalled();
    await expect(dialog.open).toBe(true);

    // A press and release on the backdrop itself does.
    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: dialog, coords: { x: 4, y: 4 } },
      { keys: '[/MouseLeft]', target: dialog, coords: { x: 4, y: 4 } },
    ]);
    await expect(args.onClose).toHaveBeenCalledOnce();
    await expect(dialog.open).toBe(false);
  },
};

/* ── dismissible={false} ────────────────────────────────────────────────── */

export const NotDismissible: Story = {
  args: { onClose: fn() },
  render: (args, ctx) => (
    <ModalDemo
      locale={localeFrom(ctx.globals)}
      dismissible={false}
      onClose={args.onClose}
    />
  ),
  play: async ({ args, canvasElement, globals }) => {
    const locale = localeFrom(globals);
    const dialog = dialogOf(canvasElement);
    const inDialog = within(dialog);

    // No close affordance at all.
    await expect(
      inDialog.queryByRole('button', { name: t(locale, 'modal_close') }),
    ).toBeNull();

    await userEvent.keyboard('{Escape}');
    await expect(args.onClose).not.toHaveBeenCalled();
    await expect(dialog.open).toBe(true);

    await userEvent.pointer([
      { keys: '[MouseLeft>]', target: dialog, coords: { x: 4, y: 4 } },
      { keys: '[/MouseLeft]', target: dialog, coords: { x: 4, y: 4 } },
    ]);
    await expect(args.onClose).not.toHaveBeenCalled();
    await expect(dialog.open).toBe(true);

    // The footer actions are the only way out, and they still work.
    await userEvent.click(
      inDialog.getByRole('button', { name: copy.confirm[locale] }),
    );
    await expect(args.onClose).toHaveBeenCalledOnce();
  },
};

/* ── Content shapes ─────────────────────────────────────────────────────── */

export const WithoutFooter: Story = {
  render: (_args, ctx) => (
    <ModalDemo locale={localeFrom(ctx.globals)} withFooter={false} />
  ),
  play: async ({ canvasElement, globals }) => {
    const locale = localeFrom(globals);
    const dialog = dialogOf(canvasElement);
    // The close button is the only action left, and it is labelled in-locale.
    await expect(
      within(dialog).getByRole('button', { name: t(locale, 'modal_close') }),
    ).toBeInTheDocument();
  },
};

export const LongContent: Story = {
  render: (_args, ctx) => (
    <ModalDemo locale={localeFrom(ctx.globals)} longContent />
  ),
};

export const LongContentMobile: Story = {
  globals: { locale: 'it', viewport: { value: 'mobile' } },
  render: (_args, ctx) => (
    <ModalDemo locale={localeFrom(ctx.globals)} longContent />
  ),
};
