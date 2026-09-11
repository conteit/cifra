import type { Strings } from './en';

/**
 * The Italian table. Typed as `Strings` — the shape derived from `en` — so the
 * compiler holds key parity and interpolator signatures, and so this table can
 * be handed to a component wherever the English one can.
 *
 * Type parity is not *value* parity: an Italian value that is still English
 * prose type-checks fine. That gap is issue #58.
 */
export const it: Strings = {
  // App identity
  tagline_line1: 'I tuoi soldi,',
  tagline_line2: 'cifrati.',

  // Sign-in screen
  signin_title: 'Benvenuto',
  signin_sub: 'Accedi per sbloccare la tua finanza personale privata.',
  signin_feat1_title: 'Crittografia end-to-end',
  signin_feat1_body:
    'I tuoi dati sono cifrati sul dispositivo -- nessuno puo leggerli.',
  signin_feat2_title: 'La chiave e solo tua',
  signin_feat2_body:
    'La tua password principale apre il vault. Cifra non puo reimpostarla.',
  signin_feat3_title: 'Sync tra dispositivi',
  signin_feat3_body:
    'Blob cifrati in transito -- il server vede solo testo incomprensibile.',
  signin_btn: 'Continua con Google',
  signing_in: 'Accesso in corso...',
  signin_note: 'Google ti identifica. Non apre mai i tuoi dati.',

  // Accesso — autenticazione non disponibile
  signin_unavailable_title: 'Accesso non disponibile',
  signin_unavailable_body:
    "Questa build non ha un provider di identita configurato, quindi non c'e nulla a cui accedere. Nulla su questo dispositivo e stato toccato.",
  signin_unavailable_hint: "Ricarica la pagina quando l'app sara configurata.",

  // Errori di accesso, uno per AuthErrorCode
  auth_error_popup_closed:
    "La finestra di Google si e chiusa prima della fine dell'accesso.",
  auth_error_popup_blocked:
    'Il browser ha bloccato la finestra di Google. Consenti i popup per questo sito e riprova.',
  auth_error_cancelled: 'Accesso annullato.',
  auth_error_network:
    'Impossibile raggiungere Google. Controlla la connessione e riprova.',
  auth_error_account_exists:
    'Questa email e gia collegata a un altro metodo di accesso.',
  auth_error_unauthorized_domain:
    "Questo indirizzo non e tra quelli autorizzati all'accesso.",
  auth_error_operation_not_allowed:
    "L'accesso con Google non e abilitato per questa app.",
  auth_error_user_disabled: 'Questo account e stato disattivato.',
  auth_error_too_many_requests:
    'Troppi tentativi. Aspetta un momento e riprova.',
  auth_error_configuration: "L'accesso non e configurato in questa build.",
  auth_error_storage_unsupported:
    "Il browser sta bloccando l'archiviazione necessaria all'accesso. Esci dalla navigazione privata o consenti i dati del sito.",
  auth_error_unknown: "Qualcosa e andato storto durante l'accesso. Riprova.",

  // Setup wizard — Vault creation
  setup_vault_title: 'Creazione vault',
  vault_step1: 'Chiave AES-256 generata',
  vault_step1_sub: 'Sul dispositivo -- non trasmessa mai in chiaro',
  vault_step2: 'Chiave principale derivata dalla tua password',
  vault_step2_sub:
    'Argon2id su questo dispositivo -- la password non viene mai inviata',
  vault_step3: 'Namespace cifrato inizializzato',
  vault_step3_sub: 'Storage isolato per il tuo account',

  // Configurazione — scelta della password principale
  setup_password_title: 'Scegli la tua password principale',
  setup_password_sub:
    'Cifra tutto su questo dispositivo. Cifra non la vede mai e non puo reimpostarla.',
  setup_password_label: 'Password principale',
  setup_password_hint:
    'Almeno 12 caratteri. Una frase che ricordi vale piu di un miscuglio corto.',
  setup_password_confirm_label: 'Ripeti la password principale',
  setup_password_too_short: 'Usa almeno 12 caratteri.',
  setup_password_mismatch: 'Le due password non coincidono.',
  setup_password_warning:
    'Se la dimentichi, solo la frase di recupero potra aprire questo vault.',

  // Configurazione — derivazione della chiave (tre stati, nessuna percentuale)
  setup_creating_sub:
    'Derivazione della chiave su questo dispositivo. Su un telefono richiede un momento.',
  vault_busy_starting: 'Preparazione...',
  vault_busy_deriving: 'Derivazione della chiave...',

  // Configurazione — la frase di recupero, mostrata una sola volta (D26)
  setup_recovery_title: 'Trascrivi la tua frase di recupero',
  setup_recovery_sub:
    "Questi 32 caratteri sono l'unico altro modo per entrare nel vault. Vengono mostrati una sola volta e non potranno piu essere rivisti.",
  setup_recovery_warning:
    'Se perdi sia la password principale sia questa frase, i dati sono persi per sempre. Nessuno puo recuperarli -- ne Cifra, ne Google.',
  setup_recovery_ack: 'Ho trascritto la frase in un posto sicuro.',
  recovery_phrase_label: 'Frase di recupero',

  // Configurazione — riscrittura della frase
  setup_confirm_title: 'Riscrivi la frase',
  setup_confirm_sub:
    'Serve a verificare che la copia trascritta sia quella giusta. Spazi e maiuscole non contano.',
  setup_confirm_mismatch:
    'Non coincide con la frase qui sopra. Controlla quello che hai trascritto.',

  // Configurazione — completata
  setup_done_title: 'Il tuo vault e pronto',
  setup_done_body:
    'Tutto quello che aggiungi da qui viene cifrato su questo dispositivo prima di essere salvato.',

  // Schermata di sblocco
  unlock_title: 'Sblocca il tuo vault',
  unlock_sub: 'La tua password principale decifra questo dispositivo.',
  unlock_idle_sub:
    'Bloccato dopo 30 minuti di inattività. La tua password principale decifra questo dispositivo.',
  unlock_password_label: 'Password principale',
  unlock_btn: 'Sblocca',
  unlocking: 'Sblocco in corso...',
  unlock_use_recovery: 'Usa la frase di recupero',
  unlock_use_password: 'Usa la password principale',
  unlock_recovery_title: 'Sblocca con la frase di recupero',
  unlock_recovery_sub:
    'I 32 caratteri che hai trascritto durante la configurazione.',
  unlock_error_vault_exists:
    'Questo dispositivo ha gia un vault. Sbloccalo qui sotto.',
  unlock_error_secret_rejected: 'Non apre questo vault.',
  unlock_error_phrase_malformed:
    'Non e una frase di recupero. Sono 32 caratteri, in 8 gruppi da 4.',
  unlock_error_password_malformed:
    'Inserisci la password principale: non può essere vuota né superare i 1024 caratteri.',
  unlock_error_record_invalid:
    'Questo record del vault non e leggibile. Ripristina da un backup.',
  unlock_error_environment:
    'Il browser non e riuscito a eseguire lo sblocco. Ricarica la pagina e riprova.',

  // Buttons
  continue_btn: 'Continua',
  back_btn: 'Indietro',
  identity_lock: 'Blocca',
  signout_btn: 'Esci',
  create_vault_btn: 'Crea il mio vault',
  creating_btn: 'Creazione in corso...',
  continue_overview: 'Continua alla panoramica',

  // Dialog chrome — copy the Modal primitive needs but cannot resolve itself
  // (a primitive has no locale; pages pass it in).
  modal_close: 'Chiudi',

  // Navigation
  nav_overview: 'Panoramica',
  nav_transactions: 'Movimenti',
  nav_track: 'Aggiungi',
  nav_wallet: 'Contanti',
  nav_goals: 'Obiettivi',
  nav_import: 'Importa',
  nav_account: 'Account',

  // Struttura dell'app
  shell_nav_label: 'Navigazione principale',
  shell_skip_to_content: 'Vai al contenuto',
  shell_more: 'Altro',
  shell_soon: 'Presto',

  // Install prompt — l'affordance di installazione PWA (FOUN-06, D25).
  // `install_ios_body` è la variante iOS/iPadOS: WebKit non emette mai
  // `beforeinstallprompt`, quindi non c'è nulla da premere e il testo nomina
  // il comando del browser.
  install_title: 'Installa Cifra',
  install_body:
    "Aggiungi Cifra alla schermata Home. Si apre come un'app e continua a funzionare offline.",
  install_ios_body:
    'Aggiungi Cifra alla schermata Home: apri il menu Condividi e scegli "Aggiungi a Home".',
  install_action: 'Installa',
  install_dismiss: 'Non ora',

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
