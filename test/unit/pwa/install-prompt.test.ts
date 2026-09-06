import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  createInstallPromptController,
  INSTALL_DISMISSED_KEY,
  type InstallPromptEnvironment,
} from '../../../app/services/pwa/install-prompt';

/**
 * The install-prompt port's whole job is to answer one question — what, if
 * anything, should the shell offer — from three inputs that are awkward to
 * reach in a test: a Chromium-only event, a media query, and a UA string. The
 * port takes the environment as a parameter for exactly this reason, so every
 * branch is drivable here with no DOM at all (`unit` is a Node project).
 */

const CHROME_ANDROID =
  'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Mobile Safari/537.36';
const SAFARI_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const SAFARI_IPADOS =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const FIREFOX_DESKTOP =
  'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0';

interface FakeEnv extends InstallPromptEnvironment {
  /** Dispatches to whatever the controller registered for `type`. */
  fire(type: string, event?: Partial<Event>): void;
  readonly listenerCount: () => number;
  readonly store: Map<string, string>;
}

function fakeEnv(
  options: {
    userAgent?: string;
    maxTouchPoints?: number;
    standalone?: boolean;
    displayModeStandalone?: boolean;
    storage?: 'ok' | 'throws' | 'absent';
    seed?: Record<string, string>;
  } = {},
): FakeEnv {
  const {
    userAgent = CHROME_ANDROID,
    maxTouchPoints = 0,
    standalone,
    displayModeStandalone = false,
    storage = 'ok',
    seed = {},
  } = options;

  const listeners = new Map<string, Array<(event: Event) => void>>();
  const store = new Map<string, string>(Object.entries(seed));

  const localStorage =
    storage === 'absent'
      ? undefined
      : {
          getItem(key: string) {
            if (storage === 'throws') throw new Error('site data blocked');
            return store.get(key) ?? null;
          },
          setItem(key: string, value: string) {
            if (storage === 'throws') throw new Error('site data blocked');
            store.set(key, value);
          },
        };

  return {
    addEventListener(type, listener) {
      const bucket = listeners.get(type) ?? [];
      bucket.push(listener);
      listeners.set(type, bucket);
    },
    removeEventListener(type, listener) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((l) => l !== listener),
      );
    },
    matchMedia: (query: string) => ({
      matches: query.includes('standalone') && displayModeStandalone,
    }),
    navigator: { userAgent, maxTouchPoints, standalone },
    localStorage,
    fire(type, event = {}) {
      for (const listener of listeners.get(type) ?? []) {
        listener(event as Event);
      }
    },
    listenerCount: () =>
      [...listeners.values()].reduce((n, bucket) => n + bucket.length, 0),
    store,
  };
}

/** A stand-in for the Chromium-only `beforeinstallprompt` event. */
function fakePromptEvent(outcome: 'accepted' | 'dismissed' = 'accepted') {
  return {
    preventDefault: vi.fn(),
    prompt: vi.fn(async () => {}),
    userChoice: Promise.resolve({ outcome }),
  };
}

describe('install prompt controller', () => {
  let env: FakeEnv;

  beforeEach(() => {
    env = fakeEnv();
  });

  it('offers nothing until the browser says the app is installable', () => {
    expect(createInstallPromptController(env).getState()).toBe('hidden');
  });

  it('becomes available when beforeinstallprompt fires', () => {
    const controller = createInstallPromptController(env);
    const listener = vi.fn();
    controller.subscribe(listener);

    env.fire('beforeinstallprompt', fakePromptEvent() as unknown as Event);

    expect(controller.getState()).toBe('available');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("suppresses the browser's own mini-infobar", () => {
    const controller = createInstallPromptController(env);
    const event = fakePromptEvent();

    env.fire('beforeinstallprompt', event as unknown as Event);

    // Without preventDefault Chromium shows its banner as well as ours.
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toBe('available');
  });

  it('fires the captured prompt and then hides — an event is single-use', async () => {
    const controller = createInstallPromptController(env);
    const event = fakePromptEvent();
    env.fire('beforeinstallprompt', event as unknown as Event);

    await controller.install();

    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(controller.getState()).toBe('hidden');

    // Nothing left to fire: a declined install is re-offered by the browser
    // dispatching a fresh event, never by re-using this one.
    await controller.install();
    expect(event.prompt).toHaveBeenCalledTimes(1);
  });

  it('survives a prompt() that rejects', async () => {
    const controller = createInstallPromptController(env);
    const event = {
      ...fakePromptEvent(),
      prompt: vi.fn(async () => {
        throw new Error('must be called from a user gesture');
      }),
    };
    env.fire('beforeinstallprompt', event as unknown as Event);

    await expect(controller.install()).resolves.toBeUndefined();
    expect(controller.getState()).toBe('hidden');
  });

  it('hides once the app is installed', () => {
    const controller = createInstallPromptController(env);
    env.fire('beforeinstallprompt', fakePromptEvent() as unknown as Event);
    expect(controller.getState()).toBe('available');

    env.fire('appinstalled');

    expect(controller.getState()).toBe('hidden');
  });

  it('hides when the document is already running standalone', () => {
    const standalone = fakeEnv({ displayModeStandalone: true });
    const controller = createInstallPromptController(standalone);

    standalone.fire(
      'beforeinstallprompt',
      fakePromptEvent() as unknown as Event,
    );

    expect(controller.getState()).toBe('hidden');
  });

  it('hides on iOS when navigator.standalone reports an installed app', () => {
    const ios = fakeEnv({ userAgent: SAFARI_IPHONE, standalone: true });
    expect(createInstallPromptController(ios).getState()).toBe('hidden');
  });

  describe('iOS guidance (D25)', () => {
    it('offers guidance on iPhone, where beforeinstallprompt never fires', () => {
      const ios = fakeEnv({ userAgent: SAFARI_IPHONE });
      expect(createInstallPromptController(ios).getState()).toBe('guidance');
    });

    it('offers guidance on iPadOS, which reports a desktop macOS UA', () => {
      const ipad = fakeEnv({ userAgent: SAFARI_IPADOS, maxTouchPoints: 5 });
      expect(createInstallPromptController(ipad).getState()).toBe('guidance');
    });

    it('does not mistake a Mac for an iPad', () => {
      const mac = fakeEnv({ userAgent: SAFARI_IPADOS, maxTouchPoints: 0 });
      expect(createInstallPromptController(mac).getState()).toBe('hidden');
    });

    it('stays hidden on a browser that neither fires the event nor is WebKit', () => {
      const firefox = fakeEnv({ userAgent: FIREFOX_DESKTOP });
      expect(createInstallPromptController(firefox).getState()).toBe('hidden');
    });
  });

  describe('dismissal', () => {
    it('hides the affordance and remembers it', () => {
      const controller = createInstallPromptController(env);
      env.fire('beforeinstallprompt', fakePromptEvent() as unknown as Event);

      controller.dismiss();

      expect(controller.getState()).toBe('hidden');
      expect(env.store.get(INSTALL_DISMISSED_KEY)).toBe('true');
    });

    it('is honoured on the next load', () => {
      const remembered = fakeEnv({ seed: { [INSTALL_DISMISSED_KEY]: 'true' } });
      const controller = createInstallPromptController(remembered);

      remembered.fire(
        'beforeinstallprompt',
        fakePromptEvent() as unknown as Event,
      );

      expect(controller.getState()).toBe('hidden');
    });

    it('still hides for the session when storage is blocked', () => {
      const blocked = fakeEnv({ userAgent: SAFARI_IPHONE, storage: 'throws' });
      const controller = createInstallPromptController(blocked);
      expect(controller.getState()).toBe('guidance');

      controller.dismiss();

      expect(controller.getState()).toBe('hidden');
    });

    it('works where localStorage is absent entirely', () => {
      const none = fakeEnv({ userAgent: SAFARI_IPHONE, storage: 'absent' });
      const controller = createInstallPromptController(none);
      expect(controller.getState()).toBe('guidance');

      controller.dismiss();

      expect(controller.getState()).toBe('hidden');
    });
  });

  it('unsubscribes and disposes without leaking listeners', () => {
    const controller = createInstallPromptController(env);
    const listener = vi.fn();
    const unsubscribe = controller.subscribe(listener);

    unsubscribe();
    env.fire('beforeinstallprompt', fakePromptEvent() as unknown as Event);
    expect(listener).not.toHaveBeenCalled();

    controller.dispose();
    expect(env.listenerCount()).toBe(0);
  });
});
