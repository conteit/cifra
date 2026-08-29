# Cifra

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)

**Your money, ciphered.** Cifra is a privacy-first personal finance PWA for the
Italian market: bank statement imports, cash expenses, budgets, and savings
goals in a single offline-capable interface — with everything encrypted in your
browser.

*Cifra* is Italian for "figure/number" and the root of *cifrare*, to encrypt.
The app counts money and protects it.

This repository is a public restart of an archived v1 prototype. The planning
corpus, the bank-parsing research, and the EN/IT strings were ported; all
application code and UI is being rebuilt from scratch in the open.

## Privacy model

- **Local-first.** Your financial data lives in your browser's IndexedDB. The
  app works offline and is installable as a PWA.
- **End-to-end encrypted.** A master password is stretched with Argon2id into a
  non-extractable key that wraps the data key; records are sealed with
  AES-256-GCM before they are ever written. A stolen device without the password
  yields ciphertext.
- **No server-side financial data.** Firebase provides sign-in identity only.
  Nothing about your transactions is stored, logged, or analysed on a server —
  optional multi-device sync moves encrypted blobs the relay cannot read.

## Status

Early. The engineering foundation is in place (SPA scaffold, design workbench,
CI contract, PWA shell); product features are being built phase by phase. See
[docs/architecture.md](docs/architecture.md) §Roadmap.

## Development

```bash
nvm use          # Node 24
npm ci
npm run emulators   # in a second terminal: Firebase Auth emulator on :9099
npm run dev
```

**No `.env` file, no Firebase project, and no secrets are needed.** Sign-in in
development runs against the local Firebase Auth emulator, which accepts any
project id and any API key. `npm run emulators` starts it — the Auth emulator
only, as a plain Node process (no Java, no downloads beyond `npm ci`). Without it
running, the app still loads; sign-in simply reports itself unavailable.

Real `VITE_FIREBASE_*` values exist in exactly one place — the Vercel project's
environment variables for production. They are not part of a local setup; see
[.env.example](.env.example) for the details and for why a Firebase web config
is public by design.

Then the full check that CI runs on every PR:

```bash
npx playwright install chromium   # once: the story smoke tests render in a browser
npm run verify   # typecheck && lint && format:check && assist:check && test:unit && test:stories && build && build-storybook
```

End-to-end tests run separately. They start the Auth emulator and an
emulator-mode build themselves, so nothing needs to be running first:

```bash
npm run test:e2e
```

The design system lives in Storybook:

```bash
npm run storybook
```

## Design system

Storybook is the living design spec — every component ships with stories
covering its states in both English and Italian.

Published Storybook: https://conteit.github.io/cifra/

## Architecture

[docs/architecture.md](docs/architecture.md) is the authoritative description of
the product, the 68 v1 requirements, the 9-phase roadmap, the decision log, the
crypto and data-layer contract, the bank import pipeline, and the development
workflow. Contributors and issues both reference its sections directly.

## License

[Apache 2.0](LICENSE).
