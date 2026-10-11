import { COMMODITY, COMMODITY_NAME } from "../dock/draw";

/** The three commodity swatches (never a gradient bar): volumetric chips lit from the left like the bars. */
export function CommodityLegend({ className = "" }: { className?: string }) {
  return (
    <ul className={`commodity-legend ${className}`} aria-label="Commodity colours">
      {COMMODITY.map((c, i) => (
        <li key={c}><span className="swatch swatch--c" style={{ ["--c" as string]: c }} aria-hidden="true" />{COMMODITY_NAME[i]}</li>
      ))}
    </ul>
  );
}
