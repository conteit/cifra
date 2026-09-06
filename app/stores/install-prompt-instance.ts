import {
  createInstallPromptController,
  type InstallAffordance,
  type InstallPromptController,
} from '../services/pwa/install-prompt';

/**
 * The composition root for the live install-prompt controller — the one place
 * the port meets the real `window`.
 *
 * Same shape and same reasoning as `session-instance.ts`: built lazily, so
 * importing this module reads nothing from the environment. That matters here
 * because `ssr: false` still prerenders the SPA shell in Node, where there is
 * no `window` to attach listeners to.
 */

/**
 * What the prerender (and any other windowless realm) gets: an affordance that
 * is permanently `hidden` and subscribes to nothing. Returned rather than
 * cached, so a realm that later *does* have a window is not stuck with it.
 */
const INERT: InstallPromptController = {
  getState: () => 'hidden' as InstallAffordance,
  subscribe: () => () => {},
  install: async () => {},
  dismiss: () => {},
  dispose: () => {},
};

let instance: InstallPromptController | undefined;

export function getInstallPromptController(): InstallPromptController {
  if (typeof window === 'undefined') return INERT;
  instance ??= createInstallPromptController(window);
  return instance;
}
