/** 2026 federal + Ontario personal tax. Later years scale indexed items by inflation. */

export const FEDERAL_BRACKETS = [
  { upTo: 58_523, rate: 0.14 },
  { upTo: 117_045, rate: 0.205 },
  { upTo: 181_440, rate: 0.26 },
  { upTo: 258_482, rate: 0.29 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.33 },
] as const;

export const ONTARIO_BRACKETS = [
  { upTo: 53_891, rate: 0.0505 },
  { upTo: 107_785, rate: 0.0915 },
  { upTo: 150_000, rate: 0.1116 },
  { upTo: 220_000, rate: 0.1216 },
  { upTo: Number.POSITIVE_INFINITY, rate: 0.1316 },
] as const;

const FED_BPA = 16_452;
const FED_BPA_MIN = 14_829;
const FED_BPA_PHASE_START = 181_440;
const FED_BPA_PHASE_END = 258_482;
const ON_BPA = 12_989;
const ON_SURTAX_1 = 5_818;
const ON_SURTAX_2 = 7_446;
const FED_AGE_MAX = 9_209;
const AGE_THRESHOLD = 46_432;
const ON_AGE_MAX = 6_341;
const FED_EMPLOYMENT_MAX = 1_506;
const ON_PENSION_MAX = 1_762;
const ON_REDUCTION = 300;
const ON_REDUCTION_CHILD = 554;
const ELIGIBLE_GROSSUP = 1.38;
const FED_ELIGIBLE_DTC = 0.150198;
const ON_ELIGIBLE_DTC = 0.1;

const YMPE0 = 74_600;
const YAMPE0 = 85_000;
const YBE = 3_500;
const MIE0 = 68_900;
const EI_RATE = 0.0163;

export type TaxInput = {
  yearIndex: number;
  inflation: number;
  age: number;
  employment: number;
  selfEmployed: boolean;
  dbPension: number;
  /** RRIF / RRSP withdrawals that count as eligible pension (age 65+ RRIF, or we treat post-65 registered withdrawals as RRIF). */
  registeredWithdrawal: number;
  cpp: number;
  oas: number;
  interest: number;
  /** Cash eligible dividends, before gross-up. */
  eligibleDividends: number;
  /** Actual capital gain, before the 50% inclusion. */
  capitalGain: number;
  rrspDeduction: number;
  fhsaDeduction: number;
  /** HBP missed repayment and other fully taxable amounts that are not eligible pension. */
  otherIncome: number;
  /** Eligible pension transferred to a spouse (cannot exceed 50% of eligible). */
  splitOut: number;
  splitInDb: number;
  splitInRrif: number;
  /** Net income of a spouse, for the spousal credit. Null if no spouse. */
  spouseNet: number | null;
  /** Claim the eligible dependant credit (single parent, child has no income). */
  dependantCredit: boolean;
  childrenUnder18: number;
};

export type TaxOutput = {
  netIncome: number;
  taxableIncome: number;
  federal: number;
  ontario: number;
  ohp: number;
  clawback: number;
  payroll: number;
  /** Federal + Ontario + health premium + OAS recovery. Excludes CPP and EI. */
  totalTax: number;
  marginal: number;
  cppDeduction: number;
};

type Bracket = { upTo: number; rate: number };

function scale(yearIndex: number, inflation: number): number {
  return (1 + inflation) ** yearIndex;
}

function taxOn(income: number, brackets: readonly Bracket[]): number {
  if (income <= 0) return 0;
  let tax = 0;
  let prev = 0;
  for (const b of brackets) {
    const top = b.upTo;
    const slice = Math.min(income, top) - prev;
    if (slice > 0) tax += slice * b.rate;
    if (income <= top) break;
    prev = top;
  }
  return tax;
}

export function indexedBrackets(brackets: readonly Bracket[], f: number): Bracket[] {
  return brackets.map((b) => ({
    upTo: Number.isFinite(b.upTo) ? b.upTo * f : b.upTo,
    rate: b.rate,
  }));
}

/** Frozen since 2004. Not indexed. */
export function ontarioHealthPremium(taxable: number): number {
  const t = Math.max(0, taxable);
  if (t <= 20_000) return 0;
  if (t <= 25_000) return 0.06 * (t - 20_000);
  if (t <= 36_000) return 300;
  if (t <= 38_500) return 300 + 0.06 * (t - 36_000);
  if (t <= 48_000) return 450;
  if (t <= 48_600) return 450 + 0.25 * (t - 48_000);
  if (t <= 72_000) return 600;
  if (t <= 72_600) return 600 + 0.25 * (t - 72_000);
  if (t <= 200_000) return 750;
  if (t <= 200_600) return 750 + 0.25 * (t - 200_000);
  return 900;
}

export function payrollFor(employment: number, selfEmployed: boolean, f: number): {
  cash: number;
  creditBase: number;
  deduction: number;
} {
  const ympe = YMPE0 * f;
  const yampe = YAMPE0 * f;
  const mie = MIE0 * f;
  const baseEarnings = Math.max(0, Math.min(employment, ympe) - YBE);
  const cpp2Earnings = Math.max(0, Math.min(employment, yampe) - ympe);
  if (selfEmployed) {
    const credit = 0.0495 * baseEarnings;
    const deduction = 0.0495 * baseEarnings + 0.02 * baseEarnings + 0.08 * cpp2Earnings;
    return { cash: credit + deduction, creditBase: credit, deduction };
  }
  const credit = 0.0495 * baseEarnings;
  const extra = 0.01 * baseEarnings;
  const cpp2 = 0.04 * cpp2Earnings;
  const ei = EI_RATE * Math.min(Math.max(0, employment), mie);
  return {
    cash: credit + extra + cpp2 + ei,
    creditBase: credit + ei,
    deduction: extra + cpp2,
  };
}

function basicPersonal(net: number, f: number): number {
  const full = FED_BPA * f;
  const min = FED_BPA_MIN * f;
  const start = FED_BPA_PHASE_START * f;
  const end = FED_BPA_PHASE_END * f;
  if (net <= start) return full;
  if (net >= end) return min;
  const t = (net - start) / (end - start);
  return full - t * (full - min);
}

function computeOnce(input: TaxInput): Omit<TaxOutput, "marginal"> {
  const f = scale(input.yearIndex, input.inflation);
  const pay = payrollFor(Math.max(0, input.employment), input.selfEmployed, f);
  const eligibleOwn = input.dbPension + (input.age >= 65 ? input.registeredWithdrawal : 0);
  const registeredOrdinary =
    input.age >= 65 ? 0 : input.registeredWithdrawal;
  const pensionAfter = Math.max(0, eligibleOwn - input.splitOut);
  const dbAfter = Math.max(0, input.dbPension - Math.min(input.splitOut, input.dbPension));
  const taxableDividends = Math.max(0, input.eligibleDividends) * ELIGIBLE_GROSSUP;
  const taxableGain = Math.max(0, input.capitalGain) * 0.5;

  const netIncome = Math.max(
    0,
    input.employment +
      pensionAfter +
      input.splitInDb +
      input.splitInRrif +
      registeredOrdinary +
      input.cpp +
      input.oas +
      Math.max(0, input.interest) +
      taxableDividends +
      taxableGain +
      Math.max(0, input.otherIncome) -
      Math.max(0, input.rrspDeduction) -
      Math.max(0, input.fhsaDeduction) -
      pay.deduction,
  );

  const oasThreshold = 95_323 * f;
  const clawback =
    input.oas > 0 ? Math.min(input.oas, 0.15 * Math.max(0, netIncome - oasThreshold)) : 0;
  const taxableIncome = Math.max(0, netIncome - clawback);

  const fedBrackets = indexedBrackets(FEDERAL_BRACKETS, f);
  const onBrackets = indexedBrackets(ONTARIO_BRACKETS, f);
  let federal = taxOn(taxableIncome, fedBrackets);
  let ontario = taxOn(taxableIncome, onBrackets);

  const bpa = basicPersonal(netIncome, f);
  const ageAmt =
    input.age >= 65
      ? Math.max(0, FED_AGE_MAX * f - 0.15 * Math.max(0, netIncome - AGE_THRESHOLD * f))
      : 0;
  const empAmt =
    !input.selfEmployed && input.employment > 0
      ? Math.min(input.employment, FED_EMPLOYMENT_MAX * f)
      : 0;
  const receivedForCredit =
    (input.age >= 65 ? input.splitInDb + input.splitInRrif : input.splitInDb) +
    (input.age >= 65 ? Math.max(0, pensionAfter) : dbAfter);
  const fedPension = Math.min(2_000, Math.max(0, receivedForCredit));
  let spouseAmt = 0;
  if (input.spouseNet != null) {
    spouseAmt = Math.max(0, bpa - Math.max(0, input.spouseNet));
  } else if (input.dependantCredit) {
    spouseAmt = bpa;
  }

  const fedCreditBase = bpa + ageAmt + empAmt + fedPension + spouseAmt + pay.creditBase;
  federal = Math.max(0, federal - fedCreditBase * 0.14);
  const fedDtc = taxableDividends * FED_ELIGIBLE_DTC;
  federal = Math.max(0, federal - fedDtc);

  const onBpa = ON_BPA * f;
  const onAge =
    input.age >= 65
      ? Math.max(0, ON_AGE_MAX * f - 0.15 * Math.max(0, netIncome - AGE_THRESHOLD * f))
      : 0;
  const onPension = Math.min(ON_PENSION_MAX * f, Math.max(0, receivedForCredit));
  let onSpouse = 0;
  if (input.spouseNet != null) onSpouse = Math.max(0, onBpa - Math.max(0, input.spouseNet));
  else if (input.dependantCredit) onSpouse = onBpa;

  const onCreditBase = onBpa + onAge + onPension + onSpouse + pay.creditBase;
  ontario = Math.max(0, ontario - onCreditBase * 0.0505);
  ontario = Math.max(0, ontario - taxableDividends * ON_ELIGIBLE_DTC);

  const reductionBase = (ON_REDUCTION + ON_REDUCTION_CHILD * input.childrenUnder18) * f;
  const reduction = Math.min(ontario, Math.max(0, 2 * reductionBase - ontario));
  ontario -= reduction;

  const s1 = ON_SURTAX_1 * f;
  const s2 = ON_SURTAX_2 * f;
  let surtax = 0;
  if (ontario > s1) surtax += 0.2 * (ontario - s1);
  if (ontario > s2) surtax += 0.36 * (ontario - s2);
  ontario += surtax;

  const ohp = ontarioHealthPremium(taxableIncome);
  const totalTax = federal + ontario + ohp + clawback;

  return {
    netIncome,
    taxableIncome,
    federal,
    ontario,
    ohp,
    clawback,
    payroll: pay.cash,
    totalTax,
    cppDeduction: pay.deduction,
  };
}

export function taxPerson(input: TaxInput, withMarginal = false): TaxOutput {
  const base = computeOnce(input);
  if (!withMarginal) return { ...base, marginal: 0 };
  const shocked = computeOnce({
    ...input,
    registeredWithdrawal: input.registeredWithdrawal + 1_000,
  });
  return { ...base, marginal: (shocked.totalTax - base.totalTax) / 1_000 };
}

export type HouseholdTax = {
  a: TaxOutput;
  b: TaxOutput | null;
  total: number;
  splitYears: boolean;
};

function eligibleOf(input: TaxInput): number {
  return input.dbPension + (input.age >= 65 ? input.registeredWithdrawal : 0);
}

/** Tries pension-income splits and keeps the one with the lowest combined tax. */
export function taxHousehold(
  a: TaxInput,
  b: TaxInput | null,
  allowSplit: boolean,
): HouseholdTax {
  if (!b) {
    const out = taxPerson({ ...a, spouseNet: null, splitOut: 0, splitInDb: 0, splitInRrif: 0 });
    return { a: out, b: null, total: out.totalTax + out.payroll, splitYears: false };
  }

  const options: { outA: TaxInput; outB: TaxInput; moved: boolean }[] = [];
  const push = (give: 0 | 1 | 2, fraction: number) => {
    const src = give === 1 ? a : b;
    const dstIsA = give === 2;
    const eligible = eligibleOf(src);
    const move = allowSplit ? Math.max(0, eligible) * fraction : 0;
    const dbShare = eligible > 0 ? Math.min(move, src.dbPension) : 0;
    const rrifShare = Math.max(0, move - dbShare);
    const aOut: TaxInput = {
      ...a,
      splitOut: give === 1 ? move : 0,
      splitInDb: dstIsA ? dbShare : 0,
      splitInRrif: dstIsA ? rrifShare : 0,
    };
    const bOut: TaxInput = {
      ...b,
      splitOut: give === 2 ? move : 0,
      splitInDb: give === 1 ? dbShare : 0,
      splitInRrif: give === 1 ? rrifShare : 0,
    };
    options.push({ outA: aOut, outB: bOut, moved: move > 1 });
  };

  push(0, 0);
  if (allowSplit) {
    for (const fraction of [0.25, 0.5]) {
      push(1, fraction);
      push(2, fraction);
    }
  }

  let best: HouseholdTax | null = null;
  for (const opt of options) {
    const netA = computeOnce({ ...opt.outA, spouseNet: 0 }).netIncome;
    const netB = computeOnce({ ...opt.outB, spouseNet: 0 }).netIncome;
    const claimA = netA >= netB;
    const ta = taxPerson({ ...opt.outA, spouseNet: claimA ? netB : null });
    const tb = taxPerson({ ...opt.outB, spouseNet: claimA ? null : netA });
    const total = ta.totalTax + tb.totalTax + ta.payroll + tb.payroll;
    if (!best || total < best.total - 0.5) {
      best = { a: ta, b: tb, total, splitYears: opt.moved };
    }
  }
  return best!;
}

export function rrifFactor(age: number): number {
  if (age < 72) return 0;
  const table: Record<number, number> = {
    72: 0.054,
    73: 0.0553,
    74: 0.0567,
    75: 0.0582,
    76: 0.0598,
    77: 0.0617,
    78: 0.0636,
    79: 0.0658,
    80: 0.0682,
    81: 0.0708,
    82: 0.0738,
    83: 0.0771,
    84: 0.0808,
    85: 0.0851,
    86: 0.0899,
    87: 0.0955,
    88: 0.1021,
    89: 0.1099,
    90: 0.1192,
    91: 0.1306,
    92: 0.1449,
    93: 0.1634,
    94: 0.1879,
  };
  if (age >= 95) return 0.2;
  return table[age] ?? 0.2;
}

export function rrspDollarLimit(yearIndex: number, inflation: number): number {
  if (yearIndex <= 0) return 33_810;
  if (yearIndex === 1) return 35_390;
  return 35_390 * (1 + inflation) ** (yearIndex - 1);
}

export function tfsaDollarLimit(yearIndex: number, inflation: number): number {
  const raw = 7_000 * (1 + inflation) ** yearIndex;
  return Math.max(7_000, Math.round(raw / 500) * 500);
}

/** CPP at 65 in 2026 dollars, calibrated so a 2026 max retiree matches $1,507.65 a month. */
export function estimateCppAt65Real(ageNow: number, retireAge: number, earnings: number): number {
  const birthYear = 2026 - ageNow;
  const raw = rawCpp(birthYear, retireAge, earnings);
  const anchor = rawCpp(1961, 65, 200_000);
  const published = 1_507.65 * 12;
  return (raw / anchor) * published;
}

function rawCpp(birthYear: number, retireAge: number, earnings: number): number {
  const ratio = clamp(earnings / YMPE0, 0, 1);
  const ratio2 = clamp((earnings - YMPE0) / (YAMPE0 - YMPE0), 0, 1);
  const lastContrib = birthYear + retireAge - 1;
  const firstWork = birthYear + 18;
  const enhanceYears = clamp(lastContrib - Math.max(2019, firstWork) + 1, 0, 40);
  const cpp2Years = clamp(lastContrib - Math.max(2024, firstWork) + 1, 0, 40);
  const base = 0.25 * YMPE0 * ratio;
  const enh = (enhanceYears / 40) * (1 / 3 - 0.25) * YMPE0 * ratio;
  const cpp2 = (cpp2Years / 40) * 0.08 * (YAMPE0 - YMPE0) * ratio2;
  return base + enh + cpp2;
}

export function cppFactor(startAge: number): number {
  const age = clamp(startAge, 60, 70);
  if (age >= 65) return 1 + 0.007 * (age - 65) * 12;
  return 1 - 0.006 * (65 - age) * 12;
}

export function oasFactor(startAge: number): number {
  const age = clamp(startAge, 65, 70);
  return 1 + 0.006 * (age - 65) * 12;
}

export const OAS_ANNUAL_65 = 762.5 * 12;
export const GIS_SINGLE = 1_138.9 * 12;
export const GIS_COUPLE_EACH = 685.56 * 12;

export function ontarioLandTransferTax(price: number, firstTime: boolean, toronto: boolean): number {
  const tax = lttBands(price) + (toronto ? lttBands(price) : 0);
  const rebate = (firstTime ? 4_000 : 0) + (toronto && firstTime ? 4_475 : 0);
  return Math.max(0, tax - rebate);
}

function lttBands(price: number): number {
  const bands: [number, number][] = [
    [55_000, 0.005],
    [250_000, 0.01],
    [400_000, 0.015],
    [2_000_000, 0.02],
    [Number.POSITIVE_INFINITY, 0.025],
  ];
  let tax = 0;
  let prev = 0;
  for (const [up, rate] of bands) {
    const slice = Math.min(price, up) - prev;
    if (slice > 0) tax += slice * rate;
    if (price <= up) break;
    prev = up;
  }
  return tax;
}

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
