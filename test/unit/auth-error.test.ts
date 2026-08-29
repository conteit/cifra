import { describe, expect, it } from 'vitest';

import {
  AuthConfigurationError,
  mapAuthErrorCode,
} from '../../app/services/auth/auth-error';

describe('mapAuthErrorCode', () => {
  it.each([
    ['auth/popup-closed-by-user', 'popup-closed'],
    ['auth/user-cancelled', 'popup-closed'],
    ['auth/popup-blocked', 'popup-blocked'],
    ['auth/cancelled-popup-request', 'cancelled'],
    ['auth/network-request-failed', 'network'],
    [
      'auth/account-exists-with-different-credential',
      'account-exists-with-different-credential',
    ],
    ['auth/unauthorized-domain', 'unauthorized-domain'],
    ['auth/operation-not-allowed', 'operation-not-allowed'],
    ['auth/user-disabled', 'user-disabled'],
    ['auth/too-many-requests', 'too-many-requests'],
    ['auth/web-storage-unsupported', 'storage-unsupported'],
    ['auth/invalid-api-key', 'configuration'],
  ])('maps %s to %s', (raw, expected) => {
    expect(mapAuthErrorCode(Object.assign(new Error(raw), { code: raw }))).toBe(
      expected,
    );
  });

  it('matches Firebase codes that carry trailing detail', () => {
    expect(
      mapAuthErrorCode({
        code: 'auth/api-key-not-valid.-please-pass-a-valid-api-key.',
      }),
    ).toBe('configuration');
  });

  it('maps our own configuration error', () => {
    expect(mapAuthErrorCode(new AuthConfigurationError('missing'))).toBe(
      'configuration',
    );
  });

  it.each([
    ['a plain Error', new Error('boom')],
    ['null', null],
    ['undefined', undefined],
    ['a string', 'auth/popup-blocked'],
    ['an object with a non-string code', { code: 500 }],
    ['an unrecognised auth code', { code: 'auth/brand-new-failure' }],
  ])('falls back to unknown for %s', (_label, value) => {
    expect(mapAuthErrorCode(value)).toBe('unknown');
  });

  it('never throws, whatever it is handed', () => {
    const hostile = {
      get code() {
        throw new Error('nope');
      },
    };
    expect(mapAuthErrorCode(hostile)).toBe('unknown');
  });
});
