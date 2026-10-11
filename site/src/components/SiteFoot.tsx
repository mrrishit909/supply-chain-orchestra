import { useArtifact } from "../data/useArtifact";
import { META } from "../data/artifacts";
import { ErrorLine } from "./StateUI";
import { useViewport } from "../scenes/useViewport";

/** The footer of every scene from S01 on (VISUAL_DESIGN section 0): attribution, seed and the first limitation, verbatim. */
export function SiteFoot({ hidden }: { hidden: boolean }) {
  const [m, retry] = useArtifact(META);
  const { cls } = useViewport();
  if (m.status === "error") {
    return <div className="site-foot site-foot--err"><ErrorLine live file="meta.json" reason={m.reason} attempt={m.attempt} onRetry={retry} /></div>;
  }
  if (m.status !== "ready") return null;
  const d = m.data;
  const text = `${d.attribution} · SEED ${d.seed} · ${d.limitations[0]}`.toUpperCase();
  if (cls === "M") {
    return (
      <details className={`site-foot site-foot--m ${hidden ? "is-hidden" : ""}`}>
        <summary>SOURCES, LIMITS AND ATTRIBUTION</summary>
        <p>{text}</p>
      </details>
    );
  }
  return <p className={`site-foot ${hidden ? "is-hidden" : ""}`}>{text}</p>;
}
