import { useDeferredValue, useEffect, useMemo, useState, type ReactNode } from "react";
import * as Slider from "@radix-ui/react-slider";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { advise, salaryMarginals } from "@/lib/plan/engine";
import { PRESETS, jordan, lifeEvent, sampleCouple, uid } from "@/lib/plan/defaults";
import { cad, compact, pct } from "@/lib/plan/format";
import { usePlanStore } from "@/lib/plan/store";
import type { LifeEvent, PersonInput, PlanInput, PlanResult } from "@/lib/plan/types";
import { FEDERAL_BRACKETS, ONTARIO_BRACKETS } from "@/lib/plan/tax";

export function Planner() {
  const plan = usePlanStore((s) => s.plan);
  const setPlan = usePlanStore((s) => s.setPlan);
  const update = usePlanStore((s) => s.update);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    void usePlanStore.persist.rehydrate();
    setReady(true);
  }, []);

  const deferred = useDeferredValue(plan);
  const result = useMemo(() => {
    try {
      return advise(deferred);
    } catch {
      return null;
    }
  }, [deferred]);

  const marginals = useMemo(() => salaryMarginals(plan), [plan]);

  return (
    <main className="min-h-screen bg-paper text-ink">
      <header className="border-b border-line">
        <div className="mx-auto flex max-w-6xl flex-wrap items-end justify-between gap-4 px-4 py-5">
          <div className="flex items-center gap-3">
            <Mark />
            <div>
              <h1 className="font-display text-3xl leading-none text-ink">Alder</h1>
              <p className="mt-1 text-sm text-muted">Whole-life tax plan for Ontario</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setPlan(p.build())}
                className="min-h-11 rounded-full border border-line bg-card px-4 text-sm text-ink transition-colors duration-150 hover:border-pine"
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-8 px-4 py-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
        {ready ? (
          <form
            className="order-2 flex flex-col gap-3 lg:order-1"
            onSubmit={(e) => e.preventDefault()}
          >
            <Editor plan={plan} update={update} marginals={marginals} />
          </form>
        ) : (
          <div className="order-2 h-24 lg:order-1" />
        )}
        <section className={`order-1 flex min-w-0 flex-col gap-6 transition-opacity duration-150 lg:order-2 ${deferred !== plan ? "opacity-60" : ""}`}>
          {result ? (
            <Results plan={plan} habit={result.habit} alder={result.alder} cpp={result.strategy.cppStart} oas={result.strategy.oasStart} melt={result.strategy.meltdown} ready={ready} />
          ) : (
            <p className="text-brick">This plan could not be calculated. Check the ages and amounts.</p>
          )}
        </section>
      </div>
    </main>
  );
}

function Mark() {
  return (
    <svg viewBox="0 0 32 32" className="h-9 w-9" aria-hidden>
      <rect width="32" height="32" rx="7" className="fill-pine" />
      <path d="M16 5.5c1.8 3.6 5.5 5.6 5.5 9.4a5.5 5.5 0 1 1-11 0c0-3.8 3.7-5.8 5.5-9.4z" className="fill-paper" />
    </svg>
  );
}

function Results({
  plan,
  habit,
  alder,
  cpp,
  oas,
  melt,
  ready,
}: {
  plan: PlanInput;
  habit: PlanResult;
  alder: PlanResult;
  cpp: number;
  oas: number;
  melt: string;
  ready: boolean;
}) {
  const saved = habit.lifetimeTaxToday - alder.lifetimeTaxToday;
  const estateGap = alder.estateToday - habit.estateToday;
  const short = alder.shortfallToday > 2_500;
  const moves = buildMoves(plan, habit, alder, cpp, oas, melt);

  const balance = alder.years.map((y) => ({
    year: String(y.year),
    Registered: y.people.reduce((s, p) => s + p.rrsp + p.fhsa, 0),
    TFSA: y.people.reduce((s, p) => s + p.tfsa, 0),
    Taxable: y.people.reduce((s, p) => s + p.nonReg, 0) + y.resp,
    Home: y.homeEquity,
  }));
  const taxes = alder.years.map((y, i) => ({
    year: String(y.year),
    Alder: y.tax,
    Habit: habit.years[i]?.tax ?? 0,
  }));

  return (
    <>
      <div>
        <p className="max-w-2xl text-pretty text-muted">
          Two paths, same life. Habit fills the TFSA, then the RRSP, takes CPP and OAS at 65, and spends taxable money first.
          Alder uses the Ontario tools that actually change the lifetime bill, and keeps the one that leaves more after tax.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Kpi label="Lifetime tax, today's dollars" value={cad(alder.lifetimeTaxToday)} note={`${cad(alder.lifetimeTax)} in future dollars, including tax at death`} />
        <Kpi
          label={saved >= 0 ? "Tax avoided versus habit" : "Tax above the habit path"}
          value={cad(Math.abs(saved))}
          note={estateGap >= 0 ? `${cad(estateGap)} more left at the end` : `${cad(Math.abs(estateGap))} less left at the end`}
        />
        <Kpi label="Left at the end, today's dollars" value={cad(alder.estateToday)} note={`Nominal estate ${cad(alder.estateNominal)}`} />
        <Kpi
          label={short ? "Spending not covered" : "OAS repaid over the whole life"}
          value={short ? cad(alder.shortfallToday) : cad(alder.clawback)}
          note={short ? "Lower spending, retire later, or save more" : `Habit path repays ${cad(habit.clawback)}`}
          warn={short}
        />
      </div>

      <p className="text-sm text-ink">
        This path starts CPP at {cpp} and OAS at {oas}
        {melt === "none" ? ", without an extra RRSP meltdown" : melt === "oas" ? ", and stops registered withdrawals at the OAS clawback line" : ", and fills the federal 20.5% band with registered withdrawals"}.
        Pension splitting {alder.pensionSplitYears > 0 ? `runs in ${alder.pensionSplitYears} years` : "does not help here"}.
      </p>

      <ul className="grid gap-3 sm:grid-cols-2">
        {moves.map((m) => (
          <li key={m.title} className="rounded-lg border border-line bg-card p-4">
            <h2 className="font-display text-lg text-ink">{m.title}</h2>
            <p className="mt-1 text-sm text-pretty text-muted">{m.body}</p>
          </li>
        ))}
      </ul>

      <div className="overflow-x-auto rounded-lg border border-line bg-card">
        <table className="w-full min-w-[32rem] text-left text-sm">
          <thead className="text-muted">
            <tr className="border-b border-line">
              <th className="px-4 py-3 font-medium">Whole life</th>
              <th className="px-4 py-3 font-medium">Habit</th>
              <th className="px-4 py-3 font-medium">Alder</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            <Row label="Lifetime tax, today" a={cad(habit.lifetimeTaxToday)} b={cad(alder.lifetimeTaxToday)} />
            <Row label="Tax at death" a={cad(habit.terminalTax)} b={cad(alder.terminalTax)} />
            <Row label="OAS clawback" a={cad(habit.clawback)} b={cad(alder.clawback)} />
            <Row label="Estate, today" a={cad(habit.estateToday)} b={cad(alder.estateToday)} />
            <Row label="RESP grants" a={cad(habit.respGrants)} b={cad(alder.respGrants)} />
            <Row label="FHSA used for the home" a={cad(habit.fhsaWithdrawn)} b={cad(alder.fhsaWithdrawn)} />
            <Row label="Home Buyers' Plan" a={cad(habit.hbpUsed)} b={cad(alder.hbpUsed)} />
          </tbody>
        </table>
      </div>

      {ready && balance.length > 1 ? (
        <div className="grid gap-4">
          <ChartCard title="What you hold" subtitle="Alder path, nominal dollars">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={balance} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--color-line)" vertical={false} />
                <XAxis dataKey="year" tick={{ fill: "var(--color-faint)", fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={28} />
                <YAxis tickFormatter={(v: number) => compact(v)} tick={{ fill: "var(--color-faint)", fontSize: 12 }} tickLine={false} axisLine={false} width={48} />
                <Tooltip formatter={(v) => cad(Number(v))} contentStyle={tipStyle} />
                <Area type="monotone" dataKey="Home" stackId="1" stroke="var(--color-faint)" fill="var(--color-paper-2)" />
                <Area type="monotone" dataKey="Taxable" stackId="1" stroke="var(--color-ink)" fill="var(--color-line)" />
                <Area type="monotone" dataKey="TFSA" stackId="1" stroke="var(--color-pine-2)" fill="var(--color-mist)" />
                <Area type="monotone" dataKey="Registered" stackId="1" stroke="var(--color-pine)" fill="var(--color-pine)" fillOpacity={0.85} />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>
          <ChartCard title="Tax each year" subtitle="Income tax, health premium, clawback, and the final return">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={taxes} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--color-line)" vertical={false} />
                <XAxis dataKey="year" tick={{ fill: "var(--color-faint)", fontSize: 12 }} tickLine={false} axisLine={false} minTickGap={28} />
                <YAxis tickFormatter={(v: number) => compact(v)} tick={{ fill: "var(--color-faint)", fontSize: 12 }} tickLine={false} axisLine={false} width={48} />
                <Tooltip formatter={(v) => cad(Number(v))} contentStyle={tipStyle} />
                <Line type="monotone" dataKey="Habit" stroke="var(--color-faint)" strokeWidth={1.5} dot={false} />
                <Line type="monotone" dataKey="Alder" stroke="var(--color-pine)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full min-w-[40rem] text-left text-sm tabular-nums">
          <thead className="bg-card text-muted">
            <tr>
              {["Year", "Age", "Work", "CPP + OAS", "Tax", "Registered", "TFSA", "Home"].map((h) => (
                <th key={h} className="px-3 py-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {alder.years.filter((_, i) => i % (alder.years.length > 40 ? 2 : 1) === 0 || alder.years[i]?.terminalTax).map((y) => (
              <tr key={y.year} className="border-t border-line">
                <td className="px-3 py-2">{y.year}</td>
                <td className="px-3 py-2">{y.people.map((p) => (p.alive ? p.age : "—")).join(" / ")}</td>
                <td className="px-3 py-2">{compact(y.people.reduce((s, p) => s + p.salary, 0))}</td>
                <td className="px-3 py-2">{compact(y.people.reduce((s, p) => s + p.cpp + p.oas, 0))}</td>
                <td className={`px-3 py-2 ${y.shortfall > 500 ? "text-brick" : ""}`}>{compact(y.tax)}</td>
                <td className="px-3 py-2">{compact(y.people.reduce((s, p) => s + p.rrsp, 0))}</td>
                <td className="px-3 py-2">{compact(y.people.reduce((s, p) => s + p.tfsa, 0))}</td>
                <td className="px-3 py-2">{y.homeEquity > 0 ? compact(y.homeEquity) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Tools />
      <p className="text-xs text-pretty text-faint">
        Model of 2026 federal and Ontario rates, indexed by your inflation assumption. CPP, OAS, GIS, credits, and the survivor benefit are simplified.
        Not tax, investment, or insurance advice. Your notice of assessment and a planner who knows you are the authorities. Payroll Canada Pension Plan and Employment Insurance contributions are not counted as tax — they buy a benefit.
      </p>
    </>
  );
}

const tipStyle = {
  background: "var(--color-card)",
  border: "1px solid var(--color-line)",
  borderRadius: 8,
  fontSize: 13,
  color: "var(--color-ink)",
};

function ChartCard({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <figure className="rounded-lg border border-line bg-card p-4">
      <figcaption className="mb-3">
        <h2 className="font-display text-xl">{title}</h2>
        <p className="text-sm text-muted">{subtitle}</p>
      </figcaption>
      <div className="h-64">{children}</div>
    </figure>
  );
}

function Kpi({ label, value, note, warn }: { label: string; value: string; note: string; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-card p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className={`mt-1 font-display text-3xl tabular-nums ${warn ? "text-brick" : "text-ink"}`}>{value}</p>
      <p className="mt-1 text-sm text-faint">{note}</p>
    </div>
  );
}

function Row({ label, a, b }: { label: string; a: string; b: string }) {
  return (
    <tr className="border-t border-line">
      <th className="px-4 py-3 font-normal text-muted">{label}</th>
      <td className="px-4 py-3">{a}</td>
      <td className="px-4 py-3 text-ink">{b}</td>
    </tr>
  );
}

function buildMoves(
  plan: PlanInput,
  habit: PlanResult,
  alder: PlanResult,
  cpp: number,
  oas: number,
  melt: string,
): { title: string; body: string }[] {
  const items: { title: string; body: string; rank: number }[] = [];
  const taxGap = habit.lifetimeTaxToday - alder.lifetimeTaxToday;
  if (taxGap > 1000) {
    items.push({
      title: "Pay the tax on purpose",
      rank: taxGap,
      body: `Drawing registered money while ${plan.people.length > 1 ? "both of you are" : "you are"} alive uses today's brackets instead of one brutal year at the end. Tax at death falls from ${cad(habit.terminalTax)} to ${cad(alder.terminalTax)}.`,
    });
  }
  if (cpp === 70) {
    items.push({
      title: "CPP at 70",
      rank: 80_000,
      body: "Waiting raises CPP by 42%. The years in between are bridged with RRSP withdrawals, which is also when that money is cheapest to take.",
    });
  } else if (cpp === 60) {
    items.push({
      title: "CPP at 60",
      rank: 40_000,
      body: "With this life expectancy, starting early keeps more of the pension you already paid for. The cut is 0.6% a month from 65.",
    });
  }
  if (oas === 70) {
    items.push({
      title: "OAS at 70",
      rank: 30_000,
      body: "Deferral adds 36%. Alder only does it when the higher cheque is not handed back through the clawback.",
    });
  }
  if (alder.clawback + 2000 < habit.clawback) {
    items.push({
      title: "Stay under the clawback",
      rank: habit.clawback - alder.clawback,
      body: `OAS recovery starts at $95,323 of net income in 2026 and takes 15 cents on the dollar. This path repays ${cad(alder.clawback)} instead of ${cad(habit.clawback)}.`,
    });
  }
  if (alder.fhsaWithdrawn > 0) {
    items.push({
      title: "First Home Savings Account",
      rank: alder.fhsaWithdrawn,
      body: `${cad(alder.fhsaWithdrawn)} comes out tax-free for the home. The contributions were deducted on the way in. Unused FHSA money can roll into an RRSP without using new room.`,
    });
  }
  if (alder.hbpUsed > 0) {
    items.push({
      title: "Home Buyers' Plan",
      rank: 50_000,
      body: `${cad(alder.hbpUsed)} leaves the RRSP without tax, up to $60,000 a person. It is repaid over 15 years starting the second year after the withdrawal. A missed repayment is income.`,
    });
  }
  if (alder.spousalContrib > 0) {
    items.push({
      title: "Spousal RRSP",
      rank: alder.spousalContrib,
      body: `${cad(alder.spousalContrib)} is deducted by the higher earner and invested in the other spouse's name. Withdrawals wait out the three-year attribution rule.`,
    });
  }
  if (alder.pensionSplitYears > 0) {
    items.push({
      title: "Pension income split",
      rank: 60_000,
      body: `Eligible pension income, including RRIF withdrawals after 65, is split in ${alder.pensionSplitYears} years — up to half — so the two returns sit in closer brackets. A defined-benefit pension can be split at any age.`,
    });
  }
  if (melt !== "none" && alder.meltdown > 0) {
    items.push({
      title: "Melt the RRSP into the TFSA",
      rank: alder.meltdown * 0.2,
      body: `${cad(alder.meltdown)} is withdrawn beyond what spending needs, taxed in an open bracket, and the net is parked where it will not touch OAS again.`,
    });
  }
  if (alder.homeDraw > 20_000) {
    items.push({
      title: "The house is the backstop",
      rank: alder.homeDraw,
      body: `Financial accounts run out before the plan ends. Alder borrows ${cad(alder.homeDraw)} against the home, up to 65% of its value, instead of pretending the spending is free.`,
    });
  }
  if (alder.respGrants > 1000) {
    items.push({
      title: "Education grant first",
      rank: alder.respGrants,
      body: `The Canada Education Savings Grant matches 20% of the first $2,500 a child. This plan collects ${cad(alder.respGrants)}. That beats an RRSP deduction.`,
    });
  }
  items.sort((a, b) => b.rank - a.rank);
  const top = items.slice(0, 4);
  if (!top.length) {
    top.push({
      title: "The quiet path",
      rank: 1,
      body: "With these inputs the registered accounts, CPP at 65, and OAS at 65 already do most of the work. Change retirement age or the size of the RRSP and the drawdown will move.",
    });
  }
  return top;
}

function Tools() {
  const rows: [string, string][] = [
    ["RRSP", "Deduct while working. Withdraw into a lower bracket, not into one final year."],
    ["TFSA", "Spent last. Withdrawals do not count for OAS, GIS, or the clawback."],
    ["FHSA", "A deduction and a tax-free withdrawal for a first home. Otherwise it becomes RRSP room you did not have."],
    ["Home Buyers' Plan", "Up to $60,000 from the RRSP, repaid over 15 years."],
    ["RESP", "Twenty percent on the first $2,500 a year, more if family income is low, lifetime grant $7,200."],
    ["Spousal RRSP", "Shift future income before 65, when pension splitting is not available yet."],
    ["Pension split", "Up to half of eligible pension income. RRIF withdrawals qualify from 65."],
    ["CPP", "From 60 to 70. The plan uses your life expectancy, not a coin flip."],
    ["OAS", "From 65 to 70, plus the 10% increase at 75. Clawback threshold indexed from $95,323."],
    ["CPP sharing", "The two pensions can be split so the brackets match."],
    ["Non-registered", "Modeled as Canadian dividends and deferred gains, not interest. Interest belongs in the RRSP."],
    ["Capital gains", "Half is taxable. Inclusion stays at 50%."],
    ["Dividends", "Eligible dividends are grossed up 38%. The gross-up counts toward OAS."],
    ["Ontario surtax", "20%, then 56% combined, on provincial tax over the indexed thresholds."],
    ["Health premium", "Frozen notches. The sharp ones sit near $48,600, $72,600 and $200,600."],
    ["Principal residence", "The gain on your home is not taxed."],
    ["First death", "RRSP, TFSA, and taxable accounts roll to a spouse. No terminal tax yet."],
    ["Second death", "RRSP left behind is income that year. This is the bill the meltdown is trying to shrink."],
    ["Estate administration tax", "About 1.5% above $50,000 of what goes through the will. Beneficiaries on RRSP and TFSA skip it."],
    ["Land transfer tax", "Charged when you buy in Ontario. First-time buyers get a rebate. Toronto adds a second tax."],
    ["GIS", "A rough 50-cent clawback for very low income. TFSA withdrawals are ignored. Approximate."],
    ["Whole life insurance", "A participating policy can shelter growth and pay a tax-free death benefit outside the estate. Look at it after registered room is full. Fees are real. This plan does not assume a policy."],
  ];
  return (
    <div>
      <h2 className="font-display text-2xl">Tools in the model</h2>
      <p className="mt-1 mb-4 max-w-2xl text-sm text-muted">
        2026 federal brackets run 14% to 33%. Ontario runs 5.05% to 13.16%, and the surtax pushes the top combined rate to about 53.5%.
      </p>
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {rows.map(([name, body]) => (
          <div key={name}>
            <dt className="text-sm font-medium text-ink">{name}</dt>
            <dd className="text-sm text-pretty text-muted">{body}</dd>
          </div>
        ))}
      </dl>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Bracket title="Federal, 2026" rows={FEDERAL_BRACKETS.map((b) => [b.upTo, b.rate])} />
        <Bracket title="Ontario, 2026" rows={ONTARIO_BRACKETS.map((b) => [b.upTo, b.rate])} />
      </div>
    </div>
  );
}

function Bracket({ title, rows }: { title: string; rows: [number, number][] }) {
  return (
    <div className="rounded-lg border border-line bg-card p-4">
      <h3 className="text-sm font-medium">{title}</h3>
      <ul className="mt-2 text-sm tabular-nums text-muted">
        {rows.map(([up, rate], i) => (
          <li key={rate} className="flex justify-between gap-4 py-1">
            <span>{i === 0 ? "Up to" : "Then to"} {Number.isFinite(up) ? cad(up) : "and above"}</span>
            <span className="text-ink">{(rate * 100).toFixed(2).replace(/\.?0+$/, "")}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Editor({
  plan,
  update,
  marginals,
}: {
  plan: PlanInput;
  update: (fn: (p: PlanInput) => PlanInput) => void;
  marginals: number[];
}) {
  const patch = (partial: Partial<PlanInput>) => update((p) => ({ ...p, ...partial }));
  const patchPerson = (index: number, partial: Partial<PersonInput>) =>
    update((p) => ({
      ...p,
      people: p.people.map((person, i) => (i === index ? { ...person, ...partial } : person)),
    }));

  return (
    <>
      <Section title="Household" open>
        <Check
          label="Couple — pension split, spousal RRSP, CPP sharing"
          checked={plan.people.length > 1}
          onChange={(on) =>
            update((p) => ({
              ...p,
              people: on ? (p.people.length > 1 ? p.people : [p.people[0]!, jordan()]) : [p.people[0]!],
            }))
          }
        />
        {plan.people.map((person, i) => (
          <fieldset key={i} className="grid gap-3 rounded-md border border-line p-3">
            <legend className="px-1 text-sm text-muted">{i === 0 ? "You" : "Spouse"}</legend>
            <Field label="Name" value={person.name} onChange={(name) => patchPerson(i, { name })} />
            <div className="grid grid-cols-3 gap-2">
              <Num label="Age" value={person.age} onChange={(age) => patchPerson(i, { age })} />
              <Num label="Retire" value={person.retireAge} onChange={(retireAge) => patchPerson(i, { retireAge })} />
              <Num label="Live to" value={person.lifeExpectancy} onChange={(lifeExpectancy) => patchPerson(i, { lifeExpectancy })} />
            </div>
            <Num label="Pay this year" value={person.employmentIncome} onChange={(employmentIncome) => patchPerson(i, { employmentIncome })} hint={`Next dollar about ${pct(marginals[i] ?? 0, 0)}`} />
            <Rate label="Pay growth" value={person.incomeGrowth} min={0} max={0.08} step={0.001} onChange={(incomeGrowth) => patchPerson(i, { incomeGrowth })} />
            <div className="grid grid-cols-2 gap-2">
              <Num label="RRSP" value={person.rrsp} onChange={(rrsp) => patchPerson(i, { rrsp })} />
              <Num label="RRSP room" value={person.rrspRoom} onChange={(rrspRoom) => patchPerson(i, { rrspRoom })} />
              <Num label="TFSA" value={person.tfsa} onChange={(tfsa) => patchPerson(i, { tfsa })} />
              <Num label="TFSA room" value={person.tfsaRoom} onChange={(tfsaRoom) => patchPerson(i, { tfsaRoom })} />
              <Num label="Non-registered" value={person.nonReg} onChange={(nonReg) => patchPerson(i, { nonReg, nonRegAcb: Math.min(person.nonRegAcb, nonReg) })} />
              <Num label="Cost base" value={person.nonRegAcb} onChange={(nonRegAcb) => patchPerson(i, { nonRegAcb })} />
            </div>
            <Num label="Defined-benefit pension, today's $" value={person.dbPensionToday} onChange={(dbPensionToday) => patchPerson(i, { dbPensionToday })} hint="Indexed. Eligible to split at any age." />
            <Rate label="CPP versus the career estimate" value={person.cppScale} min={0.3} max={1.2} step={0.01} onChange={(cppScale) => patchPerson(i, { cppScale })} />
            <Num label="Years in Canada for OAS" value={person.yearsInCanada} onChange={(yearsInCanada) => patchPerson(i, { yearsInCanada })} hint="40 is a full pension." />
            <Check label="Self-employed (both shares of CPP, no EI)" checked={person.selfEmployed} onChange={(selfEmployed) => patchPerson(i, { selfEmployed })} />
          </fieldset>
        ))}
      </Section>

      <Section title="Housing" open>
        <Check label="We already own" checked={plan.ownsHome} onChange={(ownsHome) => patch({ ownsHome, purchaseEnabled: ownsHome ? false : plan.purchaseEnabled })} />
        {plan.ownsHome ? (
          <div className="grid grid-cols-2 gap-2">
            <Num label="Home value" value={plan.homeValue} onChange={(homeValue) => patch({ homeValue })} />
            <Num label="Mortgage" value={plan.mortgage} onChange={(mortgage) => patch({ mortgage })} />
          </div>
        ) : (
          <>
            <Num label="Rent per year" value={plan.rentToday} onChange={(rentToday) => patch({ rentToday })} />
            <Check label="Buy a first home" checked={plan.purchaseEnabled} onChange={(purchaseEnabled) => patch({ purchaseEnabled })} />
            {plan.purchaseEnabled ? (
              <>
                <Num label="Price in today's dollars" value={plan.purchasePriceToday} onChange={(purchasePriceToday) => patch({ purchasePriceToday })} />
                <Num label="Years until purchase" value={plan.purchaseYear} onChange={(purchaseYear) => patch({ purchaseYear })} />
                <Rate label="Down payment" value={plan.downPercent} min={0.05} max={0.5} step={0.01} onChange={(downPercent) => patch({ downPercent })} />
                <Check label="First-time buyer (FHSA, HBP, land transfer rebate)" checked={plan.firstTimeBuyer} onChange={(firstTimeBuyer) => patch({ firstTimeBuyer })} />
                <Check label="Toronto — municipal land transfer tax too" checked={plan.toronto} onChange={(toronto) => patch({ toronto })} />
              </>
            ) : null}
          </>
        )}
        <Rate label="Mortgage rate" value={plan.mortgageRate} min={0.02} max={0.08} step={0.001} onChange={(mortgageRate) => patch({ mortgageRate })} />
        <Rate label="Home growth" value={plan.homeGrowth} min={0} max={0.06} step={0.001} onChange={(homeGrowth) => patch({ homeGrowth })} />
      </Section>

      <Section title="Spending and life" open>
        <Num label="Lifestyle spending, today's $" value={plan.spendingToday} onChange={(spendingToday) => patch({ spendingToday })} hint="Excludes rent, mortgage, tax, and upkeep." />
        <Num label="Spending once retired" value={plan.retirementSpendingToday} onChange={(retirementSpendingToday) => patch({ retirementSpendingToday })} hint="Drops to 70% after the first death, if there are two of you." />
        <Children plan={plan} update={update} />
        <Events plan={plan} update={update} />
      </Section>

      <Section title="Returns">
        <Rate label="Inflation" value={plan.inflation} min={0.01} max={0.04} step={0.001} onChange={(inflation) => patch({ inflation })} />
        <Rate label="Portfolio return, nominal" value={plan.portfolioReturn} min={0.02} max={0.09} step={0.001} onChange={(portfolioReturn) => patch({ portfolioReturn })} />
        <p className="text-xs text-pretty text-faint">
          Registered accounts earn this in full. The non-registered account is taxed as if most of it is deferred gains and eligible Canadian dividends. Brackets, OAS, CPP, and TFSA room move with inflation. The health premium does not — those thresholds have been frozen for years.
        </p>
        <button type="button" className="min-h-11 text-left text-sm text-pine" onClick={() => update(() => sampleCouple())}>
          Reset the GTA sample
        </button>
      </Section>
    </>
  );
}

function Children({ plan, update }: { plan: PlanInput; update: (fn: (p: PlanInput) => PlanInput) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-medium">Children and RESP</h3>
        <button
          type="button"
          className="min-h-11 px-2 text-sm text-pine"
          onClick={() => update((p) => ({ ...p, children: [...p.children, { id: uid("c"), name: "Child", age: 3, schoolAge: 18, annualCostToday: 20_000, yearsInSchool: 4 }] }))}
        >
          Add
        </button>
      </div>
      {plan.children.map((child) => (
        <div key={child.id} className="grid grid-cols-2 gap-2 rounded-md border border-line p-3">
          <Field label="Name" value={child.name} onChange={(name) => update((p) => ({ ...p, children: p.children.map((c) => (c.id === child.id ? { ...c, name } : c)) }))} />
          <Num label="Age" value={child.age} onChange={(age) => update((p) => ({ ...p, children: p.children.map((c) => (c.id === child.id ? { ...c, age } : c)) }))} />
          <Num label="School cost / year" value={child.annualCostToday} onChange={(annualCostToday) => update((p) => ({ ...p, children: p.children.map((c) => (c.id === child.id ? { ...c, annualCostToday } : c)) }))} />
          <button type="button" className="min-h-11 text-left text-sm text-muted" onClick={() => update((p) => ({ ...p, children: p.children.filter((c) => c.id !== child.id) }))}>
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

function Events({ plan, update }: { plan: PlanInput; update: (fn: (p: PlanInput) => PlanInput) => void }) {
  const add = (partial: Partial<LifeEvent>) => update((p) => ({ ...p, events: [...p.events, lifeEvent(partial)] }));
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">Life events</h3>
      <div className="flex flex-wrap gap-2">
        <Mini onClick={() => add({ label: "Renovation", kind: "cost", amountToday: 40_000 })}>Renovation</Mini>
        <Mini onClick={() => add({ label: "New car", kind: "cost", amountToday: 25_000 })}>Car</Mini>
        <Mini onClick={() => add({ label: "Inheritance", kind: "inflow", amountToday: 150_000 })}>Inheritance</Mini>
        <Mini onClick={() => add({ label: "Sabbatical", kind: "income-shock", dropPercent: 0.4, years: 1 })}>Time off</Mini>
      </div>
      {plan.events.map((event) => (
        <div key={event.id} className="grid grid-cols-2 gap-2 rounded-md border border-line p-3">
          <Field label="Label" value={event.label} onChange={(label) => update((p) => ({ ...p, events: p.events.map((e) => (e.id === event.id ? { ...e, label } : e)) }))} />
          <Num label="In years" value={event.yearOffset} onChange={(yearOffset) => update((p) => ({ ...p, events: p.events.map((e) => (e.id === event.id ? { ...e, yearOffset } : e)) }))} />
          {event.kind === "income-shock" ? (
            <Num label="Pay cut, percent" value={Math.round(event.dropPercent * 100)} onChange={(n) => update((p) => ({ ...p, events: p.events.map((e) => (e.id === event.id ? { ...e, dropPercent: n / 100 } : e)) }))} />
          ) : (
            <Num label={event.kind === "inflow" ? "Amount received" : "Cost today"} value={event.amountToday} onChange={(amountToday) => update((p) => ({ ...p, events: p.events.map((e) => (e.id === event.id ? { ...e, amountToday } : e)) }))} />
          )}
          <button type="button" className="min-h-11 text-left text-sm text-muted" onClick={() => update((p) => ({ ...p, events: p.events.filter((e) => e.id !== event.id) }))}>
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

function Section({ title, children, open }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="rounded-lg border border-line bg-card">
      <summary className="min-h-11 px-4 py-3 font-display text-lg">{title}</summary>
      <div className="flex flex-col gap-3 px-4 pb-4">{children}</div>
    </details>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted">{label}</span>
      <input className="h-11 rounded-sm border border-line bg-paper px-3 text-ink" value={value} onChange={(e) => onChange(e.target.value)} />
    </label>
  );
}

function Num({ label, value, onChange, hint }: { label: string; value: number; onChange: (v: number) => void; hint?: string }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-muted">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        className="h-11 rounded-sm border border-line bg-paper px-3 tabular-nums text-ink"
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
      />
      {hint ? <span className="text-xs text-faint">{hint}</span> : null}
    </label>
  );
}

function Rate({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="flex justify-between gap-3">
        <span className="text-muted">{label}</span>
        <span className="tabular-nums text-ink">{pct(value)}</span>
      </span>
      <Slider.Root
        className="relative flex h-11 items-center"
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([next]) => onChange(next ?? value)}
      >
        <Slider.Track className="relative h-1 grow rounded-full bg-line">
          <Slider.Range className="absolute h-full rounded-full bg-pine" />
        </Slider.Track>
        <Slider.Thumb className="block h-5 w-5 rounded-full border-2 border-pine bg-card" aria-label={label} />
      </Slider.Root>
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex min-h-11 items-center gap-3 text-sm text-ink">
      <input type="checkbox" className="h-4 w-4 accent-pine" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function Mini({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="min-h-11 rounded-full border border-line bg-paper px-3 text-sm">
      {children}
    </button>
  );
}
