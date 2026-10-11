import { useArtifact } from "../data/useArtifact";
import { FACTS, META, MODEL, NETWORK, QUALITY, ROBUSTNESS, SOLUTIONS, SWEEP } from "../data/artifacts";
import type { ArtifactSpec } from "../data/loader";
import type { Facts, Meta, Model, Network, Quality, Robustness, Solutions, Sweep } from "../model/types";

/** The first-paint artifacts every scene reads (net, solutions, facts, meta), or null while any is not ready. */
export function useCore(): { net: Network; sol: Solutions; facts: Facts; meta: Meta } | null {
  const [n] = useArtifact(NETWORK), [s] = useArtifact(SOLUTIONS), [f] = useArtifact(FACTS), [m] = useArtifact(META);
  if (n.status === "ready" && s.status === "ready" && f.status === "ready" && m.status === "ready") return { net: n.data, sol: s.data, facts: f.data, meta: m.data };
  return null;
}
export const CORE_SPECS = [NETWORK, SOLUTIONS, FACTS, META] as ArtifactSpec<unknown>[];
export { FACTS, META, MODEL, NETWORK, QUALITY, ROBUSTNESS, SOLUTIONS, SWEEP };
export type { Model, Quality, Robustness, Sweep };
