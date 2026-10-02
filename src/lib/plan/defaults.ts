import type { ChildInput, LifeEvent, PersonInput, PlanInput } from "./types";

export function uid(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}

export const alex = (): PersonInput => ({
  name: "Alex",
  age: 42,
  retireAge: 62,
  lifeExpectancy: 92,
  employmentIncome: 152_000,
  incomeGrowth: 0.03,
  selfEmployed: false,
  dbPensionToday: 0,
  pensionAdjustment: 0,
  rrsp: 186_000,
  rrspRoom: 24_000,
  tfsa: 96_000,
  tfsaRoom: 7_000,
  fhsa: 0,
  fhsaContributed: 0,
  nonReg: 48_000,
  nonRegAcb: 40_000,
  cppScale: 1,
  yearsInCanada: 40,
});

export const jordan = (): PersonInput => ({
  name: "Jordan",
  age: 40,
  retireAge: 63,
  lifeExpectancy: 94,
  employmentIncome: 98_000,
  incomeGrowth: 0.03,
  selfEmployed: false,
  dbPensionToday: 0,
  pensionAdjustment: 0,
  rrsp: 72_000,
  rrspRoom: 16_000,
  tfsa: 81_000,
  tfsaRoom: 7_000,
  fhsa: 0,
  fhsaContributed: 0,
  nonReg: 12_000,
  nonRegAcb: 11_000,
  cppScale: 0.85,
  yearsInCanada: 40,
});

export function child(partial: Partial<ChildInput> = {}): ChildInput {
  return {
    id: uid("c"),
    name: "Maya",
    age: 7,
    schoolAge: 18,
    annualCostToday: 22_000,
    yearsInSchool: 4,
    ...partial,
  };
}

export function lifeEvent(partial: Partial<LifeEvent> = {}): LifeEvent {
  return {
    id: uid("e"),
    label: "Renovation",
    kind: "cost",
    yearOffset: 10,
    amountToday: 30_000,
    dropPercent: 0,
    years: 1,
    person: 0,
    ...partial,
  };
}

export function sampleCouple(): PlanInput {
  return {
    people: [alex(), jordan()],
    inflation: 0.02,
    portfolioReturn: 0.055,
    interestYield: 0.008,
    eligibleDividendYield: 0.015,
    gainRealization: 0.2,
    spendingToday: 84_000,
    retirementSpendingToday: 78_000,
    ownsHome: false,
    homeValue: 0,
    mortgage: 0,
    mortgageRate: 0.045,
    amortYears: 25,
    homeGrowth: 0.03,
    ownerCostRate: 0.015,
    rentToday: 36_000,
    firstTimeBuyer: true,
    toronto: false,
    purchaseEnabled: true,
    purchaseYear: 4,
    purchasePriceToday: 980_000,
    downPercent: 0.2,
    children: [child()],
    events: [
      lifeEvent({ id: "roof", label: "Kitchen and roof", yearOffset: 12, amountToday: 45_000 }),
      lifeEvent({ id: "parents", label: "Help parents", yearOffset: 8, amountToday: 12_000 }),
    ],
  };
}

export function sampleSingle(): PlanInput {
  return {
    ...sampleCouple(),
    people: [
      {
        ...alex(),
        name: "Sam",
        age: 45,
        retireAge: 60,
        lifeExpectancy: 90,
        employmentIncome: 240_000,
        selfEmployed: false,
        rrsp: 410_000,
        rrspRoom: 18_000,
        tfsa: 109_000,
        tfsaRoom: 7_000,
        nonReg: 165_000,
        nonRegAcb: 120_000,
        cppScale: 1,
      },
    ],
    spendingToday: 78_000,
    retirementSpendingToday: 72_000,
    ownsHome: true,
    homeValue: 920_000,
    mortgage: 280_000,
    rentToday: 0,
    firstTimeBuyer: false,
    purchaseEnabled: false,
    children: [],
    events: [lifeEvent({ id: "sab", label: "Six-month sabbatical", kind: "income-shock", yearOffset: 6, dropPercent: 0.5, years: 1 })],
  };
}

export function sampleSoon(): PlanInput {
  return {
    ...sampleCouple(),
    people: [
      {
        ...alex(),
        name: "Priya",
        age: 56,
        retireAge: 64,
        lifeExpectancy: 93,
        employmentIncome: 128_000,
        rrsp: 640_000,
        rrspRoom: 12_000,
        tfsa: 118_000,
        tfsaRoom: 7_000,
        nonReg: 210_000,
        nonRegAcb: 150_000,
      },
      {
        ...jordan(),
        name: "Chris",
        age: 54,
        retireAge: 64,
        lifeExpectancy: 91,
        employmentIncome: 74_000,
        rrsp: 220_000,
        rrspRoom: 9_000,
        tfsa: 96_000,
        nonReg: 40_000,
        nonRegAcb: 36_000,
        cppScale: 0.7,
      },
    ],
    spendingToday: 76_000,
    retirementSpendingToday: 72_000,
    ownsHome: true,
    homeValue: 1_150_000,
    mortgage: 190_000,
    rentToday: 0,
    firstTimeBuyer: false,
    purchaseEnabled: false,
    children: [child({ name: "Noah", age: 16, schoolAge: 18, annualCostToday: 18_000 })],
    events: [],
  };
}

export const PRESETS: { id: string; label: string; detail: string; build: () => PlanInput }[] = [
  {
    id: "couple",
    label: "Buying in the GTA",
    detail: "Two incomes, a first home, one child",
    build: sampleCouple,
  },
  {
    id: "single",
    label: "Single high earner",
    detail: "Retire at 60, large RRSP",
    build: sampleSingle,
  },
  {
    id: "soon",
    label: "Ten years out",
    detail: "Couple, house paid down, melt the RRSP",
    build: sampleSoon,
  },
];
