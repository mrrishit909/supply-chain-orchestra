/** Artifact specs (one store per file, shared by every scene). Guards are the trust boundary. */
import type { ArtifactSpec } from "./loader";
import {
  isFacts, isMeta, isModel, isNetwork, isQuality, isRobustness, isSolutions, isSweep,
  type Facts, type Meta, type Model, type Network, type Quality, type Robustness, type Solutions, type Sweep,
} from "../model/types";

// first paint: facts + meta + network + solutions (27.6 KB gz, MOTION_SYSTEM 9.3)
export const FACTS: ArtifactSpec<Facts> = { file: "facts.json", guard: isFacts };
export const META: ArtifactSpec<Meta> = { file: "meta.json", guard: isMeta };
export const NETWORK: ArtifactSpec<Network> = { file: "network.json", guard: isNetwork };
export const SOLUTIONS: ArtifactSpec<Solutions> = { file: "solutions.json", guard: isSolutions };
// lazy
export const MODEL: ArtifactSpec<Model> = { file: "model.json", guard: isModel };
export const QUALITY: ArtifactSpec<Quality> = { file: "quality.json", guard: isQuality };
export const SWEEP: ArtifactSpec<Sweep> = { file: "sweep.json", guard: isSweep };
export const ROBUSTNESS: ArtifactSpec<Robustness> = { file: "robustness.json", guard: isRobustness };
