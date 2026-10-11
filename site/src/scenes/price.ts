import { priceBin } from "./frames-limits";
import type { Facts, Solutions } from "../model/types";
import type { BarMeta } from "../dock/layout";

/** Demand-price bin per bottom bar (DERIVED, 5 quantile bins per commodity at the optimum). */
export const PRICE_BIN = (facts: Facts, sol: Solutions) => {
  const price = sol.scenarios.find((s) => s.id === "optimized")!.demand_price_usd_ton!;
  const bins = facts.demand_price_bins.commodities;
  return (m: BarMeta) => (m.kind === "out" ? priceBin(bins[m.commodity]!.edges, price[m.end]![m.commodity]!) : -1);
};
