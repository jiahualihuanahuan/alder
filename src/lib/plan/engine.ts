import type { MeltMode, PlanInput, PlanResult, Strategy, YearPerson, YearRow } from "./types";
import { sampleCouple } from "./defaults";
import {
  clamp,
  cppFactor,
  estimateCppAt65Real,
  GIS_COUPLE_EACH,
  GIS_SINGLE,
  OAS_ANNUAL_65,
  oasFactor,
  ontarioLandTransferTax,
  rrifFactor,
  rrspDollarLimit,
  taxHousehold,
  taxPerson,
  tfsaDollarLimit,
  type TaxInput,
} from "./tax";

type Acc = {
  rrsp: number;
  spousal: number;
  log: { y: number; amt: number }[];
  tfsa: number;
  tfsaRoom: number;
  fhsa: number;
  fhsaRoom: number;
  fhsaLife: number;
  fhsaOpen: boolean;
  fhsaYear: number;
  nonReg: number;
  acb: number;
  rrspRoom: number;
  hbp: number;
  hbpStart: number;
  cppAt65: number;
  cppPay: number;
  survivor: number;
  oasBase: number;
  dead: boolean;
};

type Resp = { contrib: number; grant: number; growth: number; cesg: number; life: number };

type Kind = "rrsp" | "tfsa" | "nonreg";

const HBP_CAP = 60_000;
const FHSA_YEAR = 8_000;
const FHSA_LIFE = 40_000;

function num(v: number, fallback = 0): number {
  return Number.isFinite(v) ? v : fallback;
}

function annualPayment(principal: number, rate: number, years: number): number {
  if (principal <= 1) return 0;
  const y = Math.max(1, years);
  if (rate <= 0) return principal / y;
  const r = rate / 12;
  const n = y * 12;
  return principal * (r / (1 - (1 + r) ** -n)) * 12;
}

function amortize(balance: number, payment: number, rate: number): number {
  let b = balance;
  const monthly = payment / 12;
  const r = rate / 12;
  for (let i = 0; i < 12 && b > 0; i++) {
    const interest = b * r;
    const principal = Math.min(b, Math.max(0, monthly - interest));
    b = Math.max(0, b - principal);
  }
  return b;
}

function accrue(
  bal: number,
  acb: number,
  ret: number,
  interestYield: number,
  divYield: number,
  realize: number,
): { bal: number; acb: number; interest: number; div: number; realized: number } {
  const ySum = Math.max(0, interestYield) + Math.max(0, divYield);
  const scale = ySum > ret && ySum > 0 ? Math.max(0, ret) / ySum : 1;
  const interest = bal * interestYield * scale;
  const div = bal * divYield * scale;
  const price = bal * Math.max(0, ret - interestYield * scale - divYield * scale);
  const unrealized = Math.max(0, bal - acb) + Math.max(0, price);
  const realized = unrealized * clamp(realize, 0, 1);
  const next = Math.max(0, bal + interest + div + price);
  const nextAcb = Math.min(next, Math.max(0, acb + interest + div + realized));
  return { bal: next, acb: nextAcb, interest, div, realized };
}

function previewGain(bal: number, acb: number, amount: number): number {
  if (amount <= 0 || bal <= 0) return 0;
  const a = Math.min(amount, bal);
  const acbOut = acb * (a / bal);
  return Math.max(0, a - acbOut);
}

function eatTax(probate: number): number {
  if (probate <= 50_000) return 0;
  return Math.ceil((probate - 50_000) / 1_000) * 15;
}

function blankTax(partial: Partial<TaxInput>): TaxInput {
  return {
    yearIndex: 0,
    inflation: 0.02,
    age: 40,
    employment: 0,
    selfEmployed: false,
    dbPension: 0,
    registeredWithdrawal: 0,
    cpp: 0,
    oas: 0,
    interest: 0,
    eligibleDividends: 0,
    capitalGain: 0,
    rrspDeduction: 0,
    fhsaDeduction: 0,
    otherIncome: 0,
    splitOut: 0,
    splitInDb: 0,
    splitInRrif: 0,
    spouseNet: null,
    dependantCredit: false,
    childrenUnder18: 0,
    ...partial,
  };
}

function recentSpousal(log: { y: number; amt: number }[], year: number): number {
  return log.filter((e) => e.y >= year - 2 && e.y <= year).reduce((s, e) => s + e.amt, 0);
}

export function project(raw: PlanInput, strategy: Strategy): PlanResult {
  const plan = sanitize(raw);
  const P = plan.people.length;
  const inf = plan.inflation;
  const ret = plan.portfolioReturn;

  const acc: Acc[] = plan.people.map((p) => {
    const cppStart = clamp(strategy.cppStart, 60, 70);
    const oasStart = clamp(strategy.oasStart, 65, 70);
    const cppAt65 = Math.max(0, estimateCppAt65Real(p.age, p.retireAge, p.employmentIncome) * p.cppScale);
    const opened = p.fhsa > 0 || p.fhsaContributed > 0;
    return {
      rrsp: Math.max(0, p.rrsp),
      spousal: 0,
      log: [],
      tfsa: Math.max(0, p.tfsa),
      tfsaRoom: Math.max(0, p.tfsaRoom),
      fhsa: Math.max(0, p.fhsa),
      fhsaRoom: opened ? Math.min(FHSA_YEAR, Math.max(0, FHSA_LIFE - p.fhsaContributed)) : 0,
      fhsaLife: Math.max(0, p.fhsaContributed),
      fhsaOpen: opened,
      fhsaYear: opened ? -5 : -1,
      nonReg: Math.max(0, p.nonReg),
      acb: clamp(p.nonRegAcb, 0, Math.max(0, p.nonReg)),
      rrspRoom: Math.max(0, p.rrspRoom),
      hbp: 0,
      hbpStart: -1,
      cppAt65,
      cppPay: cppAt65 * cppFactor(cppStart),
      survivor: 0,
      oasBase: OAS_ANNUAL_65 * clamp(p.yearsInCanada / 40, 0, 1) * oasFactor(oasStart),
      dead: false,
    };
  });

  const resp: Resp[] = plan.children.map(() => ({ contrib: 0, grant: 0, growth: 0, cesg: 0, life: 0 }));

  let homeOwned = plan.ownsHome;
  let homeValue = plan.ownsHome ? Math.max(0, plan.homeValue) : 0;
  let mortgage = plan.ownsHome ? Math.max(0, plan.mortgage) : 0;
  let mortgagePay = annualPayment(mortgage, plan.mortgageRate, plan.amortYears);

  const retireMarginal = taxPerson(
    blankTax({
      age: 70,
      registeredWithdrawal: plan.retirementSpendingToday / P * 0.45,
      cpp: 12_000,
      oas: 9_000,
      spouseNet: P > 1 ? 40_000 : null,
    }),
    true,
  ).marginal;

  let lifetimeTax = 0;
  let lifetimeTaxToday = 0;
  let terminalTax = 0;
  let clawback = 0;
  let shortfall = 0;
  let shortfallToday = 0;
  let respGrants = 0;
  let fhsaWithdrawn = 0;
  let hbpUsed = 0;
  let spousalContrib = 0;
  let meltdown = 0;
  let pensionSplitYears = 0;
  let eat = 0;
  let homeDraw = 0;
  let estateNominal = 0;
  let estateToday = 0;
  let estateSet = false;
  const years: YearRow[] = [];

  const cppStartAge = acc.map(() => clamp(strategy.cppStart, 60, 70));
  const oasStartAge = acc.map(() => clamp(strategy.oasStart, 65, 70));

  for (let y = 0; y < 75; y++) {
    const f = (1 + inf) ** y;
    const ages = plan.people.map((p, i) => (acc[i]!.dead ? p.age + y : p.age + y));
    const alive = acc.map((a, i) => !a.dead && ages[i]! <= plan.people[i]!.lifeExpectancy);
    if (alive.every((v) => !v)) break;

    const openingRrsp = acc.map((a) => a.rrsp + a.spousal);
    const rrifMin = openingRrsp.map((bal, i) =>
      alive[i] && ages[i]! >= 72 ? Math.min(bal, bal * rrifFactor(ages[i]!)) : 0,
    );

    const yields = acc.map((a) => {
      if (!alive[acc.indexOf(a)] && false) return accrue(0, 0, 0, 0, 0, 0);
      return { interest: 0, div: 0, realized: 0 };
    });

    for (let i = 0; i < P; i++) {
      if (!alive[i]) continue;
      const a = acc[i]!;
      if ((a.fhsaOpen && ages[i]! >= 71) || (a.fhsaOpen && a.fhsaYear >= 0 && y - a.fhsaYear >= 15)) {
        a.rrsp += a.fhsa;
        a.fhsa = 0;
        a.fhsaRoom = 0;
        a.fhsaOpen = false;
      }
      a.rrsp *= 1 + ret;
      a.spousal *= 1 + ret;
      a.tfsa *= 1 + ret;
      a.fhsa *= 1 + ret;
      const g = accrue(a.nonReg, a.acb, ret, plan.interestYield, plan.eligibleDividendYield, plan.gainRealization);
      a.nonReg = g.bal;
      a.acb = g.acb;
      yields[i] = { interest: g.interest, div: g.div, realized: g.realized };
    }

    for (const r of resp) {
      const g = (r.contrib + r.grant + r.growth) * ret;
      r.growth += g;
    }

    if (homeOwned) {
      homeValue *= 1 + plan.homeGrowth;
      mortgage = amortize(mortgage, mortgagePay, plan.mortgageRate);
    }

    const salary = plan.people.map((p, i) => {
      if (!alive[i] || ages[i]! >= p.retireAge) return 0;
      let pay = p.employmentIncome * (1 + p.incomeGrowth) ** y;
      for (const ev of plan.events) {
        if (ev.kind !== "income-shock") continue;
        if (ev.person !== i) continue;
        if (y >= ev.yearOffset && y < ev.yearOffset + Math.max(1, ev.years)) {
          pay *= 1 - clamp(ev.dropPercent, 0, 1);
        }
      }
      return Math.max(0, pay);
    });

    let eventCost = 0;
    let eventIn = 0;
    for (const ev of plan.events) {
      const dollars = ev.amountToday * f;
      if (ev.kind === "cost" && y === ev.yearOffset) eventCost += dollars;
      if (ev.kind === "inflow" && y === ev.yearOffset) eventIn += dollars;
    }

    let eduCost = 0;
    let eduCash = 0;
    let studentTax = 0;
    plan.children.forEach((child, ci) => {
      const cage = child.age + y;
      const r = resp[ci];
      if (!r) return;
      if (cage < child.schoolAge || cage >= child.schoolAge + child.yearsInSchool) return;
      const cost = child.annualCostToday * f;
      eduCost += cost;
      const pot = r.contrib + r.grant + r.growth;
      const take = Math.min(pot, cost);
      const eapPool = r.grant + r.growth;
      const eap = Math.min(eapPool, take);
      if (eapPool > 0) {
        const gShare = r.growth / eapPool;
        r.growth = Math.max(0, r.growth - eap * gShare);
        r.grant = Math.max(0, r.grant - eap * (1 - gShare));
      }
      const fromContrib = take - eap;
      r.contrib = Math.max(0, r.contrib - fromContrib);
      eduCash += take;
      if (eap > 100) {
        studentTax += taxPerson(
          blankTax({ yearIndex: y, inflation: inf, age: cage, otherIncome: eap, dependantCredit: false }),
        ).totalTax;
      }
    });

    let purchaseShort = 0;
    if (!homeOwned && plan.purchaseEnabled && y === plan.purchaseYear && alive.some(Boolean)) {
      const price = plan.purchasePriceToday * (1 + plan.homeGrowth) ** y;
      const ltt = ontarioLandTransferTax(price, plan.firstTimeBuyer, plan.toronto);
      const minDown = price * 0.05;
      const targetDown = price * clamp(plan.downPercent, 0.05, 1);
      const desired = ltt + targetDown;
      const pool =
        (strategy.useFhsa ? acc.reduce((s, a) => s + a.fhsa, 0) : 0) +
        (strategy.useHbp ? acc.reduce((s, a) => s + Math.min(HBP_CAP, a.rrsp + a.spousal), 0) : 0) +
        acc.reduce((s, a, i) => s + (alive[i] ? a.tfsa + a.nonReg : 0), 0);
      if (pool + 1 < ltt + minDown) {
        purchaseShort = desired - pool;
      } else {
        let need = desired;
        const take = (get: () => number, set: (n: number) => void) => {
          if (need <= 0) return;
          const have = get();
          const use = Math.min(have, need);
          set(have - use);
          need -= use;
          return use;
        };
        if (strategy.useFhsa) {
          for (const a of acc) {
            const used =
              take(
                () => a.fhsa,
                (n) => {
                  a.fhsa = n;
                },
              ) ?? 0;
            fhsaWithdrawn += used;
          }
        }
        if (strategy.useHbp) {
          for (const a of acc) {
            const cap = Math.min(HBP_CAP, a.rrsp + a.spousal);
            const use = Math.min(cap, Math.max(0, need));
            let left = use;
            const fromOwn = Math.min(a.rrsp, left);
            a.rrsp -= fromOwn;
            left -= fromOwn;
            const fromSp = Math.min(a.spousal, left);
            a.spousal -= fromSp;
            a.hbp += use;
            if (use > 0 && a.hbpStart < 0) a.hbpStart = y + 2;
            need -= use;
            hbpUsed += use;
          }
        }
        for (const a of acc) {
          const used =
            take(
              () => a.tfsa,
              (n) => {
                a.tfsa = n;
              },
            ) ?? 0;
          void used;
        }
        for (let i = 0; i < P; i++) {
          const a = acc[i]!;
          if (need <= 0) break;
          const use = Math.min(a.nonReg, need);
          const gain = previewGain(a.nonReg, a.acb, use);
          const portion = a.nonReg > 0 ? use / a.nonReg : 0;
          a.acb = Math.max(0, a.acb * (1 - portion));
          a.nonReg -= use;
          yields[i]!.realized += gain;
          need -= use;
        }
        const paid = desired - need;
        const actualDown = Math.max(0, Math.min(targetDown, paid - ltt));
        homeOwned = true;
        homeValue = price;
        mortgage = Math.max(0, price - actualDown);
        mortgagePay = annualPayment(mortgage, plan.mortgageRate, plan.amortYears);
        for (const a of acc) {
          a.rrsp += a.fhsa;
          a.fhsa = 0;
          a.fhsaRoom = 0;
          a.fhsaOpen = false;
        }
        if (need > 1 && need > targetDown - minDown) purchaseShort += need;
      }
    }

    for (let i = 0; i < P; i++) rrifMin[i] = Math.min(rrifMin[i]!, acc[i]!.rrsp + acc[i]!.spousal);

    const anyWorking = salary.some((s) => s > 500);
    const survivors = alive.filter(Boolean).length;
    const spendReal = anyWorking ? plan.spendingToday : plan.retirementSpendingToday;
    const lifestyle = spendReal * f * (P > 1 && survivors === 1 ? 0.7 : 1);
    const housing = homeOwned ? homeValue * plan.ownerCostRate + mortgagePay : plan.rentToday * f;
    const need = lifestyle + housing + eventCost + eduCost;

    const hbpDue = acc.map((a) => {
      if (a.hbp <= 0 || a.hbpStart < 0 || y < a.hbpStart) return 0;
      const elapsed = y - a.hbpStart;
      const left = Math.max(1, 15 - elapsed);
      return a.hbp / left;
    });

    const spend: Record<Kind, number[]> = {
      rrsp: Array(P).fill(0),
      tfsa: Array(P).fill(0),
      nonreg: Array(P).fill(0),
    };
    const extra = Array(P).fill(0);
    let savings = 0;
    const hbpPaid = hbpDue.slice();
    const hbpInc = Array(P).fill(0);
    let melted = false;
    let gap = 0;
    let taxes = taxHousehold(blankTax({ yearIndex: y, inflation: inf }), P > 1 ? blankTax({ yearIndex: y, inflation: inf }) : null, false);
    let gis = Array(P).fill(0);
    let lastInputs: TaxInput[] = [blankTax({ yearIndex: y, inflation: inf })];
    const marginals = plan.people.map((p, i) =>
      taxPerson(
        blankTax({
          yearIndex: y,
          inflation: inf,
          age: ages[i],
          employment: salary[i],
          selfEmployed: p.selfEmployed,
          dbPension: alive[i] && ages[i]! >= p.retireAge ? p.dbPensionToday * f : 0,
          cpp: alive[i] && ages[i]! >= cppStartAge[i]! ? (acc[i]!.cppPay + acc[i]!.survivor) * f : 0,
          oas: alive[i] && ages[i]! >= oasStartAge[i]! ? acc[i]!.oasBase * f * (ages[i]! >= 75 ? 1.1 : 1) : 0,
          spouseNet: P > 1 ? salary[1 - i]! : null,
        }),
        true,
      ).marginal,
    );
    let contrib = deploy(plan, strategy, acc, resp, alive, ages, salary, 0, y, f, retireMarginal, marginals, homeOwned);

    const roomOf = (i: number, kind: Kind): number => {
      const a = acc[i]!;
      if (!alive[i]) return 0;
      if (kind === "tfsa") return Math.max(0, a.tfsa - spend.tfsa[i]!);
      if (kind === "nonreg") return Math.max(0, a.nonReg - spend.nonreg[i]!);
      const blocked = recentSpousal(a.log, y) > 0;
      const bal = a.rrsp + (blocked ? 0 : a.spousal);
      return Math.max(0, bal - rrifMin[i]! - spend.rrsp[i]! - extra[i]!);
    };

    const proxy = (i: number) =>
      salary[i]! + (ages[i]! >= cppStartAge[i]! ? acc[i]!.cppPay : 0) + spend.rrsp[i]! + extra[i]! + rrifMin[i]!;

    const pick = (kind: Kind): number => {
      const ids = [];
      for (let i = 0; i < P; i++) if (roomOf(i, kind) > 1) ids.push(i);
      if (!ids.length) return -1;
      if (kind === "nonreg" && strategy.id === "alder") {
        ids.sort((a, b) => {
          const ra = acc[a]!.nonReg > 0 ? acc[a]!.acb / acc[a]!.nonReg : 0;
          const rb = acc[b]!.nonReg > 0 ? acc[b]!.acb / acc[b]!.nonReg : 0;
          return rb - ra;
        });
      } else if (kind === "rrsp" && strategy.id === "alder") {
        ids.sort((a, b) => proxy(a) - proxy(b));
      } else {
        ids.sort((a, b) => roomOf(b, kind) - roomOf(a, kind));
      }
      return ids[0]!;
    };

    const addSpend = (amount: number, order: Kind[]) => {
      let left = amount;
      let guard = 0;
      while (left > 1 && guard++ < 12) {
        let moved = false;
        for (const kind of order) {
          const i = pick(kind);
          if (i < 0) continue;
          const use = Math.min(left, roomOf(i, kind));
          spend[kind][i] = (spend[kind][i] ?? 0) + use;
          left -= use;
          moved = true;
          if (left <= 1) break;
        }
        if (!moved) break;
      }
    };

    const reduceSpend = (amount: number): number => {
      let left = amount;
      const kinds: Kind[] = ["tfsa", "nonreg", "rrsp"];
      for (const kind of kinds) {
        for (let i = 0; i < P && left > 0; i++) {
          const have = spend[kind][i] ?? 0;
          const cut = Math.min(have, left);
          spend[kind][i] = have - cut;
          left -= cut;
        }
      }
      return amount - left;
    };

    const orderFor = (): Kind[] => {
      if (strategy.id === "habit" || strategy.meltdown === "none") return ["nonreg", "tfsa", "rrsp"];
      return ["rrsp", "nonreg", "tfsa"];
    };

    for (let iter = 0; iter < 10; iter++) {
      contrib = deploy(plan, strategy, acc, resp, alive, ages, salary, savings, y, f, retireMarginal, marginals, homeOwned);
      const reg = Array(P).fill(0);
      const attributedTo = Array(P).fill(0);
      for (let i = 0; i < P; i++) {
        const total = rrifMin[i]! + spend.rrsp[i]! + extra[i]!;
        const a = acc[i]!;
        const fromOwn = Math.min(a.rrsp, total);
        const fromSp = Math.min(a.spousal, Math.max(0, total - fromOwn));
        const attributed = Math.min(fromSp, recentSpousal(a.log, y));
        reg[i] = fromOwn + fromSp - attributed;
        if (P > 1 && attributed > 0) attributedTo[1 - i] = (attributedTo[1 - i] ?? 0) + attributed;
      }

      const cppAmt = acc.map((a, i) =>
        alive[i] && ages[i]! >= cppStartAge[i]! ? (a.cppPay + a.survivor) * f : 0,
      );
      if (strategy.cppShare && P > 1 && cppAmt[0]! > 0 && cppAmt[1]! > 0) {
        const avg = (cppAmt[0]! + cppAmt[1]!) / 2;
        cppAmt[0] = avg;
        cppAmt[1] = avg;
      }

      const inputs: TaxInput[] = acc.map((a, i) =>
        blankTax({
          yearIndex: y,
          inflation: inf,
          age: ages[i]!,
          employment: alive[i] ? salary[i]! : 0,
          selfEmployed: plan.people[i]!.selfEmployed,
          dbPension: alive[i] && ages[i]! >= plan.people[i]!.retireAge ? plan.people[i]!.dbPensionToday * f : 0,
          registeredWithdrawal: alive[i] ? reg[i]! + attributedTo[i]! : 0,
          rrspDeduction: contrib.rrspDeduct[i]!,
          fhsaDeduction: contrib.fhsa[i]!,
          cpp: cppAmt[i]!,
          oas:
            alive[i] && ages[i]! >= oasStartAge[i]!
              ? a.oasBase * f * (ages[i]! >= 75 ? 1.1 : 1)
              : 0,
          interest: alive[i] ? yields[i]!.interest : 0,
          eligibleDividends: alive[i] ? yields[i]!.div : 0,
          capitalGain: alive[i] ? yields[i]!.realized + previewGain(a.nonReg, a.acb, spend.nonreg[i]!) : 0,
          otherIncome: hbpInc[i]!,
          dependantCredit: P === 1 && plan.children.some((c) => c.age + y < 18),
          childrenUnder18: plan.children.filter((c) => c.age + y < 18).length,
        }),
      );
      lastInputs = inputs;

      taxes = taxHousehold(inputs[0]!, P > 1 ? inputs[1]! : null, strategy.pensionSplit && P > 1);
      if (taxes.splitYears) {
        /* counted once after the loop */
      }

      const bothOas =
        P > 1 &&
        alive[0] &&
        alive[1] &&
        ages[0]! >= oasStartAge[0]! &&
        ages[1]! >= oasStartAge[1]! &&
        ages[0]! >= 65 &&
        ages[1]! >= 65;
      gis = inputs.map((input, i) => {
        if (!alive[i] || ages[i]! < 65 || ages[i]! < oasStartAge[i]!) return 0;
        const other = Math.max(0, (i === 0 ? taxes.a.netIncome : taxes.b?.netIncome ?? 0) - input.oas);
        if (bothOas) {
          const otherB = Math.max(0, (taxes.b?.netIncome ?? 0) - (inputs[1]?.oas ?? 0));
          const otherA = Math.max(0, taxes.a.netIncome - (inputs[0]?.oas ?? 0));
          return Math.max(0, GIS_COUPLE_EACH * f - 0.25 * (otherA + otherB));
        }
        const spouseOther =
          P > 1
            ? Math.max(0, (i === 0 ? taxes.b?.netIncome ?? 0 : taxes.a.netIncome) - (inputs[1 - i]?.oas ?? 0))
            : 0;
        return Math.max(0, GIS_SINGLE * f - 0.5 * (other + spouseOther));
      });

      const withdrawCash =
        reg.reduce((s, v) => s + v, 0) +
        attributedTo.reduce((s, v) => s + v, 0) +
        spend.tfsa.reduce((s, v) => s + v, 0) +
        spend.nonreg.reduce((s, v) => s + v, 0);
      const cashIn =
        salary.reduce((s, v) => s + v, 0) +
        inputs.reduce((s, input) => s + input.dbPension + input.cpp + input.oas, 0) +
        gis.reduce((s, v) => s + v, 0) +
        eventIn +
        eduCash +
        withdrawCash;
      const incomeTax = taxes.a.totalTax + (taxes.b?.totalTax ?? 0) + studentTax;
      const payroll = taxes.a.payroll + (taxes.b?.payroll ?? 0);
      const cashOut = incomeTax + payroll + need + savings + hbpPaid.reduce((s, v) => s + v, 0);
      gap = cashOut - cashIn;

      if (gap > 80) {
        const payable = hbpPaid.reduce((s, v) => s + v, 0);
        if (payable > 1 && iter >= 1) {
          let drop = Math.min(payable, gap);
          for (let i = 0; i < P && drop > 0; i++) {
            const cut = Math.min(hbpPaid[i]!, drop);
            hbpPaid[i] = (hbpPaid[i] ?? 0) - cut;
            hbpInc[i] = (hbpInc[i] ?? 0) + cut;
            drop -= cut;
          }
        } else {
          addSpend(gap, orderFor());
        }
      } else if (gap < -80) {
        const undone = reduceSpend(Math.min(spend.rrsp.reduce((s, v) => s + v, 0) + spend.tfsa.reduce((s, v) => s + v, 0) + spend.nonreg.reduce((s, v) => s + v, 0), -gap));
        const leftSurplus = -gap - undone;
        if (leftSurplus > 80) savings += leftSurplus;
      }

      if (!melted && strategy.meltdown !== "none" && iter >= 5 && gap < 500) {
        for (let i = 0; i < P; i++) {
          if (!alive[i] || ages[i]! < plan.people[i]!.retireAge) continue;
          const net = i === 0 ? taxes.a.netIncome : taxes.b?.netIncome ?? 0;
          const target =
            strategy.meltdown === "bracket" || ages[i]! < oasStartAge[i]!
              ? 117_045 * f
              : 95_323 * f - 1_500;
          const room = roomOf(i, "rrsp");
          extra[i] = clamp(target - net, 0, room);
          meltdown += extra[i]!;
        }
        melted = true;
      }
    }

    if (taxes.splitYears) pensionSplitYears += 1;

    respGrants += contrib.grants;
    spousalContrib += contrib.spousal;
    contrib.childContrib.forEach((amt, ci) => {
      const r = resp[ci];
      if (!r || amt <= 0) return;
      r.contrib += amt;
      r.life += amt;
      r.grant += contrib.childGrant[ci] ?? 0;
      r.cesg += contrib.childGrant[ci] ?? 0;
    });

    if (gap > 40) {
      const drawn = () =>
        spend.rrsp.reduce((s, v) => s + v, 0) +
        spend.tfsa.reduce((s, v) => s + v, 0) +
        spend.nonreg.reduce((s, v) => s + v, 0);
      const before = drawn();
      addSpend(gap, ["nonreg", "tfsa", "rrsp"]);
      gap -= drawn() - before;
    }
    if (gap > 40 && homeOwned) {
      const cap = Math.max(0, homeValue * 0.65 - mortgage);
      const draw = Math.min(gap, cap);
      if (draw > 0) {
        mortgage += draw;
        mortgagePay = annualPayment(mortgage, plan.mortgageRate, Math.max(8, plan.amortYears));
        homeDraw += draw;
        gap -= draw;
      }
    }

    // Apply draws, repayments, contributions.
    for (let i = 0; i < P; i++) {
      if (!alive[i]) continue;
      const a = acc[i]!;
      const totalR = rrifMin[i]! + spend.rrsp[i]! + extra[i]!;
      let left = Math.min(totalR, a.rrsp + a.spousal);
      const fromOwn = Math.min(a.rrsp, left);
      a.rrsp -= fromOwn;
      left -= fromOwn;
      a.spousal = Math.max(0, a.spousal - left);

      const tf = Math.min(a.tfsa, spend.tfsa[i]!);
      a.tfsa -= tf;
      spend.tfsa[i] = tf;

      const nr = Math.min(a.nonReg, spend.nonreg[i]!);
      const portion = a.nonReg > 0 ? nr / a.nonReg : 0;
      a.acb = Math.max(0, a.acb * (1 - portion));
      a.nonReg -= nr;
      spend.nonreg[i] = nr;

      const due = hbpDue[i]!;
      if (due > 0) {
        a.hbp = Math.max(0, a.hbp - due);
        a.rrsp += hbpPaid[i]!;
      }

      a.rrsp += contrib.rrspOwn[i]!;
      a.spousal += contrib.rrspSpousal[i]!;
      if (contrib.rrspSpousal[i]! > 0) a.log.push({ y, amt: contrib.rrspSpousal[i]! });
      a.rrspRoom = Math.max(0, a.rrspRoom - contrib.rrspDeduct[i]!);
      a.tfsa += contrib.tfsa[i]!;
      a.tfsaRoom = Math.max(0, a.tfsaRoom - contrib.tfsa[i]!);
      a.fhsa += contrib.fhsa[i]!;
      a.fhsaLife += contrib.fhsa[i]!;
      a.fhsaRoom = Math.max(0, a.fhsaRoom - contrib.fhsa[i]!);
      a.nonReg += contrib.nonreg[i]!;
      a.acb += contrib.nonreg[i]!;

      const earned = salary[i]!;
      const pa =
        plan.people[i]!.employmentIncome > 0
          ? plan.people[i]!.pensionAdjustment * (earned / plan.people[i]!.employmentIncome)
          : 0;
      const newRoom = Math.max(0, Math.min(rrspDollarLimit(y + 1, inf), 0.18 * earned) - pa);
      a.rrspRoom += newRoom;
      a.tfsaRoom += spend.tfsa[i]! + tfsaDollarLimit(y + 1, inf);

      if (a.fhsaOpen) {
        const unused = a.fhsaRoom;
        const carry = Math.min(FHSA_YEAR, unused);
        a.fhsaRoom = Math.min(FHSA_YEAR + carry, Math.max(0, FHSA_LIFE - a.fhsaLife));
      }
    }

    const yearTax = taxes.a.totalTax + (taxes.b?.totalTax ?? 0) + studentTax;
    let yearTerminal = 0;

    const dies = alive.map((v, i) => v && ages[i]! >= plan.people[i]!.lifeExpectancy);
    const staying = dies.map((d, i) => alive[i] && !d);
    if (dies.some(Boolean) && staying.some(Boolean)) {
      const to = staying.findIndex(Boolean);
      dies.forEach((d, i) => {
        if (!d || to < 0) return;
        const s = acc[to]!;
        const a = acc[i]!;
        s.rrsp += a.rrsp + a.spousal + a.fhsa;
        s.tfsa += a.tfsa;
        s.nonReg += a.nonReg;
        s.acb += a.acb;
        const cap = Math.max(s.cppAt65, a.cppAt65, 18_092);
        const add = Math.min(a.cppPay * 0.6, Math.max(0, cap - (s.cppPay + s.survivor)));
        s.survivor += add;
        a.rrsp = a.spousal = a.tfsa = a.fhsa = a.nonReg = a.acb = 0;
        a.dead = true;
      });
    } else if (dies.some(Boolean) && !staying.some(Boolean)) {
      dies.forEach((d, i) => {
        if (!d) return;
        const a = acc[i]!;
        const living = lastInputs[i] ?? blankTax({ yearIndex: y, inflation: inf, age: ages[i] });
        const lumped = taxPerson({
          ...living,
          registeredWithdrawal: living.registeredWithdrawal + a.rrsp + a.spousal,
          capitalGain: living.capitalGain + Math.max(0, a.nonReg - a.acb),
        }).totalTax;
        const base = taxPerson(living).totalTax;
        const inc = Math.max(0, lumped - base);
        yearTerminal += inc;
        const probate = Math.max(0, homeValue - mortgage) + a.nonReg;
        const bill = eatTax(i === dies.findIndex(Boolean) ? probate : a.nonReg);
        eat += bill;
        const liquid = a.rrsp + a.spousal + a.tfsa + a.nonReg + a.fhsa;
        const equity = i === dies.findIndex(Boolean) ? Math.max(0, homeValue - mortgage) : 0;
        const left = liquid + equity - inc - bill;
        estateNominal += Math.max(0, left);
        a.dead = true;
      });
      estateToday = estateNominal / f;
      estateSet = true;
    }

    const yearShort = Math.max(0, gap) + purchaseShort;
    shortfall += yearShort;
    shortfallToday += yearShort / f;
    lifetimeTax += yearTax + yearTerminal;
    lifetimeTaxToday += (yearTax + yearTerminal) / f;
    terminalTax += yearTerminal;
    clawback += taxes.a.clawback + (taxes.b?.clawback ?? 0);

    const people: YearPerson[] = plan.people.map((p, i) => ({
      name: p.name,
      age: ages[i]!,
      alive: alive[i]!,
      salary: salary[i]!,
      cpp: alive[i] && ages[i]! >= cppStartAge[i]! ? (acc[i]!.cppPay + acc[i]!.survivor) * f : 0,
      oas: alive[i] && ages[i]! >= oasStartAge[i]! ? acc[i]!.oasBase * f * (ages[i]! >= 75 ? 1.1 : 1) : 0,
      gis: gis[i]!,
      db: alive[i] && ages[i]! >= p.retireAge ? p.dbPensionToday * f : 0,
      rrspWithdraw: rrifMin[i]! + spend.rrsp[i]! + extra[i]!,
      tfsaWithdraw: spend.tfsa[i]!,
      nonRegWithdraw: spend.nonreg[i]!,
      tax: (i === 0 ? taxes.a.totalTax : taxes.b?.totalTax ?? 0) + (i === 0 ? yearTerminal : 0),
      clawback: i === 0 ? taxes.a.clawback : taxes.b?.clawback ?? 0,
      payroll: i === 0 ? taxes.a.payroll : taxes.b?.payroll ?? 0,
      taxableIncome: i === 0 ? taxes.a.taxableIncome : taxes.b?.taxableIncome ?? 0,
      marginal: marginals[i] ?? 0,
      rrsp: acc[i]!.rrsp + acc[i]!.spousal,
      tfsa: acc[i]!.tfsa,
      fhsa: acc[i]!.fhsa,
      nonReg: acc[i]!.nonReg,
    }));

    years.push({
      year: 2026 + y,
      index: y,
      people,
      lifestyle,
      housing,
      eventCost: eventCost + eduCost,
      tax: yearTax + yearTerminal,
      shortfall: yearShort,
      resp: resp.reduce((s, r) => s + r.contrib + r.grant + r.growth, 0),
      homeEquity: homeOwned ? Math.max(0, homeValue - mortgage) : 0,
      terminalTax: yearTerminal,
      retired: !anyWorking,
    });

    if (estateSet) break;
  }

  if (!estateSet) {
    const last = years.at(-1);
    const f = (1 + inf) ** Math.max(0, (last?.index ?? 0));
    const liquid = acc.reduce((s, a) => s + a.rrsp + a.spousal + a.tfsa + a.nonReg + a.fhsa, 0);
    estateNominal = liquid + Math.max(0, homeValue - mortgage);
    estateToday = estateNominal / f;
  }

  return {
    years,
    lifetimeTax,
    lifetimeTaxToday,
    terminalTax,
    clawback,
    estateNominal,
    estateToday,
    shortfall,
    shortfallToday,
    respGrants,
    fhsaWithdrawn,
    hbpUsed,
    spousalContrib,
    meltdown,
    cppStart: strategy.cppStart,
    oasStart: strategy.oasStart,
    pensionSplitYears,
    eat,
    homeDraw,
  };
}

function deploy(
  plan: PlanInput,
  strategy: Strategy,
  acc: Acc[],
  resp: Resp[],
  alive: boolean[],
  ages: number[],
  salary: number[],
  budgetIn: number,
  y: number,
  f: number,
  retireMarginal: number,
  marginals: number[],
  homeOwned: boolean,
): {
  rrspOwn: number[];
  rrspSpousal: number[];
  rrspDeduct: number[];
  tfsa: number[];
  fhsa: number[];
  nonreg: number[];
  grants: number;
  spousal: number;
  childContrib: number[];
  childGrant: number[];
} {
  const P = plan.people.length;
  const rrspOwn = Array(P).fill(0);
  const rrspSpousal = Array(P).fill(0);
  const rrspDeduct = Array(P).fill(0);
  const tfsa = Array(P).fill(0);
  const fhsa = Array(P).fill(0);
  const nonreg = Array(P).fill(0);
  const childContrib = plan.children.map(() => 0);
  const childGrant = plan.children.map(() => 0);
  let grants = 0;
  let spousal = 0;
  let left = Math.max(0, budgetIn);
  const expectHome = !homeOwned && plan.purchaseEnabled && plan.firstTimeBuyer && y <= plan.purchaseYear;

  const working = (i: number) => alive[i] && ages[i]! < plan.people[i]!.retireAge;

  if (plan.children.length) {
    const family = salary.reduce((s, v) => s + v, 0);
    plan.children.forEach((child, ci) => {
      const r = resp[ci];
      if (!r || left <= 0) return;
      const cage = child.age + y;
      if (cage > 17) return;
      const roomLife = Math.max(0, 50_000 - r.life);
      const want = Math.min(2_500, roomLife, left);
      if (want <= 0) return;
      left -= want;
      const basic = Math.min(want, 2_500) * 0.2;
      const first = Math.min(want, 500);
      let extraG = 0;
      if (family <= 57_375 * f) extraG = first * 0.2;
      else if (family <= 114_750 * f) extraG = first * 0.1;
      const grant = Math.min(Math.max(0, 7_200 - r.cesg), basic + extraG);
      childContrib[ci] = want;
      childGrant[ci] = grant;
      grants += grant;
    });
  }

  const hi = P > 1 && (marginals[1] ?? 0) > (marginals[0] ?? 0) ? 1 : 0;

  const giveFhsa = (i: number) => {
    if (!strategy.useFhsa || !plan.firstTimeBuyer || homeOwned || !alive[i]) return;
    if (ages[i]! >= 71) return;
    const a = acc[i]!;
    const room = a.fhsaOpen
      ? Math.min(a.fhsaRoom, Math.max(0, FHSA_LIFE - a.fhsaLife - (fhsa[i] ?? 0)))
      : Math.min(FHSA_YEAR, Math.max(0, FHSA_LIFE - a.fhsaLife));
    const use = Math.min(left, room);
    if (use <= 0) return;
    if (!a.fhsaOpen) {
      a.fhsaOpen = true;
      a.fhsaYear = y;
      a.fhsaRoom = room;
    }
    fhsa[i] = use;
    left -= use;
  };

  const giveTfsa = (i: number) => {
    if (!alive[i]) return;
    const use = Math.min(left, acc[i]!.tfsaRoom);
    if (use <= 0) return;
    tfsa[i] = (tfsa[i] ?? 0) + use;
    left -= use;
  };

  const giveRrsp = (i: number) => {
    if (!working(i)) return;
    const a = acc[i]!;
    const room = a.rrspRoom - rrspDeduct[i]!;
    const use = Math.min(left, Math.max(0, room));
    if (use <= 0) return;
    const lo = P > 1 ? 1 - hi : 0;
    const route =
      strategy.useSpousal &&
      P > 1 &&
      i === hi &&
      working(hi) &&
      working(lo) &&
      a.rrsp + a.spousal > acc[lo]!.rrsp + acc[lo]!.spousal + 15_000;
    if (route) {
      rrspSpousal[lo] = (rrspSpousal[lo] ?? 0) + use;
      spousal += use;
    } else {
      rrspOwn[i] = (rrspOwn[i] ?? 0) + use;
    }
    rrspDeduct[i] = (rrspDeduct[i] ?? 0) + use;
    left -= use;
  };

  const rrspBeforeTfsa = (i: number) => {
    if (strategy.tfsaFirst) return false;
    return (marginals[i] ?? 0) > retireMarginal + 0.03;
  };

  if (expectHome && strategy.useFhsa) {
    const order = [hi, 1 - hi].filter((i) => i >= 0 && i < P);
    for (const i of order) giveFhsa(i);
  }

  const peopleOrder = [hi, 1 - hi].filter((i, idx, arr) => i >= 0 && i < P && arr.indexOf(i) === idx);
  for (const i of peopleOrder) {
    if (!alive[i]) continue;
    const preferRrsp = rrspBeforeTfsa(i) && working(i);
    if (preferRrsp) {
      giveRrsp(i);
      giveTfsa(i);
    } else {
      giveTfsa(i);
      giveRrsp(i);
    }
    if (!expectHome && strategy.useFhsa && (marginals[i] ?? 0) > retireMarginal + 0.02) giveFhsa(i);
  }

  if (left > 0) {
    const i = peopleOrder.find((id) => alive[id]) ?? 0;
    nonreg[i] = left;
  }

  return { rrspOwn, rrspSpousal, rrspDeduct, tfsa, fhsa, nonreg, grants, spousal, childContrib, childGrant };
}

export function salaryMarginals(raw: PlanInput): number[] {
  const plan = sanitize(raw);
  return plan.people.map((p) => {
    const base = taxPerson(
      blankTax({
        age: p.age,
        employment: p.employmentIncome,
        selfEmployed: p.selfEmployed,
        spouseNet: plan.people.length > 1 ? plan.people.find((o) => o !== p)?.employmentIncome ?? null : null,
      }),
      true,
    );
    return base.marginal;
  });
}

function better(a: PlanResult, b: PlanResult): boolean {
  const shortGap = a.shortfallToday - b.shortfallToday;
  if (a.shortfallToday > 2_500 || b.shortfallToday > 2_500) {
    if (Math.abs(shortGap) > 400) return a.shortfallToday < b.shortfallToday;
  }
  return a.estateToday > b.estateToday + 50;
}

export function advise(raw: PlanInput): { habit: PlanResult; alder: PlanResult; strategy: Strategy } {
  const plan = sanitize(raw);
  const habitS: Strategy = {
    id: "habit",
    cppStart: 65,
    oasStart: 65,
    meltdown: "none",
    useFhsa: false,
    useHbp: false,
    useSpousal: false,
    pensionSplit: false,
    cppShare: false,
    tfsaFirst: true,
  };
  const habit = project(plan, habitS);
  const cppOpts = plan.people.some((p) => p.retireAge <= 60) ? [60, 65, 70] : [65, 70];
  const melts: MeltMode[] = ["none", "oas", "bracket"];
  let best: { r: PlanResult; s: Strategy } | null = null;
  for (const cppStart of cppOpts) {
    for (const oasStart of [65, 70]) {
      for (const meltdown of melts) {
        const s: Strategy = {
          id: "alder",
          cppStart,
          oasStart,
          meltdown,
          useFhsa: true,
          useHbp: true,
          useSpousal: plan.people.length > 1,
          pensionSplit: plan.people.length > 1,
          cppShare: plan.people.length > 1,
          tfsaFirst: false,
        };
        const r = project(plan, s);
        if (!best || better(r, best.r)) best = { r, s };
      }
    }
  }
  return { habit, alder: best!.r, strategy: best!.s };
}

export function sanitize(plan: PlanInput): PlanInput {
  const base = sampleCouple();
  const people = (plan.people?.length ? plan.people : base.people).slice(0, 2).map((p, i) => {
    const d = base.people[i] ?? base.people[0]!;
    const age = clamp(Math.round(num(p.age, d.age)), 18, 80);
    const retireAge = clamp(Math.round(num(p.retireAge, d.retireAge)), age, 75);
    const lifeExpectancy = clamp(Math.round(num(p.lifeExpectancy, d.lifeExpectancy)), retireAge + 1, 105);
    return {
      ...d,
      ...p,
      name: (p.name || d.name).slice(0, 24),
      age,
      retireAge,
      lifeExpectancy,
      employmentIncome: Math.max(0, num(p.employmentIncome)),
      incomeGrowth: clamp(num(p.incomeGrowth, 0.03), -0.05, 0.12),
      dbPensionToday: Math.max(0, num(p.dbPensionToday)),
      pensionAdjustment: Math.max(0, num(p.pensionAdjustment)),
      rrsp: Math.max(0, num(p.rrsp)),
      rrspRoom: Math.max(0, num(p.rrspRoom)),
      tfsa: Math.max(0, num(p.tfsa)),
      tfsaRoom: Math.max(0, num(p.tfsaRoom)),
      fhsa: Math.max(0, num(p.fhsa)),
      fhsaContributed: Math.max(0, num(p.fhsaContributed)),
      nonReg: Math.max(0, num(p.nonReg)),
      nonRegAcb: clamp(num(p.nonRegAcb, num(p.nonReg)), 0, Math.max(0, num(p.nonReg))),
      cppScale: clamp(num(p.cppScale, 1), 0, 1.3),
      yearsInCanada: clamp(num(p.yearsInCanada, 40), 0, 40),
    };
  });
  return {
    ...base,
    ...plan,
    people,
    inflation: clamp(num(plan.inflation, 0.02), 0, 0.08),
    portfolioReturn: clamp(num(plan.portfolioReturn, 0.055), 0, 0.12),
    interestYield: clamp(num(plan.interestYield, 0.008), 0, 0.08),
    eligibleDividendYield: clamp(num(plan.eligibleDividendYield, 0.015), 0, 0.08),
    gainRealization: clamp(num(plan.gainRealization, 0.2), 0, 1),
    spendingToday: Math.max(0, num(plan.spendingToday, 80_000)),
    retirementSpendingToday: Math.max(0, num(plan.retirementSpendingToday, 70_000)),
    homeValue: Math.max(0, num(plan.homeValue)),
    mortgage: Math.max(0, num(plan.mortgage)),
    mortgageRate: clamp(num(plan.mortgageRate, 0.045), 0, 0.12),
    amortYears: clamp(Math.round(num(plan.amortYears, 25)), 5, 30),
    homeGrowth: clamp(num(plan.homeGrowth, 0.03), -0.05, 0.1),
    ownerCostRate: clamp(num(plan.ownerCostRate, 0.015), 0, 0.05),
    rentToday: Math.max(0, num(plan.rentToday)),
    purchaseYear: clamp(Math.round(num(plan.purchaseYear, 4)), 0, 40),
    purchasePriceToday: Math.max(0, num(plan.purchasePriceToday)),
    downPercent: clamp(num(plan.downPercent, 0.2), 0.05, 1),
    children: (plan.children ?? []).slice(0, 4).map((c) => ({
      ...c,
      name: (c.name || "Child").slice(0, 24),
      age: clamp(Math.round(num(c.age, 5)), 0, 25),
      schoolAge: clamp(Math.round(num(c.schoolAge, 18)), 16, 30),
      annualCostToday: Math.max(0, num(c.annualCostToday)),
      yearsInSchool: clamp(Math.round(num(c.yearsInSchool, 4)), 1, 8),
    })),
    events: (plan.events ?? []).slice(0, 8).map((e) => ({
      ...e,
      label: (e.label || "Life event").slice(0, 40),
      yearOffset: clamp(Math.round(num(e.yearOffset)), 0, 50),
      amountToday: Math.max(0, num(e.amountToday)),
      dropPercent: clamp(num(e.dropPercent), 0, 1),
      years: clamp(Math.round(num(e.years, 1)), 1, 8),
      person: e.person === 1 ? 1 : 0,
    })),
  };
}

/** Used by the UI. Keeps the last result if inputs are unchanged. */
export function planKey(plan: PlanInput): string {
  return JSON.stringify(plan);
}
