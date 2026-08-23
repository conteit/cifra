import type { en } from './en';

export type Strings = typeof en;

export const it: Record<
  keyof typeof en,
  string | ((...args: never[]) => string)
> = {
  // App identity
  tagline_line1: 'I tuoi soldi,',
  tagline_line2: 'cifrati.',

  // Sign-in screen
  signin_title: 'Benvenuto',
  signin_sub: 'Accedi per sbloccare la tua finanza personale privata.',
  signin_feat1_title: 'Crittografia end-to-end',
  signin_feat1_body:
    'I tuoi dati sono cifrati sul dispositivo -- nessuno puo leggerli.',
  signin_feat2_title: 'AI con il tuo account Google',
  signin_feat2_body:
    'Scansione scontrini e categorizzazione automatica, sulla tua quota.',
  signin_feat3_title: 'Sync tra dispositivi',
  signin_feat3_body:
    'Blob cifrati in transito -- il server vede solo testo incomprensibile.',
  signin_btn: 'Continua con Google',
  signing_in: 'Accesso in corso...',
  signin_note: 'Richiede il permesso Gemini API per le funzioni AI',

  // Setup wizard — Vault creation
  setup_vault_title: 'Creazione vault',
  vault_step1: 'Chiave AES-256 generata',
  vault_step1_sub: 'Sul dispositivo -- non trasmessa mai in chiaro',
  vault_step2: "Chiave vincolata all'account",
  vault_step2_sub: 'UID Google + secret dispositivo (PBKDF2, 100k iterazioni)',
  vault_step3: 'Namespace cifrato inizializzato',
  vault_step3_sub: 'Storage isolato per il tuo account',

  // Buttons
  continue_btn: 'Continua',
  create_vault_btn: 'Crea il mio vault',
  creating_btn: 'Creazione in corso...',
  continue_overview: 'Continua alla panoramica',

  // Navigation
  nav_overview: 'Panoramica',
  nav_transactions: 'Movimenti',
  nav_track: 'Aggiungi',
  nav_wallet: 'Contanti',
  nav_goals: 'Obiettivi',
  nav_import: 'Importa',
  nav_account: 'Account',

  // Sync states
  sync_synced: 'Sincronizzato',
  sync_dirty: 'Da salvare...',
  sync_syncing: 'Sincronizzazione...',
  sync_offline: 'Offline',
  sync_error: 'Errore sync',

  // Status badges
  badge_reconciled: '✓ Riconciliato',
  badge_tracked: '● Tracciato',
  badge_planned: '◌ Pianificato',
  badge_cash: '♦ Contante',

  // Overview — welcome/empty state
  welcome_heading: 'Le tue finanze, pronte a iniziare',
  welcome_body:
    'Inizia importando un estratto conto o aggiungendo la tua prima spesa. Tutto resta cifrato sul tuo dispositivo.',
  welcome_hint1: 'Importa il tuo estratto conto',
  welcome_hint2: 'Aggiungi la tua prima spesa',

  // Overview page
  overview_income: 'Entrate',
  overview_bank_spend: 'Uscite banca',
  overview_cash_spend: 'Uscite contanti',
  overview_net: 'Saldo netto',
  overview_surplus_label: 'Surplus distribuibile · Marzo',
  overview_surplus_formula: 'ENTRATE − BANCA − CONTANTI − PIANIFICATO',

  // Account page
  account_title: 'Account',
  account_profile: 'Profilo',
  account_language: 'Lingua',
  account_language_label: "Lingua dell'app",
  account_signout: 'Esci da Cifra',
  account_signout_note:
    'Cancella la master key dalla memoria. I blob cloud restano fino alla scadenza di 30 giorni.',
  account_section_language: 'Lingua',
  account_section_sync: 'Sync e dispositivi',
  account_sync_relay: 'Relay (default)',
  account_sync_p2p: 'Diretto (P2P)',
  account_sync_local: 'Solo locale',
  account_devices_add: 'Aggiungi dispositivo (pairing QR)',
  account_vault_export: 'Esporta backup cifrato',
  account_delete: 'Elimina tutti i dati',
  account_pwa_install: 'Installa app',
  account_last_sync: (d: string) => `Ultima sync: ${d}`,

  // Banners
  offline_banner: 'Sei offline -- le modifiche sono salvate localmente',
  update_available: 'Una nuova versione e disponibile',
  update_now: 'Aggiorna ora',

  // Error states
  error_auth_heading: 'Accesso non riuscito',
  error_auth_body: "Qualcosa e andato storto durante l'accesso. Riprova.",
  error_vault:
    'Creazione vault non riuscita. I tuoi dati sono al sicuro -- riprova.',
  error_generic: 'Qualcosa e andato storto. Ricarica la pagina per continuare.',

  // Import page
  import_title: 'Importa movimenti',
  import_drop_title: 'Trascina qui il tuo estratto conto',
  import_preview_title: (n: number) => `Anteprima — ${n} movimenti trovati`,
  import_confirm_btn: (n: number) => `Importa ${n} movimenti`,
  import_success: (n: number) => `${n} movimenti importati con successo`,
  import_ai_needed: "L'importazione PDF richiede l'AI...",

  // Import wizard
  import_step_file: 'File',
  import_step_profile: 'Profilo',
  import_step_map: 'Mappa',
  import_step_preview: 'Anteprima',
  import_drop_sub: 'o sfoglia i file',
  import_drop_formats: 'Accetta .csv, .xlsx, .xls',
  import_profile_heading: 'Seleziona profilo banca',
  import_custom_option: 'Mappatura colonne personalizzata',
  import_col_date: 'Colonna data',
  import_col_desc: 'Colonna descrizione',
  import_col_amount: 'Colonna importo',
  import_col_type: 'Colonna tipo (opzionale)',
  import_date_format: 'Formato data',
  import_amount_sign: 'Segno importo',
  import_sign_standard: 'Standard (negativo = debito)',
  import_sign_inverted: 'Invertito (positivo = debito)',
  import_encoding: (enc: string) => `Codifica: ${enc}`,
  import_encoding_warning:
    'Il testo potrebbe essere corrotto. Prova una codifica diversa.',
  import_preview_new: (n: number) => `${n} nuovi`,
  import_preview_dupes: (n: number) => `${n} duplicati ignorati`,
  import_dupes_toggle: (n: number) => `${n} duplicati (tocca per vedere)`,
  import_back: 'Indietro',
  import_next: 'Avanti',
  import_parsing: 'Lettura file...',
  import_importing: 'Importazione...',
  import_success_body: 'Tutti i movimenti salvati nel tuo vault cifrato.',
  import_save_prompt: 'Salvare questa mappatura come profilo?',
  import_profile_name: 'Nome profilo',
  import_save_btn: 'Salva profilo',
  import_skip_btn: 'Salta',
  import_view_txns: 'Vedi movimenti',

  // Transactions page
  txn_title: 'Movimenti',
  txn_import_btn: 'Importa estratto',
  txn_col_date: 'Data',
  txn_col_desc: 'Descrizione',
  txn_col_amount: 'Importo',
  txn_history_heading: 'Cronologia importazioni',
  txn_history_empty: 'Nessuna importazione',
  txn_empty_heading: 'Nessun movimento',
  txn_empty_body: 'Importa un estratto conto per vedere i tuoi movimenti qui.',
  txn_empty_cta: 'Importa estratto conto',

  // Import error states
  import_error_parse_heading: 'Impossibile leggere il file',
  import_error_parse_body:
    'Il formato del file non e supportato o il file e corrotto. Prova un altro file.',
  import_error_empty: 'Questo file non contiene righe di dati.',
  import_error_mapping:
    'Alcune colonne obbligatorie non sono mappate. Seleziona una colonna per ogni campo richiesto.',
  import_error_failed_heading: 'Importazione non riuscita',
  import_error_failed_body:
    'Qualcosa e andato storto nel salvataggio. I tuoi dati esistenti sono al sicuro. Riprova.',

  // Goals page
  goals_strategy_weighted: 'Pesi %',
  goals_strategy_priority: 'Priorità',
  goals_strategy_equal: 'Equo',
  goals_strategy_deadline: 'Scadenza',
  goals_on_track: 'In pista',
  goals_at_risk: 'A rischio',
  goals_deadline_label: (d: string) => `Scadenza ${d}`,
  goals_saved_vs: (s: string) => `Risparmiato vs media: +${s}`,
};
