import { describe, expect, it, vi } from 'vitest';
import { createVaultService } from '../../../app/services/vault/vault-service';
import { createVaultStore } from '../../../app/stores/vault';
import { wireIdleLock } from '../../../app/stores/vault-idle-lock';
import { keySink, memoryRecordStore, PASSWORD, workerOptions } from './support';

/**
 * The edge between the vault store and the idle watcher (#10): the watcher
 * runs exactly while a data key is held, and firing it locks the vault with
 * the reason the unlock screen reads. The watcher itself is a fake here — its
 * clock behaviour has its own suite — so this is purely about *when* it is
 * started and stopped.
 */

function harness() {
  const store = createVaultStore(
    createVaultService({
      records: memoryRecordStore(),
      keys: keySink(),
      options: workerOptions(),
    }),
  );
  const stop = vi.fn();
  let fire: (() => void) | null = null;
  const start = vi.fn((onIdle: () => void) => {
    fire = onIdle;
    return stop;
  });
  wireIdleLock(store, { start });
  return { store, start, stop, fire: () => fire?.() };
}

describe('wiring the idle lock to the vault', () => {
  it('watches only while the vault is open', async () => {
    const { store, start, stop } = harness();
    await store.getState().probe();
    expect(start).not.toHaveBeenCalled();

    await store.getState().create(PASSWORD);
    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();

    store.getState().lock('manual');
    expect(stop).toHaveBeenCalledTimes(1);

    await store.getState().unlock({ kind: 'password', password: PASSWORD });
    expect(start).toHaveBeenCalledTimes(2);
  });

  it('locks with the idle reason when the watcher fires', async () => {
    const { store, fire } = harness();
    await store.getState().create(PASSWORD);

    fire();

    expect(store.getState().status).toBe('locked');
    expect(store.getState().lockReason).toBe('idle');
  });

  it('does not restart the watcher on unrelated state changes', async () => {
    const { store, start } = harness();
    await store.getState().create(PASSWORD);
    store.getState().acknowledgeRecoveryPhrase();
    store.getState().clearError();
    expect(start).toHaveBeenCalledTimes(1);
  });
});
