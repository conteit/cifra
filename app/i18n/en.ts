export const en = {
  // App identity
  tagline_line1: 'Your money,',
  tagline_line2: 'ciphered.',

  // Sign-in screen
  signin_title: 'Welcome',
  signin_sub: 'Sign in to unlock your private personal finance.',
  signin_feat1_title: 'End-to-end encryption',
  signin_feat1_body: 'Your data is encrypted on device -- no one can read it.',
  signin_feat2_title: 'AI with your Google account',
  signin_feat2_body: 'Receipt scanning and auto-categorisation, on your quota.',
  signin_feat3_title: 'Cross-device sync',
  signin_feat3_body:
    'Encrypted blobs in transit -- the server only ever sees ciphertext.',
  signin_btn: 'Continue with Google',
  signing_in: 'Signing in...',
  signin_note: 'Requires Gemini API permission for AI features',

  // Setup wizard — Vault creation
  setup_vault_title: 'Creating vault',
  vault_step1: 'AES-256 key generated',
  vault_step1_sub: 'On-device -- never transmitted in plaintext',
  vault_step2: 'Key bound to account',
  vault_step2_sub: 'Google UID + device secret (PBKDF2, 100k iterations)',
  vault_step3: 'Encrypted namespace initialised',
  vault_step3_sub: 'Isolated storage for your account',

  // Buttons
  continue_btn: 'Continue',
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
