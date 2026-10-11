/**
 * Copy deck (VISUAL_DESIGN section 5). Lines bound to an artifact field are rendered from that field verbatim
 * (uppercased where mono); every number is computed from the artifacts here, never typed (QA L10).
 */
import { fixed, int, musd } from "../model/format";
import type { Facts, Meta, Network, Quality } from "../model/types";
import type { Plan } from "../model/plan";

export const fact = (f: Facts, id: string): number => {
  const x = f.facts.find((v) => v.id === id);
  if (!x) throw new Error(`fact ${id} missing`);
  return x.value as number;
};
export const factStr = (f: Facts, id: string): string => String(f.facts.find((v) => v.id === id)?.value ?? "");

export const STATUS_WORD: Record<string, string> = { Optimal: "OPTIMAL", Infeasible: "INFEASIBLE", "Time limit reached": "TIME LIMIT" };
export const statusWord = (p: Plan) => (p.relaxed && p.status === "Optimal" ? "RELAXED (ELASTIC)" : STATUS_WORD[p.status] ?? p.status.toUpperCase());
export const sourceWord = (p: Plan) => (p.source === "BROWSER" ? "SOLVED IN BROWSER · HiGHS" : "PRECOMPUTED · PYTHON HiGHS");

export const s00 = {
  h1: "Every product has a journey.",
  line2: "TOP: FROM PLANTS · BOTTOM: TO CITIES · AREA = TONS / YR",
  chips: ["SIMULATED", "SYNTHETIC NETWORK", "OBSERVED PLACES"],
};
export function s00Line1(p: Plan, net: Network): string {
  return `${statusWord(p)} · ${p.open.length} OF ${net.sites.length} SITES OPEN · ${musd(p.objective ?? 0)} M USD / YR · SYNTHETIC COSTS`;
}
export function s00Source(p: Plan) { return sourceWord(p); }

export const s01 = {
  statement: "Where to keep it, and how to move it.",
  cards: (f: Facts, p: Plan, net: Network) => [
    { from: "FROM: THE SOLVER", when: statusWord(p), body: `${p.open.length} OF ${net.sites.length} CANDIDATE SITES OPEN. ${int(fact(f, "total_demand_tons"))} T A YEAR IN, THE SAME OUT. ${musd(p.objective ?? 0)} M USD A YEAR, ALL COSTS SYNTHETIC.`, tag: "SIMULATED" as const },
    { from: "FROM: THE CENSUS BUREAU", when: "2025", body: `THE CITIES ARE REAL: ${fact(f, "demand_nodes")} PLACES, ${fixed((net.demand_nodes.reduce((a, n) => a + n.pop2025, 0)) / 1e6, 1)} M PEOPLE. EVERYTHING ELSE IS INVENTED, AND SAYS SO.`, tag: "OBSERVED" as const },
  ],
};

export const footerLine = (m: Meta) => `${m.attribution.toUpperCase()} · SEED ${m.seed} · ${m.limitations[0]!.toUpperCase()}`;
export const joinLedger = (q: Quality) => q.join_ledger;
