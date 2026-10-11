import { useEffect, useSyncExternalStore } from "react";
import { Sheet } from "./Sheet";
import { HonestyChip } from "./HonestyChip";
import { inspector, closePick, type Pick } from "../state/scenes";
import { follow } from "../scenes/frames-unfold";
import { fixed, int } from "../model/format";
import { r4 } from "../model/lp";
import { COMMODITY_NAME } from "../dock/draw";
import type { Plan } from "../model/plan";
import { siteUnits } from "../model/plan";
import type { Network, Scenario } from "../model/types";
import { useViewport } from "../scenes/useViewport";
import { useActiveScene } from "../scroll/hooks";

function rows(net: Network, plan: Plan, pick: NonNullable<Pick>, pub: Scenario | null) {
  const cm = net.commodities;
  if (pick.kind === "route") {
    const from = pick.rk === "in" ? net.plants[pick.end]!.short_name : net.sites[pick.site]!.short_name;
    const to = pick.rk === "in" ? net.sites[pick.site]!.short_name : net.demand_nodes[pick.end]!.short_name;
    let tons = 0;
    if (pick.rk === "in") for (const [p, f, k, t] of plan.routesIn) { if (p === pick.end && f === pick.site && k === pick.commodity) tons += t; }
    else for (const [a, k, t] of plan.routesOut) { if (net.out_arcs.site[a] === pick.site && net.out_arcs.demand[a] === pick.end && k === pick.commodity) tons += t; }
    const mi = pick.rk === "in" ? net.in_road_mi[pick.end]![pick.site]! : net.out_arcs.road_mi[net.out_arcs.site.findIndex((s, a) => s === pick.site && net.out_arcs.demand[a] === pick.end)]!;
    const c = cm[pick.commodity]!;
    const rate = pick.rk === "in" ? c.rate_in_usd_ton_mi : c.rate_out_usd_ton_mi;
    const perTon = r4(rate * mi * plan.params.freight_scale) + (pick.rk === "out" ? r4(c.handling_usd_ton) : 0);
    return {
      title: `${from} → ${to}`.toUpperCase(),
      lines: [["COMMODITY", COMMODITY_NAME[pick.commodity]!], ["TONS / YR", int(tons)], ["ROAD-EQUIVALENT MILES", `${fixed(mi, 1)} (GREAT-CIRCLE x 1.2)`], ["COST PER TON", `${fixed(perTon, 2)} USD (RATE x MILES${pick.rk === "out" ? " + HANDLING" : ""}, SYNTHETIC)`]] as [string, string][],
      tag: <HonestyChip tag="SIMULATED" detail="SYNTHETIC RATES" />,
    };
  }
  if (pick.kind === "site") {
    const s = net.sites[pick.id]!;
    const units = siteUnits(net, plan.routesOut)[pick.id]!;
    const cap = r4(s.capacity_units * plan.params.capacity_scale);
    const b = pub?.binding.find((x) => x.id === s.id);
    const cities = new Set(plan.routesOut.filter(([a]) => net.out_arcs.site[a] === pick.id).map(([a]) => net.out_arcs.demand[a])).size;
    return {
      title: `${s.id} ${s.short_name}`.toUpperCase(),
      lines: [["OPEN", plan.open.includes(pick.id) ? "YES" : "NO"], ["CAPACITY", `${int(cap)} UNITS`], ["USED", `${int(units)} UNITS (${cap ? fixed((units / cap) * 100, 1) : "0"}%)`], ["FIXED COST", `${fixed(s.fixed_cost_usd_yr * plan.params.fixed_cost_scale / 1e6, 1)} M USD / YR (SYNTHETIC)`],
        ["BINDING", b ? `YES${b.shadow_usd_per_unit !== null ? ` · SHADOW ${b.shadow_usd_per_unit} USD / UNIT (DERIVED, CONDITIONAL ON THE OPEN SET)` : ""}` : "NO"], ["CITIES SERVED", String(cities)]] as [string, string][],
      tag: <HonestyChip tag="SYNTHETIC" />,
    };
  }
  const n = net.demand_nodes[pick.id]!;
  const served = new Map<number, number>();
  for (const [a, , t] of plan.routesOut) if (net.out_arcs.demand[a] === pick.id) served.set(net.out_arcs.site[a]!, (served.get(net.out_arcs.site[a]!) ?? 0) + t);
  return {
    title: n.name.toUpperCase(),
    lines: [["POPULATION 2025", `${int(n.pop2025)} (OBSERVED)`], ...n.demand_tons.map((t, k) => [`DEMAND · ${COMMODITY_NAME[k]}`, `${int(t * plan.params.demand_scale)} T / YR (SYNTHETIC)`] as [string, string]),
      ["SERVED FROM", [...served].map(([f, t]) => `${net.sites[f]!.short_name.toUpperCase()} ${int(t)} T`).join(", ") || "NO SITE"],
      ...(pub?.demand_price_usd_ton ? [["DEMAND PRICE", pub.demand_price_usd_ton[pick.id]!.map((v, k) => `${COMMODITY_NAME[k]!.split(" ")[0]} ${fixed(v, 0)}`).join(" · ") + " USD / T (DERIVED)"] as [string, string]] : [])],
    tag: <HonestyChip tag="OBSERVED" detail="CENSUS PEP 2025" />,
  };
}

/** Journey inspector (interaction 9): a story-card panel on D, a bottom sheet on T and M; closes on scene change (L17). */
export function Inspector({ scene, net, plan, pub, canFollow = false }: { scene: string; net: Network; plan: Plan | null; pub?: Scenario | null; canFollow?: boolean }) {
  const st = useSyncExternalStore(inspector.subscribe, inspector.get);
  const { cls } = useViewport();
  const active = useActiveScene();
  useEffect(() => { if (st.scene && active && active !== st.scene) closePick(); }, [active, st.scene]);
  if (st.scene !== scene || !st.pick || !plan) return null;
  const r = rows(net, plan, st.pick, pub ?? null);
  const p = st.pick;
  return (
    <Sheet open onClose={closePick} title="JOURNEY INSPECTOR" side={cls === "D"} className="inspector">
      <h3 className="inspector__title">{r.title}</h3>
      <dl className="inspector__rows">{r.lines.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
      {r.tag}
      {p.kind === "route" && canFollow ? (
        <>
          <button type="button" className="btn-square" onClick={() => {
            const hero = plan.journeys.filter((j) => (p.rk === "in" ? j[0] === p.end && j[1] === p.site : j[1] === p.site && j[2] === p.end) && j[3] === p.commodity).sort((a, b) => b[4] - a[4])[0];
            const plant = p.rk === "in" ? p.end : hero?.[0] ?? 0, city = p.rk === "out" ? p.end : hero?.[2] ?? 0;
            const a = net.out_arcs.site.findIndex((s, i) => s === p.site && net.out_arcs.demand[i] === city);
            Object.assign(follow, { active: true, start: performance.now(), site: p.site, plant, city, commodity: p.commodity, inMi: net.in_road_mi[plant]![p.site]!, outMi: net.out_arcs.road_mi[a] ?? 0 });
            closePick();
          }}>FOLLOW ONE PACKAGE</button>
          <p className="inspector__check">SPEED IS NOT TRANSIT TIME: THE MODEL HAS NO TIME</p>
        </>
      ) : null}
    </Sheet>
  );
}
