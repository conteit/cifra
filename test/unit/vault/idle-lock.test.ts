import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startIdleLock } from '../../../app/services/vault/idle-lock';

/**
 * The idle auto-lock (#10, FOUN-10): thirty minutes without user input drops
 * the data key, and so does leaving the page.
 *
 * Driven through a plain `EventTarget` and fake timers rather than a DOM: the
 * service reads nothing off the events except that they happened, and the
 * clock is the whole behaviour. `vi.setSystemTime` moves the wall clock
 * without running timers, which is exactly what a phone tab suspended in the
 * background looks like on resume.
 */

const MINUTE = 60_000;
const TIMEOUT = 30 * MINUTE;

function harness(visibility: 'visible' | 'hidden' = 'visible') {
  const target = new EventTarget();
  const onIdle = vi.fn();
  let visibilityState = visibility;
  const stop = startIdleLock({
    target,
    timeoutMs: TIMEOUT,
    visibilityState: () => visibilityState,
    onIdle,
  });
  return {
    onIdle,
    stop,
    fire: (type: string) => target.dispatchEvent(new Event(type)),
    show() {
      visibilityState = 'visible';
      target.dispatchEvent(new Event('visibilitychange'));
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the idle auto-lock', () => {
  it('fires once the timeout passes with no input', () => {
    const { onIdle } = harness();

    vi.advanceTimersByTime(TIMEOUT - MINUTE);
    expect(onIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2 * MINUTE);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('counts from the last input, not from the start', () => {
    const { onIdle, fire } = harness();

    vi.advanceTimersByTime(20 * MINUTE);
    fire('pointerdown');
    vi.advanceTimersByTime(20 * MINUTE);
    expect(onIdle).not.toHaveBeenCalled();

    vi.advanceTimersByTime(11 * MINUTE);
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('treats keys, touches, wheel and scroll as input too', () => {
    const { onIdle, fire } = harness();

    for (const type of ['keydown', 'touchstart', 'wheel', 'scroll']) {
      vi.advanceTimersByTime(25 * MINUTE);
      fire(type);
    }
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('fires on the way back to a tab whose timers never ran', () => {
    const { onIdle, show } = harness('hidden');

    // A suspended tab: the wall clock moves, the interval does not.
    vi.setSystemTime(Date.now() + TIMEOUT + MINUTE);
    expect(onIdle).not.toHaveBeenCalled();

    show();
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('does not fire on a return that is still inside the window', () => {
    const { onIdle, show } = harness('hidden');

    vi.setSystemTime(Date.now() + 10 * MINUTE);
    show();
    expect(onIdle).not.toHaveBeenCalled();
  });

  it('fires when the page is hidden for good', () => {
    const { onIdle, fire } = harness();

    fire('pagehide');
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('fires at most once, then stops watching', () => {
    const { onIdle, fire } = harness();

    vi.advanceTimersByTime(3 * TIMEOUT);
    fire('pagehide');
    expect(onIdle).toHaveBeenCalledTimes(1);
  });

  it('stops cleanly: no timer, no listener survives', () => {
    const { onIdle, fire, stop } = harness();

    stop();
    vi.advanceTimersByTime(2 * TIMEOUT);
    fire('pagehide');
    expect(onIdle).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
