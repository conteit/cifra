export const en = {
  // App identity
  tagline_line1: 'Your money,',
  tagline_line2: 'ciphered.',

  // Sign-in screen
  signin_title: 'Welcome',
  signin_sub: 'Sign in to unlock your private personal finance.',
  signin_feat1_title: 'End-to-end encryption',
  signin_feat1_body: 'Your data is encrypted on device -- no one can read it.',
  signin_feat2_title: 'Only you hold the key',
  signin_feat2_body:
    'Your master password opens the vault. Cifra cannot reset it for you.',
  signin_feat3_title: 'Cross-device sync',
  signin_feat3_body:
    'Encrypted blobs in transit -- the server only ever sees ciphertext.',
  signin_btn: 'Continue with Google',
  signing_in: 'Signing in...',
  signin_note: 'Google identifies you. It never unlocks your data.',

  // Sign-in — auth unavailable. No VITE_FIREBASE_* and no emulator is a real
  // state a user can land in, not just a developer's mistake.
  signin_unavailable_title: 'Sign-in is unavailable',
  signin_unavailable_body:
    'This build has no identity provider configured, so there is nothing to sign in to. Nothing on this device has been touched.',
  signin_unavailable_hint: 'Reload the page once the app is configured.',

  // Sign-in failures, one line per AuthErrorCode. The session store surfaces a
  // code; the copy lives here, never in the store.
  auth_error_popup_closed: 'The Google window closed before sign-in finished.',
  auth_error_popup_blocked:
    'Your browser blocked the Google window. Allow popups for this site, then try again.',
  auth_error_cancelled: 'That sign-in was cancelled.',
  auth_error_network:
    'Could not reach Google. Check your connection and try again.',
  auth_error_account_exists:
    'That email is already linked to a different sign-in method.',
  auth_error_unauthorized_domain:
    'This address is not on the sign-in allowlist for this app.',
  auth_error_operation_not_allowed:
    'Google sign-in is not enabled for this app.',
  auth_error_user_disabled: 'That account has been disabled.',
  auth_error_too_many_requests:
    'Too many attempts. Wait a moment and try again.',
  auth_error_configuration: 'Sign-in is not configured in this build.',
  auth_error_storage_unsupported:
    'Your browser is blocking the storage sign-in needs. Leave private browsing or allow site data.',
  auth_error_unknown: 'Something went wrong signing in. Try again.',

  // Setup wizard — Vault creation
  setup_vault_title: 'Creating vault',
  vault_step1: 'AES-256 key generated',
  vault_step1_sub: 'On-device -- never transmitted in plaintext',
  vault_step2: 'Master key derived from your password',
  vault_step2_sub:
    'Argon2id on this device -- the password is never sent anywhere',
  vault_step3: 'Encrypted namespace initialised',
  vault_step3_sub: 'Isolated storage for your account',

  // Setup wizard — choosing the master password
  setup_password_title: 'Choose your master password',
  setup_password_sub:
    'It encrypts everything on this device. Cifra never sees it and cannot reset it.',
  setup_password_label: 'Master password',
  setup_password_hint:
    'At least 12 characters. A phrase you can remember beats a short jumble.',
  setup_password_confirm_label: 'Repeat master password',
  setup_password_too_short: 'Use at least 12 characters.',
  setup_password_mismatch: 'The two passwords do not match.',
  setup_password_warning:
    'If you forget it, only your recovery phrase can open this vault.',

  // Setup wizard — while the key is being derived. Three honest states, no
  // percentage: hash-wasm exposes no progress hook (D22).
  setup_creating_sub:
    'Deriving your key on this device. On a phone this takes a moment.',
  vault_busy_starting: 'Preparing...',
  vault_busy_deriving: 'Deriving your key...',

  // Setup wizard — the recovery phrase, shown exactly once (D26)
  setup_recovery_title: 'Write down your recovery phrase',
  setup_recovery_sub:
    'These 32 characters are the only other way into your vault. They are shown once and can never be shown again.',
  setup_recovery_warning:
    'Lose both your master password and this phrase and the data is gone for good. Nobody can recover it -- not Cifra, not Google.',
  setup_recovery_ack: 'I have written the phrase down somewhere safe.',
  recovery_phrase_label: 'Recovery phrase',

  // Setup wizard — typing the phrase back
  setup_confirm_title: 'Type the phrase back',
  setup_confirm_sub:
    'This checks that the copy you wrote down is the one that works. Spaces and capitals do not matter.',
  setup_confirm_mismatch:
    'That does not match the phrase above. Check what you wrote down.',

  // Setup wizard — done
  setup_done_title: 'Your vault is ready',
  setup_done_body:
    'Everything you add from here is encrypted on this device before it is stored.',

  // Unlock screen
  unlock_title: 'Unlock your vault',
  unlock_sub: 'Your master password decrypts this device.',
  unlock_idle_sub:
    'Locked after 30 minutes without activity. Your master password decrypts this device.',
  unlock_password_label: 'Master password',
  unlock_btn: 'Unlock',
  unlocking: 'Unlocking...',
  unlock_use_recovery: 'Use your recovery phrase',
  unlock_use_password: 'Use your master password',
  unlock_recovery_title: 'Unlock with your recovery phrase',
  unlock_recovery_sub: 'The 32 characters you wrote down when you set up.',
  unlock_error_vault_exists:
    'This device already holds a vault. Unlock it below.',
  unlock_error_secret_rejected: 'That does not open this vault.',
  unlock_error_phrase_malformed:
    'That is not a recovery phrase. It is 32 characters, in 8 groups of 4.',
  unlock_error_password_malformed:
    'Enter your master password — it cannot be empty or longer than 1024 characters.',
  unlock_error_record_invalid:
    'This vault record cannot be read. Restore from a backup.',
  unlock_error_environment:
    'Your browser could not run the unlock. Reload the page and try again.',

  // Buttons
  continue_btn: 'Continue',
  back_btn: 'Back',
  identity_lock: 'Lock',
  signout_btn: 'Sign out',
  create_vault_btn: 'Create my vault',
  creating_btn: 'Creating...',
  continue_overview: 'Continue to overview',

  // Dialog chrome — copy the Modal primitive needs but cannot resolve itself
  // (a primitive has no locale; pages pass it in).
  modal_close: 'Close',

  // Navigation
  nav_overview: 'Overview',
  nav_transactions: 'Transactions',
  nav_track: 'Add',
  nav_wallet: 'Cash',
  nav_goals: 'Goals',
  nav_import: 'Import',
  nav_account: 'Account',

  // App shell chrome — copy the shell needs but cannot resolve itself
  // (like the primitives, the shell has no locale; the route passes it in).
  shell_nav_label: 'Main navigation',
  shell_skip_to_content: 'Skip to content',
  shell_more: 'More',
  shell_soon: 'Soon',

  // Install prompt — the app's own PWA install affordance (FOUN-06, D25).
  // `install_ios_body` is the iOS/iPadOS variant: WebKit never fires
  // `beforeinstallprompt`, so there is nothing to press and the copy names the
  // browser's own command instead.
  install_title: 'Install Cifra',
  install_body:
    'Add Cifra to your home screen. It opens like an app and keeps working offline.',
  install_ios_body:
    'Add Cifra to your home screen: open the Share menu, then choose "Add to Home Screen".',
  install_action: 'Install',
  install_dismiss: 'Not now',

  // Sync states
  sync_synced: 'Synced',
  sync_dirty: 'Saving...',
  sync_syncing: 'Syncing...',
  sync_offline: 'Offline',
  sync_error: 'Sync error',

  // Status badges
  badge_reconciled: '✓ Reconciled',
  badge_tracked: '● Tracked',
  badge_planned: '◌ Planned',
  badge_cash: '♦ Cash',

  // Overview — welcome/empty state
  welcome_heading: 'Your finances, ready to begin',
  welcome_body:
    'Start by importing a bank statement or adding your first expense. Everything stays encrypted on your device.',
  welcome_hint1: 'Import your bank statement',
  welcome_hint2: 'Add your first expense',

  // Overview page
  overview_income: 'Income',
  overview_bank_spend: 'Bank spend',
  overview_cash_spend: 'Cash spend',
  overview_net: 'Net balance',
  overview_surplus_label: 'Distributable surplus · March',
  overview_surplus_formula: 'INCOME − BANK − CASH − PLANNED',

  // Account page
  account_title: 'Account',
  account_profile: 'Profile',
  account_language: 'Language',
  account_language_label: 'App language',
  account_signout: 'Sign out of Cifra',
  account_signout_note:
    'Clears master key from memory. Cloud blobs remain until 30-day TTL.',
  account_section_language: 'Language',
  account_section_sync: 'Sync & Devices',
  account_sync_relay: 'Relay (default)',
  account_sync_p2p: 'Direct (P2P)',
  account_sync_local: 'Local only',
  account_devices_add: 'Add device (QR pairing)',
  account_vault_export: 'Export encrypted backup',
  account_delete: 'Delete all data',
  account_pwa_install: 'Install app',
  account_last_sync: (d: string) => `Last sync: ${d}`,

  // Banners
  offline_banner: "You're offline -- changes saved locally",
  update_available: 'A new version is available',
  update_now: 'Update now',

  // Error states
  error_auth_heading: 'Sign-in failed',
  error_auth_body: 'Something went wrong signing in. Try again.',
  error_vault: 'Vault creation failed. Your data is safe -- try again.',
  error_generic: 'Something went wrong. Reload the page to continue.',

  // Import page
  import_title: 'Import transactions',
  import_drop_title: 'Drop your bank report here',
  import_preview_title: (n: number) => `Preview — ${n} transactions found`,
  import_confirm_btn: (n: number) => `Import ${n} transactions`,
  import_success: (n: number) => `${n} transactions imported successfully`,
  import_ai_needed: 'PDF import requires AI...',

  // Import wizard
  import_step_file: 'File',
  import_step_profile: 'Profile',
  import_step_map: 'Map',
  import_step_preview: 'Preview',
  import_drop_sub: 'or browse files',
  import_drop_formats: 'Accepts .csv, .xlsx, .xls',
  import_profile_heading: 'Select bank profile',
  import_custom_option: 'Custom column mapping',
  import_col_date: 'Date column',
  import_col_desc: 'Description column',
  import_col_amount: 'Amount column',
  import_col_type: 'Type column (optional)',
  import_date_format: 'Date format',
  import_amount_sign: 'Amount sign',
  import_sign_standard: 'Standard (negative = debit)',
  import_sign_inverted: 'Inverted (positive = debit)',
  import_encoding: (enc: string) => `Encoding: ${enc}`,
  import_encoding_warning: 'Text may be garbled. Try a different encoding.',
  import_preview_new: (n: number) => `${n} new`,
  import_preview_dupes: (n: number) => `${n} duplicates skipped`,
  import_dupes_toggle: (n: number) => `${n} duplicates (tap to view)`,
  import_back: 'Back',
  import_next: 'Next',
  import_parsing: 'Reading file...',
  import_importing: 'Importing...',
  import_success_body: 'All transactions stored in your encrypted vault.',
  import_save_prompt: 'Save this mapping as a profile?',
  import_profile_name: 'Profile name',
  import_save_btn: 'Save profile',
  import_skip_btn: 'Skip',
  import_view_txns: 'View transactions',

  // Transactions page
  txn_title: 'Transactions',
  txn_import_btn: 'Import statement',
  txn_col_date: 'Date',
  txn_col_desc: 'Description',
  txn_col_amount: 'Amount',
  txn_history_heading: 'Import history',
  txn_history_empty: 'No imports yet',
  txn_empty_heading: 'No transactions yet',
  txn_empty_body: 'Import a bank statement to see your transactions here.',
  txn_empty_cta: 'Import bank statement',

  // Import error states
  import_error_parse_heading: 'Could not read file',
  import_error_parse_body:
    'The file format is not supported or the file is corrupted. Try a different file.',
  import_error_empty: 'This file contains no data rows.',
  import_error_mapping:
    'Some required columns are not mapped. Select a column for each required field.',
  import_error_failed_heading: 'Import failed',
  import_error_failed_body:
    'Something went wrong saving transactions. Your existing data is safe. Try again.',

  // Goals page
  goals_strategy_weighted: 'Weighted',
  goals_strategy_priority: 'Priority',
  goals_strategy_equal: 'Equal',
  goals_strategy_deadline: 'Deadline',
  goals_on_track: 'On track',
  goals_at_risk: 'At risk',
  goals_deadline_label: (d: string) => `Deadline ${d}`,
  goals_saved_vs: (s: string) => `Saved vs avg: +${s}`,
} as const;

/**
 * The copy contract both locales satisfy.
 *
 * `en` above is `as const`, so `typeof en` carries the English *literals* —
 * useless as a shape for another locale. This mapped type widens every text
 * key to `string` while keeping each interpolator's exact signature, so:
 *
 *   · `app/i18n/it.ts` is declared `const it: Strings` and a missing key, an
 *     extra key, or a plain string where an interpolator belongs is a
 *     compile error rather than something the parity test has to catch;
 *   · either table can be handed to a component whose copy prop asks for
 *     `string` values (`ShellStrings`), which is what lets
 *     `stringsFor(locale)` have one return type.
 */
export type Strings = {
  readonly [K in keyof typeof en]: (typeof en)[K] extends string
    ? string
    : (typeof en)[K];
};
