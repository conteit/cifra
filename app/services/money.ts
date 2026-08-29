/**
 * Money — integer cents end to end.
 *
 * Governed by `docs/architecture.md` §Money and decision D13/V1-1: amounts are
 * integer cents (`-1234` = −12,34 €), never floats. Parsing happens only at the
 * import edge, formatting only at the display edge.
 *
 * This module is pure TypeScript in the services layer: it imports nothing, and
 * in particular no React and no Dexie, so pages, stores and the import pipeline
 * can all depend on it.
 *
 * No value ever travels through an IEEE-754 double in this module. Parsing goes
 * digit-string -> `BigInt` -> safe-integer `number`; formatting goes
 * `number` -> `BigInt` -> decimal string -> `Intl.NumberFormat`. There is no
 * division by 100 and no `parseFloat`/`Number(...)` on a decimal string
 * anywhere on either path.
 */

/**
 * An amount of money, as an integer number of cents.
 *
 * `-1234` means −12,34 €. Values outside
 * {@link MIN_SAFE_CENTS}..{@link MAX_SAFE_CENTS} are not representable.
 */
export type Cents = number;

/**
 * Largest representable amount: 9.007.199.254.740.991 cents, i.e.
 * 90.071.992.547.409,91 €. Past this, `number` can no longer hold every integer
 * exactly, so the parser refuses rather than losing a cent silently.
 */
export const MAX_SAFE_CENTS: Cents = Number.MAX_SAFE_INTEGER;

/** Smallest representable amount — the negative of {@link MAX_SAFE_CENTS}. */
export const MIN_SAFE_CENTS: Cents = -Number.MAX_SAFE_INTEGER;

/** Why a string could not be read as an Italian-format amount. */
export type MoneyParseErrorCode =
  /** Input was empty or only whitespace. */
  | 'EMPTY'
  /** Input carried a sign or a currency symbol but no digits at all. */
  | 'NO_DIGITS'
  /** Input contained characters outside the accepted alphabet. */
  | 'INVALID_CHARACTER'
  /** More than one sign was present (`--5`, `-5-`, `-(5,00)`). */
  | 'MULTIPLE_SIGNS'
  /** Parentheses were not a single pair wrapping the whole value. */
  | 'UNBALANCED_PARENTHESES'
  /** More than one decimal comma (`1,2,3`). */
  | 'MULTIPLE_DECIMAL_SEPARATORS'
  /** Group separators did not form valid Italian groups of three digits. */
  | 'MALFORMED_GROUPING'
  /** The separator could be read two ways with a 1000x difference (`1.234`). */
  | 'AMBIGUOUS_SEPARATOR'
  /** More than two decimals, with a non-zero digit that would be rounded away. */
  | 'TOO_MANY_DECIMALS'
  /** The value is outside the safe-integer cent range. */
  | 'OUT_OF_RANGE';

/** Every failure this module reports, including display-side misuse. */
export type MoneyErrorCode =
  | MoneyParseErrorCode
  /** A display function was handed something that is not an integer cent. */
  | 'NOT_INTEGER_CENTS';

/** The single error type this module throws. */
export class MoneyError extends Error {
  readonly code: MoneyErrorCode;
  /** The offending input, as received. */
  readonly input: string;

  constructor(code: MoneyErrorCode, input: string) {
    super(`${code}: ${JSON.stringify(input)}`);
    this.name = 'MoneyError';
    this.code = code;
    this.input = input;
  }
}

/** Outcome of a non-throwing parse. */
export type MoneyParseResult =
  | { readonly ok: true; readonly cents: Cents }
  | { readonly ok: false; readonly code: MoneyParseErrorCode };

/**
 * Characters accepted as a minus sign. Bank exports and copy-paste both produce
 * dashes other than U+002D; every one of them can only mean "negative" here.
 */
const MINUS_CHARS = new Set([
  '-', // hyphen-minus
  '‐', // hyphen
  '‑', // non-breaking hyphen
  '‒', // figure dash
  '–', // en dash
  '—', // em dash
  '−', // minus sign
]);

/** `\s` already covers U+00A0 and U+202F, the separators exports actually use. */
const WHITESPACE = /\s/;
const LEADING_CURRENCY = /^(?:€|EUR(?:O)?)/i;
const TRAILING_CURRENCY = /(?:€|EUR(?:O)?)$/i;
const NUMERIC_ALPHABET = /^[0-9.,\s]+$/;
const ANY_DIGIT = /[0-9]/;
const DIGITS_ONLY = /^[0-9]+$/;
const FIRST_GROUP = /^[0-9]{1,3}$/;
const FULL_GROUP = /^[0-9]{3}$/;
const GROUP_SEPARATOR = /[.\s]/;
const MAX_CENTS_BIG = BigInt(Number.MAX_SAFE_INTEGER);

function fail(code: MoneyParseErrorCode): MoneyParseResult {
  return { ok: false, code };
}

function isMinus(char: string): boolean {
  return MINUS_CHARS.has(char);
}

function isSign(char: string): boolean {
  return char === '+' || isMinus(char);
}

interface Peeled {
  readonly rest: string;
  readonly signCount: number;
  readonly currencyCount: number;
  readonly negative: boolean;
}

type PeelSeed = Omit<Peeled, 'rest'>;

/**
 * Strip currency tokens and sign characters from both ends, counting what was
 * found so a second sign can be rejected rather than silently ignored.
 */
function peelSignsAndCurrency(value: string, seed: PeelSeed): Peeled {
  let rest = value.trim();
  let { signCount, currencyCount, negative } = seed;

  for (;;) {
    if (rest === '') break;

    const leadingCurrency = LEADING_CURRENCY.exec(rest);
    if (leadingCurrency) {
      rest = rest.slice(leadingCurrency[0].length).trim();
      currencyCount += 1;
      continue;
    }

    const trailingCurrency = TRAILING_CURRENCY.exec(rest);
    if (trailingCurrency) {
      rest = rest.slice(0, rest.length - trailingCurrency[0].length).trim();
      currencyCount += 1;
      continue;
    }

    const first = rest[0];
    if (first !== undefined && isSign(first)) {
      negative = negative || isMinus(first);
      signCount += 1;
      rest = rest.slice(1).trim();
      continue;
    }

    const last = rest[rest.length - 1];
    if (last !== undefined && isSign(last)) {
      negative = negative || isMinus(last);
      signCount += 1;
      rest = rest.slice(0, -1).trim();
      continue;
    }

    break;
  }

  return { rest, signCount, currencyCount, negative };
}

/**
 * Read an Italian-format amount string into integer cents, without throwing.
 *
 * Accepts `1.234,56`, `1234,56`, `1234`, `12,5`, `,56`, dot- or space-grouped
 * integers, a leading or trailing sign, accounting parentheses, and a leading
 * or trailing `€` / `EUR` / `EURO`. Rejects everything else with a typed code —
 * it never falls back to `0` or `NaN`.
 *
 * Sign conventions that live *outside* the string — `amountSign: inverted`,
 * separate Dare/Avere or Entrate/Uscite columns — are the caller's job. This
 * function only reads the sign the string itself carries.
 */
export function tryParseItalianAmount(input: string): MoneyParseResult {
  if (typeof input !== 'string') return fail('INVALID_CHARACTER');

  const trimmed = input.trim();
  if (trimmed === '') return fail('EMPTY');

  // Signs and currency first, so `-(5,00)` and `(5,00)-` are seen as two signs
  // rather than as a stray parenthesis.
  let peeled = peelSignsAndCurrency(trimmed, {
    signCount: 0,
    currencyCount: 0,
    negative: false,
  });

  if (peeled.rest.startsWith('(') && peeled.rest.endsWith(')')) {
    peeled = peelSignsAndCurrency(peeled.rest.slice(1, -1), {
      signCount: peeled.signCount + 1,
      currencyCount: peeled.currencyCount,
      negative: true,
    });
  }

  const body = peeled.rest;
  if (peeled.signCount > 1) return fail('MULTIPLE_SIGNS');
  if (body.includes('(') || body.includes(')')) {
    return fail('UNBALANCED_PARENTHESES');
  }
  if (peeled.currencyCount > 1) return fail('INVALID_CHARACTER');
  if (body === '') return fail('NO_DIGITS');
  if (!NUMERIC_ALPHABET.test(body)) return fail('INVALID_CHARACTER');
  if (!ANY_DIGIT.test(body)) return fail('NO_DIGITS');

  // Split on the decimal comma — the only decimal separator Italian uses.
  const commaCount = body.split(',').length - 1;
  if (commaCount > 1) return fail('MULTIPLE_DECIMAL_SEPARATORS');

  const commaIndex = body.indexOf(',');
  const hasComma = commaIndex >= 0;
  const rawInteger = hasComma ? body.slice(0, commaIndex) : body;
  const fraction = hasComma ? body.slice(commaIndex + 1) : '';

  if (hasComma && !DIGITS_ONLY.test(fraction)) {
    // Covers `1,` (empty fraction) and `1,234.56` (a dot after the comma).
    return fail('MALFORMED_GROUPING');
  }

  const integer = rawInteger === '' ? '0' : rawInteger;

  // Only one kind of group separator may be used, and groups must be Italian.
  const separators = new Set<string>();
  for (const char of integer) {
    if (char === '.') separators.add('.');
    else if (WHITESPACE.test(char)) separators.add(' ');
  }
  if (separators.size > 1) return fail('MALFORMED_GROUPING');

  const groups = integer.split(GROUP_SEPARATOR);
  if (groups.length === 1) {
    if (!DIGITS_ONLY.test(groups[0])) return fail('MALFORMED_GROUPING');
  } else {
    if (!FIRST_GROUP.test(groups[0])) return fail('MALFORMED_GROUPING');
    for (let i = 1; i < groups.length; i += 1) {
      if (!FULL_GROUP.test(groups[i])) return fail('MALFORMED_GROUPING');
    }
  }

  // Ambiguity: a single separator with exactly three digits after it reads two
  // ways, 1000x apart. We refuse to guess rather than corrupt a ledger quietly.
  if (!hasComma && groups.length === 2 && separators.has('.')) {
    // `1.234` — Italian grouping (1234) or a stray decimal point (1,234)?
    return fail('AMBIGUOUS_SEPARATOR');
  }
  if (
    hasComma &&
    separators.size === 0 &&
    integer.length <= 3 &&
    fraction.length === 3
  ) {
    // `1,234` — Italian decimals (1,234) or English thousands (1234)?
    return fail('AMBIGUOUS_SEPARATOR');
  }

  // Never round. Digits past the second are dropped only when they are zeros,
  // which provably carry no value.
  let centDigits: string;
  if (fraction.length <= 2) {
    centDigits = fraction.padEnd(2, '0');
  } else {
    if (/[^0]/.test(fraction.slice(2))) return fail('TOO_MANY_DECIMALS');
    centDigits = fraction.slice(0, 2);
  }

  const magnitude = BigInt(groups.join('') + centDigits);
  if (magnitude > MAX_CENTS_BIG) return fail('OUT_OF_RANGE');

  const signed = peeled.negative ? -magnitude : magnitude;
  return { ok: true, cents: Number(signed) };
}

/**
 * Read an Italian-format amount string into integer cents.
 *
 * @throws {MoneyError} carrying a {@link MoneyParseErrorCode} and the input.
 * @see tryParseItalianAmount for the non-throwing form used by bulk import.
 */
export function parseItalianAmount(input: string): Cents {
  const result = tryParseItalianAmount(input);
  if (!result.ok) throw new MoneyError(result.code, input);
  return result.cents;
}

/** Whether a value is an exact, representable integer-cent amount. */
export function isCents(value: unknown): value is Cents {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function assertCents(value: Cents): void {
  if (!isCents(value)) throw new MoneyError('NOT_INTEGER_CENTS', String(value));
}

/**
 * Exact decimal string for a cent amount — `123456` becomes `"1234.56"`.
 *
 * Built through `BigInt` string arithmetic, so no division by 100 and therefore
 * no floating-point error, at any magnitude.
 */
function toDecimalString(cents: Cents): `${number}` {
  assertCents(cents);
  const value = BigInt(cents);
  const negative = value < 0n;
  const digits = (negative ? -value : value).toString().padStart(3, '0');
  const sign = negative ? '-' : '';
  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}` as `${number}`;
}

/**
 * `Intl.NumberFormat` construction is expensive, so both formatters are built
 * once, lazily, and reused for the lifetime of the module.
 *
 * `useGrouping: 'always'` overrides the CLDR `min2` default for `it-IT`, which
 * would render 123456 cents as `1234,56`. Italian bank statements and
 * `docs/architecture.md` §Money both write `1.234,56`.
 */
let plainFormatter: Intl.NumberFormat | undefined;
let currencyFormatter: Intl.NumberFormat | undefined;

function getPlainFormatter(): Intl.NumberFormat {
  plainFormatter ??= new Intl.NumberFormat('it-IT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: 'always',
  });
  return plainFormatter;
}

function getCurrencyFormatter(): Intl.NumberFormat {
  currencyFormatter ??= new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    useGrouping: 'always',
  });
  return currencyFormatter;
}

/**
 * Format cents for display as a plain Italian number — `123456` -> `1.234,56`.
 *
 * Display edge only: never store this, never parse anything but our own output
 * back from it.
 *
 * @throws {MoneyError} `NOT_INTEGER_CENTS` if handed a float or an unsafe value.
 */
export function formatCents(cents: Cents): string {
  return getPlainFormatter().format(toDecimalString(cents));
}

/**
 * Format cents for display as euro — `123456` -> `1.234,56 €` (with U+00A0
 * before the symbol, as `it-IT` requires).
 *
 * Negative amounts render with a leading minus. Accounting parentheses are a
 * presentation choice and belong to the component, not to this layer.
 *
 * @throws {MoneyError} `NOT_INTEGER_CENTS` if handed a float or an unsafe value.
 */
export function formatEuro(cents: Cents): string {
  return getCurrencyFormatter().format(toDecimalString(cents));
}
