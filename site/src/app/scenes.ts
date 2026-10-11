/**
 * Scene registry (VISUAL_DESIGN 3.1; landing progress from MOTION_SYSTEM 6.2).
 * `journey` (S00 intro + S01) is static HTML in index.html so the LCP headline paints before any JS.
 * S08 has no nav item: the nav keeps THE DESK active.
 */
export interface SceneDef { id: string; code: string; nav: string | null; track: string; landing: number; title: string }

export const SCENES: SceneDef[] = [
  { id: "journey", code: "S01", nav: "JOURNEY", track: "200vh", landing: 0.78, title: "Every product has a journey." },
  { id: "real", code: "S02", nav: "WHAT IS REAL", track: "300vh", landing: 0.14, title: "A hundred real places." },
  { id: "sites", code: "S03a", nav: "SITES", track: "300vh", landing: 0.5, title: "Open a site, shorten a trip." },
  { id: "limits", code: "S03b", nav: "LIMITS", track: "250vh", landing: 0.2, title: "Two limits shape the answer." },
  { id: "unfold", code: "S04", nav: "UNFOLD", track: "300vh", landing: 0.62, title: "Same cities. Two footprints." },
  { id: "break", code: "S05", nav: "BREAK IT", track: "300vh", landing: 0.22, title: "Where it breaks, it says so." },
  { id: "storms", code: "S06", nav: "STORMS", track: "300vh", landing: 0.35, title: "Five hundred storms, the same for both." },
  { id: "evidence", code: "S07", nav: "EVIDENCE", track: "250vh", landing: 0.05, title: "How we know." },
  { id: "desk", code: "DESK", nav: "THE DESK", track: "auto", landing: 0, title: "Change the score. Hear the orchestra." },
  { id: "closing", code: "S08", nav: null, track: "200vh", landing: 0.3, title: "Every product, again." },
];

export const NAV_ITEMS = SCENES.filter((s) => s.nav).map((s) => ({ id: s.id, label: s.nav! }));
export const navActive = (scene: string | null) => (scene === "closing" ? "desk" : scene ?? "journey");
export const sceneIndex = (id: string) => SCENES.findIndex((s) => s.id === id);
