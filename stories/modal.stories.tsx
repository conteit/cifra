import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';

import { Button } from '../app/ui/button';
import { Modal } from '../app/ui/modal';
import { type Bilingual, type Locale, localeFrom, t } from './locale';

/* ═══════════════════════════════════════════════════════════════════════════
   Modal — a native <dialog> opened with showModal().

   The a11y contract the play functions below hold the component to:
     · the dialog is genuinely modal (`:modal`) — the browser's own focus trap
       and inertness, not a JS approximation;
     · it exposes the `dialog` role with an accessible name from its title;
     · Escape dismisses and returns focus to whatever opened it;
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
} satisfies Record<string, Bilingual>;

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

type DemoProps = {
  locale: Locale;
  initiallyOpen?: boolean;
  dismissible?: boolean;
  withFooter?: boolean;
  longContent?: boolean;
  onClose?: () => void;
};

function ModalDemo({
  locale,
  initiallyOpen = true,
  dismissible = true,
  withFooter = true,
  longContent = false,
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

    // The scrim is painted from a token, not from a transparent default: if
    // ::backdrop ever stops resolving --color-scrim this goes see-through and
    // the assertion fails.
    const backdrop = getComputedStyle(dialog, '::backdrop').backgroundColor;
    await expect(backdrop).not.toBe('rgba(0, 0, 0, 0)');
    await expect(backdrop).not.toBe('transparent');
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
