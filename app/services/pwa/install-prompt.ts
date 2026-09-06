/**
 * The install-prompt port — FOUN-06's second half.
 *
 * The manifest already makes the app installable through browser chrome; what
 * was missing is the app's own affordance. This module owns every part of that
 * which is *not* React: capturing `beforeinstallprompt` before the browser
 * shows its own mini-infobar, knowing whether the app is already installed,
 * knowing that the event is never coming, and remembering a dismissal.
 *
 * ## Three outcomes, not two
 *
 * `beforeinstallprompt` is a Chromium extension to the platform. It is not in
 * any standard, and **WebKit on iOS/iPadOS never fires it** — on iOS the only
 * way to install a web app is the browser's own Share menu. So a design that
 * only knows "prompt available" and "nothing" would leave every iPhone user
 * with no affordance at all, on the one platform where the install path is
 * least discoverable. Hence {@link InstallAffordance} has three values, and
 * iOS gets `guidance`: the same strip of paper, carrying the two-step
 * instruction instead of a button. See D24 in `docs/architecture.md`.
 *
 * ## No React, no globals
 *
 * Per the layer contract a service never imports React, and per the pattern
 * `app/stores/locale.ts` set, a module must not read the environment merely by
 * being imported. The environment is therefore a *parameter*
 * ({@link InstallPromptEnvironment}, which the real `Window` satisfies
 * structurally), which is also what lets `test/unit/pwa/install-prompt.test.ts`
 * drive every branch in Node with no DOM at all.
 */

/**
 * What the shell should show.
 *
 * · `available` — a captured `beforeinstallprompt` is held and can be fired.
 * · `guidance`  — no event will ever arrive (iOS/iPadOS WebKit), so the user
 *                 is told where the browser's own install command lives.
 * · `hidden`    — already installed, dismissed, or a browser that neither
 *                 fires the event nor has an install path worth naming.
 */
export type InstallAffordance = 'available' | 'guidance' | 'hidden';

/**
 * The Chromium-only event. Declared here rather than pulled from a global
 * type: `lib.dom` does not ship it, and a repo-wide `declare global` would
 * assert to every other module that the event exists on every platform, which
 * is precisely the assumption this module exists to disprove.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * The slice of `Window` this port uses. `navigator.standalone` is Safari's
 * non-standard "launched from the home screen" flag and is optional here, so
 * the real `Navigator` — which does not declare it — still satisfies the type.
 */
export interface InstallPromptEnvironment {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
  matchMedia(query: string): { readonly matches: boolean };
  readonly navigator: {
    readonly userAgent: string;
    readonly maxTouchPoints: number;
    readonly standalone?: boolean;
  };
  /** Absent, or throwing on access, wherever site data is blocked. */
  readonly localStorage?: {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
  };
}

export interface InstallPromptController {
  /** The affordance to render right now. */
  getState(): InstallAffordance;
  /** Subscribes to state changes; returns the unsubscribe. */
  subscribe(listener: () => void): () => void;
  /**
   * Fires the captured browser prompt. A no-op in any state but `available` —
   * the event may only be used once, and using it needs a user gesture.
   */
  install(): Promise<void>;
  /** Hides the affordance on this device, persistently. */
  dismiss(): void;
  /** Detaches the window listeners. */
  dispose(): void;
}

/**
 * Where a dismissal is remembered.
 *
 * A dismissal has to outlive the tab, or the strip returns on every load and
 * becomes the nag the platform's own mini-infobar was suppressed to avoid.
 * `localStorage` is the right store for it and only for it: this key holds a
 * UI preference, never financial data, so it is outside the crypto boundary by
 * construction (`docs/architecture.md` §Crypto and data layer).
 */
export const INSTALL_DISMISSED_KEY = 'cifra.install-prompt.dismissed';

/** `true` when the document is running as an installed app rather than a tab. */
function isInstalled(env: InstallPromptEnvironment): boolean {
  // iOS/iPadOS: the display-mode media query is unreliable on older WebKit,
  // and this flag is what Safari has always set.
  if (env.navigator.standalone === true) return true;
  try {
    return env.matchMedia('(display-mode: standalone)').matches;
  } catch {
    // `matchMedia` with an unparseable query, or no media support at all.
    return false;
  }
}

/**
 * `true` on iOS/iPadOS, where every browser is WebKit and none of them fires
 * `beforeinstallprompt`, but all of them offer Share → Add to Home Screen.
 *
 * iPadOS 13+ reports a desktop macOS user agent, so the iPad is identified the
 * way the platform itself recommends: a "Macintosh" that reports touch points.
 * A Mac reports `maxTouchPoints === 0`, including a Mac with a touch display
 * attached, because the value describes the screen the page is on.
 */
function isIosWebKit(env: InstallPromptEnvironment): boolean {
  const ua = env.navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua)) return true;
  return /Macintosh/.test(ua) && env.navigator.maxTouchPoints > 1;
}

function readDismissed(env: InstallPromptEnvironment): boolean {
  try {
    return env.localStorage?.getItem(INSTALL_DISMISSED_KEY) === 'true';
  } catch {
    // Private mode, blocked site data, or a browser that throws on the very
    // property access. A forgotten dismissal is a strip shown once more; a
    // thrown exception here would take the whole shell down.
    return false;
  }
}

function writeDismissed(env: InstallPromptEnvironment): void {
  try {
    env.localStorage?.setItem(INSTALL_DISMISSED_KEY, 'true');
  } catch {
    // Quota, or blocked site data. The dismissal still holds for this session
    // because it is held in memory below; only its persistence is lost.
  }
}

/**
 * Wires an install-prompt controller onto an environment.
 *
 * Construction has to happen early: `beforeinstallprompt` is dispatched once
 * and is not replayed for a listener that attaches afterwards. In this app
 * that is safe by construction — Chromium only raises the event once a service
 * worker with a fetch handler is in place, and `app/root.tsx` registers the
 * worker from an effect *after* React mounts, so the first render (which is
 * what builds this controller, via `useInstallPrompt`) always precedes it.
 */
export function createInstallPromptController(
  env: InstallPromptEnvironment,
): InstallPromptController {
  let deferred: BeforeInstallPromptEvent | undefined;
  let installed = isInstalled(env);
  let dismissed = readDismissed(env);
  const iosWebKit = isIosWebKit(env);
  const listeners = new Set<() => void>();

  function emit(): void {
    for (const listener of listeners) listener();
  }

  function onBeforeInstallPrompt(event: Event): void {
    // Preventing the default is what suppresses Chromium's own mini-infobar
    // and hands the timing to the app. Without it the browser shows its banner
    // *and* we show ours.
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    emit();
  }

  function onAppInstalled(): void {
    installed = true;
    deferred = undefined;
    emit();
  }

  env.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  env.addEventListener('appinstalled', onAppInstalled);

  function getState(): InstallAffordance {
    if (installed || dismissed) return 'hidden';
    if (deferred !== undefined) return 'available';
    return iosWebKit ? 'guidance' : 'hidden';
  }

  return {
    getState,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    async install() {
      const event = deferred;
      if (event === undefined) return;
      // Spent either way: the spec allows one `prompt()` per event, and a
      // declined prompt is re-offered by the browser firing a fresh event
      // later, not by us re-using this one.
      deferred = undefined;
      emit();
      try {
        await event.prompt();
        await event.userChoice;
      } catch {
        // A prompt outside a user gesture, or an event already consumed. The
        // affordance is already gone; there is nothing to tell the user that
        // the browser has not told them itself.
      }
    },

    dismiss() {
      dismissed = true;
      writeDismissed(env);
      emit();
    },

    dispose() {
      env.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
      env.removeEventListener('appinstalled', onAppInstalled);
      listeners.clear();
    },
  };
}
