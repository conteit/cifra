import { describe, expect, it } from 'vitest';
import {
  formatCents,
  formatEuro,
  isCents,
  MAX_SAFE_CENTS,
  MIN_SAFE_CENTS,
  MoneyError,
  type MoneyParseErrorCode,
  parseItalianAmount,
  tryParseItalianAmount,
} from '../../app/services/money';

/** U+00A0 no-break space — what `Intl.NumberFormat('it-IT')` puts before `€`. */
const NBSP = ' ';
/** U+202F narrow no-break space — seen as a group separator in some exports. */
const NNBSP = ' ';
/** U+2212 true minus sign. */
const MINUS = '−';
/** U+2013 en dash. */
const EN_DASH = '–';

function expectRejected(input: string, code: MoneyParseErrorCode): void {
  const result = tryParseItalianAmount(input);
  expect(result, `expected ${JSON.stringify(input)} to be rejected`).toEqual({
    ok: false,
    code,
  });
}

describe('parseItalianAmount — accepted Italian forms', () => {
  const accepted: ReadonlyArray<readonly [string, number]> = [
    // Grouping + decimal comma.
    ['1.234,56', 123456],
    ['1.234.567,89', 123456789],
    ['1.234.567.890,12', 123456789012],
    // No grouping.
    ['1234,56', 123456],
    ['123,45', 12345],
    ['0,01', 1],
    ['0,00', 0],
    // No decimals at all.
    ['1234', 123400],
    ['7', 700],
    // Multi-dot integers are unambiguous grouping, no comma needed.
    ['1.234.567', 123456700],
    // One decimal digit.
    ['12,5', 1250],
    ['0,5', 50],
    // Missing integer part.
    [',56', 56],
    // Leading zeros are harmless.
    ['0001234,56', 123456],
  ];

  for (const [input, cents] of accepted) {
    it(`parses ${JSON.stringify(input)} as ${cents} cents`, () => {
      expect(parseItalianAmount(input)).toBe(cents);
    });
  }
});

describe('parseItalianAmount — sign conventions owned by the string parser', () => {
  const accepted: ReadonlyArray<readonly [string, number]> = [
    ['-1.234,56', -123456],
    ['+1.234,56', 123456],
    ['1.234,56-', -123456],
    ['1.234,56+', 123456],
    ['(1.234,56)', -123456],
    [`${MINUS}1.234,56`, -123456],
    [`${EN_DASH}1.234,56`, -123456],
    ['‐1.234,56', -123456], // U+2010 hyphen
    ['‑1.234,56', -123456], // U+2011 non-breaking hyphen
    ['‒1.234,56', -123456], // U+2012 figure dash
    ['—1.234,56', -123456], // U+2014 em dash
    ['- 1.234,56', -123456],
    ['1.234,56 -', -123456],
  ];

  for (const [input, cents] of accepted) {
    it(`parses ${JSON.stringify(input)} as ${cents} cents`, () => {
      expect(parseItalianAmount(input)).toBe(cents);
    });
  }

  it('never produces negative zero', () => {
    for (const input of ['-0,00', '(0,00)', `${MINUS}0,00`, '-0']) {
      const cents = parseItalianAmount(input);
      expect(Object.is(cents, 0), input).toBe(true);
    }
  });
});

describe('parseItalianAmount — currency symbols and whitespace noise', () => {
  const accepted: ReadonlyArray<readonly [string, number]> = [
    ['€ 1.234,56', 123456],
    ['€1.234,56', 123456],
    ['1.234,56 €', 123456],
    [`1.234,56${NBSP}€`, 123456],
    ['EUR 1.234,56', 123456],
    ['eur 1.234,56', 123456],
    ['1.234,56 EUR', 123456],
    ['EURO 1.234,56', 123456],
    ['€ -1.234,56', -123456],
    ['-€ 1.234,56', -123456],
    ['-1.234,56 €', -123456],
    ['(€ 1.234,56)', -123456],
    ['€ 1.234,56-', -123456],
    ['  1.234,56  ', 123456],
    [`\t1.234,56\n`, 123456],
  ];

  for (const [input, cents] of accepted) {
    it(`parses ${JSON.stringify(input)} as ${cents} cents`, () => {
      expect(parseItalianAmount(input)).toBe(cents);
    });
  }
});

describe('parseItalianAmount — space characters as group separators', () => {
  const accepted: ReadonlyArray<readonly [string, number]> = [
    [`1${NBSP}234,56`, 123456],
    [`1${NNBSP}234,56`, 123456],
    [`1${NBSP}234${NBSP}567,89`, 123456789],
    ['1 234,56', 123456],
    [`1${NBSP}234`, 123400],
  ];

  for (const [input, cents] of accepted) {
    it(`parses ${JSON.stringify(input)} as ${cents} cents`, () => {
      expect(parseItalianAmount(input)).toBe(cents);
    });
  }

  it('rejects space groups of the wrong size', () => {
    expectRejected('1 2 3,45', 'MALFORMED_GROUPING');
    expectRejected(`12${NBSP}34,56`, 'MALFORMED_GROUPING');
  });

  it('rejects mixing dot grouping with space grouping', () => {
    expectRejected(`1.234${NBSP}567,89`, 'MALFORMED_GROUPING');
  });
});

describe('parseItalianAmount — the ambiguity rules', () => {
  it('rejects a single dot followed by exactly three digits (1.234 could be 1234 or 1,234)', () => {
    expectRejected('1.234', 'AMBIGUOUS_SEPARATOR');
    expectRejected('12.345', 'AMBIGUOUS_SEPARATOR');
    expectRejected('123.456', 'AMBIGUOUS_SEPARATOR');
  });

  it('rejects a single comma followed by exactly three digits (1,234 could be 1,234 or 1234)', () => {
    expectRejected('1,234', 'AMBIGUOUS_SEPARATOR');
    expectRejected('12,345', 'AMBIGUOUS_SEPARATOR');
    expectRejected('123,456', 'AMBIGUOUS_SEPARATOR');
    // Trailing zero does not make it safe: this is exactly the 1000x class.
    expectRejected('1,230', 'AMBIGUOUS_SEPARATOR');
    expectRejected('1,000', 'AMBIGUOUS_SEPARATOR');
    // The rule is structural, so it fires even where both readings agree.
    expectRejected('0,005', 'AMBIGUOUS_SEPARATOR');
  });

  it('does not treat unambiguous shapes as ambiguous', () => {
    // Two dots cannot be a decimal point.
    expect(parseItalianAmount('1.234.567')).toBe(123456700);
    // A dot plus a decimal comma is fully specified.
    expect(parseItalianAmount('1.234,56')).toBe(123456);
    // An integer part longer than a group cannot be English thousands.
    expectRejected('1234,567', 'TOO_MANY_DECIMALS');
    // A space is never a decimal separator anywhere.
    expect(parseItalianAmount(`1${NBSP}234`)).toBe(123400);
  });
});

describe('parseItalianAmount — decimal digits beyond two', () => {
  it('accepts extra digits only when they are all zero (exact, nothing rounded)', () => {
    expect(parseItalianAmount('1.234,500')).toBe(123450);
    expect(parseItalianAmount('1234,5600')).toBe(123456);
    expect(parseItalianAmount('9876,000')).toBe(987600);
  });

  it('rejects rather than rounds when a non-zero digit would be lost', () => {
    expectRejected('1234,567', 'TOO_MANY_DECIMALS');
    expectRejected('1.234,5678', 'TOO_MANY_DECIMALS');
    expectRejected('1234,501', 'TOO_MANY_DECIMALS');
    expectRejected('12.345,678', 'TOO_MANY_DECIMALS');
  });
});

describe('parseItalianAmount — malformed input is rejected with a typed code', () => {
  const rejected: ReadonlyArray<readonly [string, MoneyParseErrorCode]> = [
    ['', 'EMPTY'],
    ['   ', 'EMPTY'],
    [NBSP, 'EMPTY'],
    ['\t\n', 'EMPTY'],
    ['abc', 'INVALID_CHARACTER'],
    ['1.234,56x', 'INVALID_CHARACTER'],
    ['1,2eur3', 'INVALID_CHARACTER'],
    ['12a34,56', 'INVALID_CHARACTER'],
    ['€ €1,00', 'INVALID_CHARACTER'],
    ['€', 'NO_DIGITS'],
    ['-', 'NO_DIGITS'],
    [',', 'NO_DIGITS'],
    ['()', 'NO_DIGITS'],
    ['- €', 'NO_DIGITS'],
    ['1,2,3', 'MULTIPLE_DECIMAL_SEPARATORS'],
    ['1,23,45', 'MULTIPLE_DECIMAL_SEPARATORS'],
    ['1..234,56', 'MALFORMED_GROUPING'],
    ['1.23.4', 'MALFORMED_GROUPING'],
    ['1.234.56', 'MALFORMED_GROUPING'],
    ['1234.567,89', 'MALFORMED_GROUPING'],
    ['1.2', 'MALFORMED_GROUPING'],
    ['1.23', 'MALFORMED_GROUPING'],
    ['1.2345', 'MALFORMED_GROUPING'],
    ['.234', 'MALFORMED_GROUPING'],
    ['1.', 'MALFORMED_GROUPING'],
    ['1,', 'MALFORMED_GROUPING'],
    ['1,234.56', 'MALFORMED_GROUPING'],
    ['1,2 3', 'MALFORMED_GROUPING'],
    ['--5', 'MULTIPLE_SIGNS'],
    ['+-5', 'MULTIPLE_SIGNS'],
    ['-5-', 'MULTIPLE_SIGNS'],
    [`${MINUS}-5`, 'MULTIPLE_SIGNS'],
    ['-(5,00)', 'MULTIPLE_SIGNS'],
    ['(5,00)-', 'MULTIPLE_SIGNS'],
    ['(1.234,56', 'UNBALANCED_PARENTHESES'],
    ['1.234,56)', 'UNBALANCED_PARENTHESES'],
    ['1(2,00)', 'UNBALANCED_PARENTHESES'],
    ['((1,00))', 'UNBALANCED_PARENTHESES'],
  ];

  for (const [input, code] of rejected) {
    it(`rejects ${JSON.stringify(input)} with ${code}`, () => {
      expectRejected(input, code);
    });
  }

  it('never returns 0 or NaN for malformed input', () => {
    for (const [input] of rejected) {
      const result = tryParseItalianAmount(input);
      expect(result.ok, input).toBe(false);
    }
  });
});

describe('parseItalianAmount — precision and magnitude', () => {
  it('is exact at the maximum safe magnitude', () => {
    expect(parseItalianAmount('90.071.992.547.409,91')).toBe(MAX_SAFE_CENTS);
    expect(parseItalianAmount('-90.071.992.547.409,91')).toBe(MIN_SAFE_CENTS);
  });

  it('rejects magnitudes past the safe-integer range instead of losing precision', () => {
    expectRejected('90.071.992.547.409,92', 'OUT_OF_RANGE');
    expectRejected('-90.071.992.547.409,92', 'OUT_OF_RANGE');
    expectRejected('999.999.999.999.999.999,99', 'OUT_OF_RANGE');
  });

  it('is exact for values a float would round', () => {
    // 123456,78 -> 12345678 exactly; the naive `Number('123456.78') * 100`
    // route yields 12345677.999999998.
    expect(parseItalianAmount('123.456,78')).toBe(12345678);
    expect(parseItalianAmount('1,15')).toBe(115);
    expect(parseItalianAmount('8.087,45')).toBe(808745);
    expect(parseItalianAmount('4.203,03')).toBe(420303);
  });

  it('is exact where even `Math.round(Number(s) * 100)` is off by one', () => {
    // At these magnitudes a double cannot hold the decimal string exactly, so
    // rounding after multiplying by 100 lands on the wrong cent. The BigInt
    // digit path has no such failure mode.
    expect(parseItalianAmount('87.089.343.716.517,65')).toBe(8708934371651765);
    expect(parseItalianAmount('85.703.778.559.275,60')).toBe(8570377855927560);
    expect(parseItalianAmount('38.590.493.609.311,84')).toBe(3859049360931184);
    expect(parseItalianAmount('-41.293.833.655.274,70')).toBe(
      -4129383365527470,
    );
  });

  it('does not read Italian thousands separators the way parseFloat would', () => {
    // parseFloat('1.234,56') === 1.234 — the 1000x bug this parser exists to stop.
    expect(parseItalianAmount('-1.234,56')).toBe(-123456);
    expect(parseItalianAmount('1.000,00')).toBe(100000);
    expect(parseItalianAmount('12.000,00')).toBe(1200000);
  });
});

describe('parseItalianAmount — throwing wrapper', () => {
  it('returns cents on success', () => {
    expect(parseItalianAmount('1.234,56')).toBe(123456);
  });

  it('throws a MoneyError carrying the code and the offending input', () => {
    let thrown: unknown;
    try {
      parseItalianAmount('1.234');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(MoneyError);
    expect(thrown).toBeInstanceOf(Error);
    const error = thrown as MoneyError;
    expect(error.code).toBe('AMBIGUOUS_SEPARATOR');
    expect(error.input).toBe('1.234');
    expect(error.name).toBe('MoneyError');
    expect(error.message).toContain('AMBIGUOUS_SEPARATOR');
  });
});

describe('isCents', () => {
  it('accepts safe integers inside the supported range', () => {
    expect(isCents(0)).toBe(true);
    expect(isCents(-123456)).toBe(true);
    expect(isCents(MAX_SAFE_CENTS)).toBe(true);
    expect(isCents(MIN_SAFE_CENTS)).toBe(true);
  });

  it('rejects anything that is not an exact integer cent', () => {
    expect(isCents(12.5)).toBe(false);
    expect(isCents(Number.NaN)).toBe(false);
    expect(isCents(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isCents(Number.MAX_SAFE_INTEGER + 2)).toBe(false);
    expect(isCents('123')).toBe(false);
    expect(isCents(null)).toBe(false);
    expect(isCents(undefined)).toBe(false);
    expect(isCents(123n)).toBe(false);
  });
});

describe('formatCents — plain display form', () => {
  const cases: ReadonlyArray<readonly [number, string]> = [
    [123456, '1.234,56'],
    [-123456, '-1.234,56'],
    [0, '0,00'],
    [5, '0,05'],
    [-5, '-0,05'],
    [50, '0,50'],
    [100, '1,00'],
    [123456789, '1.234.567,89'],
    [1250, '12,50'],
    [MAX_SAFE_CENTS, '90.071.992.547.409,91'],
    [MIN_SAFE_CENTS, '-90.071.992.547.409,91'],
  ];

  for (const [cents, expected] of cases) {
    it(`formats ${cents} as ${JSON.stringify(expected)}`, () => {
      expect(formatCents(cents)).toBe(expected);
    });
  }

  it('always groups thousands, unlike the CLDR min2 default for it-IT', () => {
    expect(formatCents(123456)).toBe('1.234,56');
    expect(formatCents(100000)).toBe('1.000,00');
  });

  it('normalises negative zero', () => {
    expect(formatCents(-0)).toBe('0,00');
  });

  it('throws NOT_INTEGER_CENTS rather than silently formatting a float', () => {
    for (const bad of [
      12.5,
      -0.1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 2,
    ]) {
      let thrown: unknown;
      try {
        formatCents(bad);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, String(bad)).toBeInstanceOf(MoneyError);
      expect((thrown as MoneyError).code, String(bad)).toBe(
        'NOT_INTEGER_CENTS',
      );
    }
  });
});

describe('formatEuro — currency display form', () => {
  it('formats euros the Italian way with the symbol last', () => {
    expect(formatEuro(123456)).toBe(`1.234,56${NBSP}€`);
    expect(formatEuro(0)).toBe(`0,00${NBSP}€`);
    expect(formatEuro(123456789)).toBe(`1.234.567,89${NBSP}€`);
  });

  it('shows negatives with a leading minus, not accounting parentheses', () => {
    expect(formatEuro(-123456)).toBe(`-1.234,56${NBSP}€`);
    expect(formatEuro(-5)).toBe(`-0,05${NBSP}€`);
  });

  it('separates the amount from the symbol with U+00A0, not a plain space', () => {
    const formatted = formatEuro(123456);
    expect(formatted.includes(NBSP)).toBe(true);
    expect(formatted.includes(' ')).toBe(false);
  });

  it('throws NOT_INTEGER_CENTS rather than silently formatting a float', () => {
    expect(() => formatEuro(12.5)).toThrow(MoneyError);
  });
});

describe('round trip — our own formatter output parses back to the same cents', () => {
  const fixed = [
    0,
    1,
    -1,
    5,
    99,
    100,
    -100,
    999,
    1000,
    -1000,
    123456,
    -123456,
    100000,
    123456789,
    -123456789,
    1234567890,
    MAX_SAFE_CENTS,
    MIN_SAFE_CENTS,
  ];

  for (const cents of fixed) {
    it(`round-trips ${cents} through both display forms`, () => {
      expect(parseItalianAmount(formatCents(cents))).toBe(cents);
      expect(parseItalianAmount(formatEuro(cents))).toBe(cents);
    });
  }
});

describe('round trip — property over a seeded pseudo-random sample', () => {
  /**
   * Deterministic mulberry32 PRNG. A seeded generator keeps failures
   * reproducible without pulling in a property-testing dependency for a
   * property whose only input is a single integer.
   */
  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it('format(cents) parses back to cents for 2000 sampled magnitudes', () => {
    const random = mulberry32(0x1f2a3b4c);
    const magnitudes = [1e2, 1e4, 1e6, 1e9, 1e12, Number.MAX_SAFE_INTEGER];

    for (let i = 0; i < 2000; i += 1) {
      const magnitude = magnitudes[i % magnitudes.length];
      const sign = random() < 0.5 ? -1 : 1;
      const magnitudeValue = Math.floor(random() * magnitude);
      const cents = magnitudeValue === 0 ? 0 : sign * magnitudeValue;

      expect(isCents(cents), String(cents)).toBe(true);
      expect(parseItalianAmount(formatCents(cents)), String(cents)).toBe(cents);
      expect(parseItalianAmount(formatEuro(cents)), String(cents)).toBe(cents);
    }
  });
});
