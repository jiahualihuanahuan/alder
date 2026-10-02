export type MeltMode = "none" | "oas" | "bracket";

export type PersonInput = {
  name: string;
  age: number;
  retireAge: number;
  lifeExpectancy: number;
  /** Gross employment income this year, dollars. */
  employmentIncome: number;
  /** Nominal annual pay growth until retirement. */
  incomeGrowth: number;
  selfEmployed: boolean;
  /** Defined-benefit pension in today's dollars, indexed to inflation, paid from retirement. */
  dbPensionToday: number;
  /** Annual pension adjustment that uses up RRSP room. Grows with pay. */
  pensionAdjustment: number;
  rrsp: number;
  rrspRoom: number;
  tfsa: number;
  tfsaRoom: number;
  fhsa: number;
  /** Lifetime FHSA contributions already made. */
  fhsaContributed: number;
  nonReg: number;
  /** Adjusted cost base of the non-registered account. */
  nonRegAcb: number;
  /** Share of the estimated CPP at 65. 1 = the model's career estimate. */
  cppScale: number;
  /** Years resident in Canada after 18, counted by the OAS start date. 40 is a full pension. */
  yearsInCanada: number;
};

export type ChildInput = {
  id: string;
  name: string;
  age: number;
  schoolAge: number;
  annualCostToday: number;
  yearsInSchool: number;
};

export type EventKind = "cost" | "inflow" | "income-shock";

export type LifeEvent = {
  id: string;
  label: string;
  kind: EventKind;
  /** Years from the first plan year. */
  yearOffset: number;
  /** Today's dollars for cost/inflow. For an income shock, unused. */
  amountToday: number;
  /** Income shock: fraction of that person's pay that disappears. */
  dropPercent: number;
  years: number;
  /** 0 or 1. Ignored for household costs. */
  person: number;
};

export type PlanInput = {
  people: PersonInput[];
  inflation: number;
  portfolioReturn: number;
  /** Share of non-registered balance paid as interest / foreign income each year. */
  interestYield: number;
  /** Share of non-registered balance paid as eligible Canadian dividends. */
  eligibleDividendYield: number;
  /** Fraction of unrealized gains realized each year. */
  gainRealization: number;
  /** Household lifestyle spending, excluding housing, in today's dollars. */
  spendingToday: number;
  /** Lifestyle spending once nobody is working, today's dollars. */
  retirementSpendingToday: number;
  ownsHome: boolean;
  homeValue: number;
  mortgage: number;
  mortgageRate: number;
  amortYears: number;
  homeGrowth: number;
  /** Property tax, insurance, and upkeep as a share of home value. */
  ownerCostRate: number;
  /** Annual rent in today's dollars. Stops when a home is bought. */
  rentToday: number;
  firstTimeBuyer: boolean;
  toronto: boolean;
  purchaseEnabled: boolean;
  purchaseYear: number;
  purchasePriceToday: number;
  downPercent: number;
  children: ChildInput[];
  events: LifeEvent[];
};

export type YearPerson = {
  name: string;
  age: number;
  alive: boolean;
  salary: number;
  cpp: number;
  oas: number;
  gis: number;
  db: number;
  rrspWithdraw: number;
  tfsaWithdraw: number;
  nonRegWithdraw: number;
  tax: number;
  clawback: number;
  payroll: number;
  taxableIncome: number;
  marginal: number;
  rrsp: number;
  tfsa: number;
  fhsa: number;
  nonReg: number;
};

export type YearRow = {
  year: number;
  index: number;
  people: YearPerson[];
  lifestyle: number;
  housing: number;
  eventCost: number;
  tax: number;
  shortfall: number;
  resp: number;
  homeEquity: number;
  terminalTax: number;
  retired: boolean;
};

export type PlanResult = {
  years: YearRow[];
  lifetimeTax: number;
  lifetimeTaxToday: number;
  terminalTax: number;
  clawback: number;
  estateNominal: number;
  estateToday: number;
  shortfall: number;
  shortfallToday: number;
  respGrants: number;
  fhsaWithdrawn: number;
  hbpUsed: number;
  spousalContrib: number;
  meltdown: number;
  cppStart: number;
  oasStart: number;
  pensionSplitYears: number;
  eat: number;
  /** Cumulative amount borrowed against the home after portfolios run dry. */
  homeDraw: number;
};

export type Strategy = {
  id: "habit" | "alder";
  cppStart: number;
  oasStart: number;
  meltdown: MeltMode;
  useFhsa: boolean;
  useHbp: boolean;
  useSpousal: boolean;
  pensionSplit: boolean;
  cppShare: boolean;
  /** When true, TFSA is filled before RRSP regardless of bracket. */
  tfsaFirst: boolean;
};
