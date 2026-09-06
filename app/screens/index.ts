/**
 * The full-page screens the app renders around, rather than inside, the shell.
 *
 * They are presentational and controlled — status and copy in, callbacks out —
 * so every state is reachable from a story. `app/routes/gate.tsx` is the one
 * module that wires them to the session and vault stores.
 */
export {
  type AuthErrorStrings,
  authErrorMessage,
} from './auth-error-copy';
export {
  IdentityChip,
  type IdentityChipProps,
  type IdentityChipStrings,
} from './identity-chip';
export {
  ScreenError,
  ScreenFrame,
  type ScreenFrameProps,
  ScreenNotice,
} from './screen-frame';
export {
  SignInScreen,
  type SignInScreenProps,
  type SignInStatus,
  type SignInStrings,
} from './sign-in-screen';
export {
  type VaultErrorStrings,
  vaultErrorMessage,
} from './vault-error-copy';
export {
  MIN_MASTER_PASSWORD_LENGTH,
  VaultSetupScreen,
  type VaultSetupScreenProps,
  type VaultSetupStep,
  type VaultSetupStrings,
} from './vault-setup-screen';
export {
  VaultUnlockScreen,
  type VaultUnlockScreenProps,
  type VaultUnlockStrings,
} from './vault-unlock-screen';
