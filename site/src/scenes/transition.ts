import { easeSmooth } from "../motion/ease";
import { motionEnabled } from "../state/motion";
import type { Plan } from "../model/plan";

/**
 * Keyed re-partition between two real plans (MOTION_SYSTEM 5.5): `set` retargets; a new target mid-flight restarts from
 * the nearer end, never queues. Rapid steps (> 4 per second) hard-step. Reduced motion snaps.
 */
export class PlanTransition {
  A: Plan | null = null;
  B: Plan | null = null;
  private t0 = 0;
  private dur = 0;
  mix = 1;
  private lastSet = 0;
  /** changed keys keep a white outline for 2 s after landing */
  landedAt = -1;
  set(plan: Plan, now: number, ms: number) {
    if (this.B === plan) return;
    const rate = this.lastSet ? 1000 / Math.max(1, now - this.lastSet) : 0;
    this.lastSet = now;
    if (!this.B || !motionEnabled()) { this.A = this.B = plan; this.mix = 1; this.landedAt = -1; return; }
    const from = this.mix < 0.5 && this.A ? this.A : this.B;
    this.A = from;
    this.B = plan;
    this.t0 = now;
    this.dur = rate > 4 ? 0 : ms;
    this.mix = this.dur > 0 ? 0 : 1;
    this.landedAt = this.dur > 0 ? -1 : now;
    if (this.dur === 0) this.A = plan;
  }
  update(now: number) {
    if (this.mix >= 1 || !this.B) return false;
    const t = (now - this.t0) / this.dur;
    if (t >= 1) { this.mix = 1; this.A = this.B; this.landedAt = now; return false; }
    this.mix = easeSmooth(Math.max(0, t));
    return true;
  }
  get busy() { return this.mix < 1; }
  /** 0..1 outline strength for keys that changed (2 s hold, 350 ms fade) */
  outline(now: number) {
    if (this.landedAt < 0 || this.mix < 1) return 0;
    const d = now - this.landedAt;
    return d < 2000 ? 1 : d < 2350 ? 1 - (d - 2000) / 350 : 0;
  }
}
