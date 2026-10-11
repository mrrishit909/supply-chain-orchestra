/** Node-side loader of the published artifacts (Vitest only). */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { Facts, Meta, Model, Network, Quality, Robustness, Solutions, Sweep } from "../model/types";

const dir = fileURLToPath(new URL("../../public/data/", import.meta.url));
export const rd = <T>(n: string) => JSON.parse(readFileSync(dir + n + ".json", "utf8")) as T;
export const net = rd<Network>("network");
export const model = rd<Model>("model");
export const solutions = rd<Solutions>("solutions");
export const sweep = rd<Sweep>("sweep");
export const robustness = rd<Robustness>("robustness");
export const facts = rd<Facts>("facts");
export const meta = rd<Meta>("meta");
export const quality = rd<Quality>("quality");
export interface Vector { id: string; kind: string; params: import("../model/types").Params; lp_text_sha256: string; expected: { status: string; objective_usd: number | null; open_sites: number[]; unmet_tons?: number } }
export const vectors = rd<{ vectors: Vector[]; tolerance_abs_usd: number; tolerance_rel: number; solver_options: Record<string, unknown> }>("solver_test_vectors");
export const fact = (id: string) => facts.facts.find((f) => f.id === id)!.value as number;
