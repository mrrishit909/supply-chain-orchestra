# Motion system: Supply Chain Orchestra

This is the phase 17 motion bible. It pairs with `VISUAL_DESIGN.md`, and all references point there:

- scene ids S00-S08 and THE DESK
- geometry states G0 (giant), G1 (aside), G2 (scene), MAP, G4 (pair) and G5 (desk)
- interaction numbers 1-11

Every value here is binding for the frontend engineer. A deviation needs a written reason in `docs/ENGINEERING_DECISIONS.md` (the orchestrator owns that file).

## Contents

1. [Global principles and the six motion layers](#1-global-principles-and-the-six-motion-layers)
2. [Hard rules](#2-hard-rules)
3. [Token mapping](#3-token-mapping)
4. [The scroll engine and the dock transition model](#4-the-scroll-engine-and-the-dock-transition-model)
5. [Animation specifications](#5-animation-specifications)
6. [Navigation, chapter jumps, interruption](#6-navigation-chapter-jumps-interruption)
7. [Operational state motion](#7-operational-state-motion)
8. [Reduced motion](#8-reduced-motion)
9. [Performance budgets and rendering](#9-performance-budgets-and-rendering)
10. [Technical stack recommendation](#10-technical-stack-recommendation)
11. [Motion test plan](#11-motion-test-plan)

---

## 1. Global principles and the six motion layers

1. **Motion performs the analysis. Nothing moves to decorate.** Every motion is the visible form of an operation the model or the reader performs:

   | Motion | Operation |
   |---|---|
   | The dock *opens*: bars extend up and down from the line | loading the year's freight (inbound and outbound) |
   | Bars *slide along the dock* into new columns | a re-solve: sites open or close, routes change site |
   | A column *splits* or *merges* | opening or closing one site |
   | Bars *retract* into the dock | no plan exists (strict infeasibility), or the closing |
   | Hatch *fills in from the dock outward* | slack appearing in the relaxation |
   | Bars *unfold* into ribbons on the map | from the balance to geography |
   | Two discs *step* draw by draw | the paired Monte Carlo |
   | One package *travels* plant to site to city | following one journey on request |

2. **Lateral, vertical, or out. Never around.** Bars move only along x (re-partition), along y (opening, retracting) or out of the disc (the unfold). Nothing rotates, nothing travels along the circumference, nothing sweeps, and no dot streams along a lane (P01's grammar). The one travelling package (interaction 9) runs straight along great-circle ribbons, one at a time, on request.
3. **Two motion modes,** from the reference:
   - **Scrubbed.** A pure function of scroll progress, reversible and stateless: G-state camera moves, the unfold, card decks, word reveals, the S06 draw index.
   - **Stepped.** A threshold triggers a timed, retargetable transition: the S03a site steps, the S03b constraint states, the S04 re-partition and map steps, the S05 cases, argument cards, the echo.
4. **Data is shown only at real states.**
   - Every k, design, case, draw and solve on screen is a published record or a completed solve.
   - A change is either a **keyed travel** of bars between two real partitions or a **crossfade** between two real states (map ribbons, readouts' text).
   - **No readout shows a value in transit.** During a re-partition, bars that are moving have no tooltip, and the ledgers swap to the new record on landing (numerals tween 600ms from old to new real values, the conventional readout motion, in a fixed `ch` box).
   - Bar colour is the commodity and never changes during travel. Map ribbon widths **crossfade** (200ms) and never tween, because an intermediate width would be a flow that no solution has.
5. **Status before shape.** On a live solve, the status word changes first (200ms), then the geometry moves. An `INFEASIBLE` status never shows bars.
6. **One luminous form at a time:**
   - In S00 and S08 it is the giant disc, its seam glow, and its rim bloom (20%).
   - From S01 to THE DESK it is the disc, the map or the S06 pair at scene size. In S02 it dims to 20%, and in S07 to 15%, behind the cards.
7. **Slow structure, quick data.** Camera moves take 800-1200ms or are scrubbed. Re-partitions take 1200ms on scroll steps and 800ms on DESK solves. Crossfades take 200ms, numerals 600ms.
8. **Keyed continuity:**
   - every bar by `(echelon, from, to, commodity)`: `('in', plant, site, k)` or `('out', site, city, k)`
   - every column by site id
   - every map strand by the same key as its bar; every ribbon by `(echelon, from, to)`
   - every S06 disc by design, every S06 served bar by site

   Keyed things travel. They never swap identity in a crossfade between different positions.
9. **Settle, don't bounce.** No overshoot on data marks. Springs (damping ratio 1.0 or more) only on bottom sheets.
10. **The visitor always wins.** Any input retargets or completes an animation immediately. A solve never blocks scroll; nothing queues.

### The six motion layers (directive requirement)

| Layer | Where it lives | Spec |
|---|---|---|
| 1. Intro | S00 The Dock Opens: the package, the line, the squares, the opening, labels, headline, nav | 5.1 |
| 2. Navigation transitions | Bottom bar active block, MENU pill, chapter jumps with a stage fade, focus moves | 6 |
| 3. Scroll storytelling | G-state moves, the S03a steps, the S03b states, the re-partition and the unfold, the S05 cases, the draw scrub, the echo | 4, 5.3-5.9, 5.13 |
| 4. Component interaction | Steppers, segmented controls, sliders, the closed-site grid, the inspector, bottom sheets, the dock pan, bar hover | 5.12, 5.14 |
| 5. Data transitions | Re-partitions, retract and reopen, hatch fills, ribbon crossfades, the S06 draw steps, numerals, status swaps | 5.5-5.10 |
| 6. Microinteractions | Hover, press and focus on squares and chips, tooltips, ✓ marks, the hash check, the RESET confirmation, the elapsed-ms counter | 5.14, 7 |

## 2. Hard rules

Each rule is checked in QA.

| Rule | Test |
|---|---|
| **LCP:** `h1[data-hero]` is in the HTML and painted from first paint as ghost text (opacity 0.55, `filter: blur(12px)`, ENGINEERING_DECISIONS #10), never at opacity 0. The display font is preloaded, with a metric-matched fallback. The canvas is created after first paint | Lighthouse: the LCP element is `h1[data-hero]`, LCP 2.5s or less, CLS 0.1 or less (mobile and desktop presets) |
| **Nothing heavy on the LCP path.** First paint needs only `facts.json`, `meta.json`, `network.json` and `solutions.json` (27.6 KB gz together, measured). `robustness`, DR-1, DR-6 and HiGHS-wasm load later (9.3). `solver_test_vectors.json` (38 KB gz) is never needed by the page: hash prefixes come from facts (DR-7) | A Lighthouse waterfall shows no other request before FCP, and no `.wasm` before S03b |
| **Area rule.** At every rest state of an optimal record, Σ top slot areas = Σ bottom slot areas = tons / `k` (1e-9 relative), each column's half-area = its site's throughput, and every slack hatch's area = its slack / `k` | Debug hook at the S00 end, every S03a k, S04 at p 0.12, every S05 relaxed state and the DESK default |
| **Routes drawn == solution flows.** The set of drawn bars (and map strands) equals the set of routes, with tons recomputed from slot areas to 0.01 t | Vitest on the layout builder for every published record; Playwright on the DESK after 3 live solves |
| **No value in transit.** No tooltip or ledger shows a moving bar's value; map ribbon widths only crossfade | Playwright samples 10 frames of a re-partition: ledgers hold either the old or the new record's numbers, never others; no `width` tween on ribbons (debug hook) |
| **Never around.** No rotation transform or angular parameter exists in the dock or map code | Code review plus a grep for `rotate(` and angle uniforms in `src/dock` and `src/map` (the hatch pattern's fixed 45° is a pattern transform, allowlisted) |
| Animate only `transform`, `opacity` and `filter` (at most 14 word spans at once) in the DOM. The canvas draws its own pixels. Never animate layout properties or `backdrop-filter` | A DevTools trace shows no Layout events inside scrubbed frames |
| **One `requestAnimationFrame` loop** owns Lenis, progress, tweens and the canvas draw | Grep finds one `requestAnimationFrame` call site (`src/motion/loop.ts`) |
| **The solver never blocks.** HiGHS runs only in the worker; the main thread never waits on it | A long-task trace during a DESK solve shows no main-thread task over 50ms attributable to the solve |
| No artificial delays, no fake progress, no fake spinner. "Solving" shows real elapsed milliseconds | Code review: no `setTimeout` gates any data display; no percentage on a solve |
| No drawing on hidden stages. The canvas redraws only when dirty (progress changed, a transition is active, the pan moved, a package travels) | Playwright: with S07 centred, the canvas frame counter is flat for 2s once the cards settle |

## 3. Token mapping

| Token | Value | Used for |
|---|---|---|
| `--motion-fast` | 200ms | Nav hover (reference `0.2s ease-in-out`), tooltips, **status swaps**, **ribbon crossfades**, dock-square fills, legend swaps, pill label swap |
| `--motion-standard` | 350ms | Argument card stack (reference `all .35s ease-in-out`), intro completion on input, chapter-jump stage fade, segmented active block, S06 draw steps, dims, inspector exit |
| `--motion-panel` | 600ms | Numeral tweens, hatch fills, retracting bars on `INFEASIBLE`, ribbons appearing or leaving, data entering after load |
| `--motion-card` | 800ms | Story-card settle, G-state moves on a jump or a non-scrubbed change, **DESK re-partitions**, the S04 fold-back, the S05 relaxed opening, the S06 split |
| `--motion-scene` | 1200ms | **Scroll-step re-partitions** (S03a, S04), the S08 retract (the reference's `transform 1.2s cubic-bezier(.33,1,.68,1)`) |
| `--ease-premium` `cubic-bezier(.5,0,0,1)` | | Entrances and departures: cards, nav enter, inspector, the S00 line and package |
| `--ease-symmetric` `cubic-bezier(.5,0,.5,1)` | | Every scrubbed interpolation (G-state camera, the unfold), the dock opening and retracting, the travelling package's legs |
| `--ease-smooth` `cubic-bezier(.33,1,.68,1)` | | Stepped settles: re-partitions, hatch fills, numeral tweens, word sharpening |
| `linear` | | Story progress segments, the elapsed-ms counter, loading percentages (no easing on measurements) |
| `ease-in-out` | | Nav hover only (matches the reference) |

These fall inside the directive's ranges:

| Directive category | Directive range (ms) | Our value (ms) |
|---|---|---|
| Hover | 120-250 | 120-200 |
| Buttons | 150-300 | 200-350 |
| Panels | 250-600 | 350-600 |
| Charts | 400-1000 | 600-800 |
| Section transitions | 700-1800 | 800-1200 |
| Cinematic | 1000-3000 | 1200-1800, plus the 4.6s composite intro |

## 4. The scroll engine and the dock transition model

Reuse the app shell already ported through P01-P05 (`site/src/motion`, `scroll`, the loader and the nav). Do not rebuild it.

**The scroll engine:**

- **Tracks.** A `<section>` with the track height from VISUAL_DESIGN 3.1, and a sticky `100dvh` stage inside it. Progress is `p = clamp((scrollY - trackTop) / (trackHeight - innerHeight), 0, 1)` from Lenis's value, with geometry cached and re-measured on resize.
- **Active set.** Only the scene at the viewport centre and the next scene receive `update(p, dt)`. One canvas serves every scene except S07's cards.
- **Scrubbed** functions take the form `s = ease((p - a) / (b - a))`, clamped. They hold no state.
- **Stepped** thresholds use **hysteresis ±0.02**.
- **Lenis:** `lerp 0.1` on D, native touch scroll on T/M (`syncTouch: false`), and off under reduced motion.

**The dock transition model** (`src/dock/`):

- **Layout** (`layout.ts`, pure). Input: a record (routes, open set), `k`, the camera `(c, R0)`. Output: per bar, its key, its half (`top | bottom`), its slot `[x0, x1]` in disc units (−1..1 of the radius) and its commodity; per column, its site and `[x0, x1]`. The half-disc area function is `A(x) = ½(x√(1−x²) + asin x) + π/4` on the unit disc; slot edges come from its inverse (bisection to 1e-12, or Newton with a bisection guard). Vitest checks the inverse against the forward function at 10,000 points and the exact area sums for every published record.
- **Camera.** `(cx, cy, R)` in CSS px. A record with `tons` has `R = R0 × sqrt(tons / 2,589,781)` at that camera, so G-state moves and scenario size changes are both camera math; bars stay in disc units.
- **A transition** is a list of keyed bars with `from` and `to` slots (in disc units) plus `R_from`, `R_to`:
  - a key in both records travels: `x0 = mix(x0_from, x0_to, e)`, `x1 = mix(x1_from, x1_to, e)`, height follows the chord at each x, in its half
  - a key only in the new record **grows in place** from zero width at the centre of its target slot
  - a key only in the old record **shrinks in place** to zero width at the centre of its old slot
  - `R` interpolates in log space with the same `e`
  - the partition stays gapless at every frame because every slot edge is a linear blend of two gapless partitions in the same order. **Order is fixed by site longitude, so columns never cross**; within a column, bars keep their (plant or city longitude, commodity) order
- **Retargeting.** On a new transition mid-flight, the current blended slots become the new `from`. No queue.
- **Retract and open** (S00, S05, S08, `INFEASIBLE`). A bar's drawn extent is `[dock, dock + h(x) × o]` where `o` (0..1) is the open factor; `o` animates, slots do not.
- **The unfold** (`unfold.ts`). Each bar has a 25-point centreline: in the dock it is the vertical through the slot centre from the dock (point 0) to the chord end (point 24); on the map it is the lane's great-circle path, sampled at 25 points, **site end first** (so the dock end of every bar lands on its site), offset sideways for its commodity strand. Width goes from slot width to strand width. `P_i(t) = mix(dock_i, map_i, e(t))`, `w(t) = mix(w_dock, w_map, e(t))`. Both ends are evaluated in CSS px for the current camera, so the camera move and the flight share one parameter.
- **Drawing.** At rest, each bar is a cached `Path2D` with its gradient; in transition, bars are rebuilt per frame (about 330 paths of 26 points; the 1.5ms D budget for this rebuild is a target to be measured in QA, not a measurement).

## 5. Animation specifications

Format for each entry: **Trigger**, **Initial → End**, **Duration / Easing**, **Sync** (scrubbed or stepped), **Interruption**, **Input**, **Reduced motion**, **Performance**.

### 5.1 S00 intro: "The Dock Opens" (4.6s total)

| Time (ms) | What happens | Duration / easing |
|---|---|---|
| 0 | Black. Layer order is **canvas, then scrim, then h1**. The left scrim (D) or bottom scrim (T/M) is present at full strength from frame 0, black on black. `h1[data-hero]` sits **above** the scrim and is visible from first paint as ghost text (0.55, blur 12px). SKIP INTRO is visible (bottom right) | n/a |
| 200-500 | Corner labels fade in: `SUPPLY CHAIN ORCHESTRA` top-left; the status line top-right | 300ms premium |
| 300-600 | **The package.** One orange square (18px D) appears at the Houston column centre on the (not yet visible) dock: scale 0.85 → 1, opacity 0 → 1 | 300ms premium |
| 500-900 | **The line.** Before any bar exists, the seam is shown once as a 1px `#FFE6C8` hairline at 30% **at its full G0 length** (opacity 0 → 1; no extension from a point) with the closed-candidate hollow squares on it. It fades out (400ms) as the bars open and their lit inner edges take over, so at rest the dock is only an absence of light (VISUAL_DESIGN criterion 21). From this frame on, the disc's diameter is giant | 400ms premium |
| 900-1500 | **The sites.** The 8 open-site squares fill violet, west to east, 60ms stagger | 200ms each, smooth |
| 1500-3300 | **The dock opens.** Each column's bars extend from the dock to their chord ends (top up, bottom down) via the open factor `o`. Columns start in order of distance from the hero column (the hero's first), 0-800ms stagger; each column opens over 1000ms | 1000ms symmetric per column |
| 3300-3500 | The hero's two bars take their 1.5px white outline; site labels fade in | 200ms smooth |
| 3300-3700 | The seam glow (75%) and the rim bloom (0 → 20%) fade in; both canvases are drawn once, here | 400ms smooth |
| 3500-3800 | The hero caption fades in on the dock | 300ms premium |
| 3600-4300 | The headline sharpens word by word (5.2, time-based, 80ms stagger). The scrim does not animate | 700ms premium |
| 4200-4600 | Nav enters (translateY 16px → 0, opacity). The chip and the commodity legend appear bottom-left | 400ms premium |

- **What it is not.** The disc never grows from a point; the line is full length when it appears; nothing rotates; no radial wave runs from a centre. The opening is vertical.
- **Interruption.** Any wheel, touch-scroll, key or SKIP completes to the end state within 350ms (`o` → 1 for every column with a 350ms smooth tween, labels and glow appear). Re-entry within the session starts at the end state.
- **Reduced motion.** The end state renders at once. REPLAY plays the 0ms version.
- **Performance.** About 330 bar paths per frame during the opening; the glow is drawn once after the opening (not per frame).

### 5.2 Word blur reveal (S00 headline, S01 statement, S08 paragraph, statement swaps)

As P01-P05 5.2: words go from ghost (0.55, blur 12px) to sharp (1, 0px), at most 14 spans animating `filter` at once.

- Scrubbed in S01 and S08: each word owns a p sub-range.
- Time-based in S00: 80ms stagger, 350ms per word, smooth.
- **Statement swaps** (S05 case changes): the old line exits (opacity → 0, y −8px, 350ms premium) and the new one reveals.
- **Relaxation words** (S05, THE DESK) use the same reveal, time-based, 60ms stagger, so an explanation "arrives" rather than appears.

### 5.3 Camera moves (G0 → G1 → G2, MAP, G4, G5, and back to G0)

- **Trigger:** scene progress windows (VISUAL_DESIGN 3.4), or a jump.
- **Interpolation.** `c` linear, `R` in **log space**. Dock labels (DOM) are re-placed at column centres each frame (cheap: at most 14).
- **Sync:** scrubbed, symmetric (S01 0-0.4, S02 final 15%, S04 unfold, S08 0-0.35). On a chapter jump the target renders directly (6.2). A resize snaps.
- **Never:** rotation, non-uniform scale, a camera push into the bars.
- **Mobile pan** (M, and T in THE DESK): a horizontal drag starting within ±24px of the dock moves `cx` with the finger (clamped to the disc's extent); release decelerates over 350ms smooth. It never moves vertically and never scrolls the page.
- **Performance:** camera-only frames re-transform cached paths (`setTransform`), no layout rebuild.

### 5.4 Story-card choreography (S02)

Identical to P03-P05 5.4 (the shared deck): the first card rises from below the fold, then the row translates left so each card centres. The progress segment fills `linear`. Settles are 800ms premium on jumps, otherwise scrubbed.

| Card | Motion |
|---|---|
| 1 | The ledger lines count down one by one (each 200ms, numerals jump: they are counts), the drop reasons fade in (200ms), then 100 white points appear at their Albers positions (seeded 0-300ms stagger, 200ms each) |
| 2 | The five rule lines enter (350ms, 120ms stagger); the constants highlight in violet (200ms) |
| 3 | The great-circle path draws (stroke-dashoffset, 600ms linear), then `x 1.2` and the 284.6 MI result fade in (200ms) |
| 4 | The two LP heads type in (30ms per line, 6 lines), the shared hash prefix highlights in both (200ms), then the ✓ marks draw (200ms each) |

### 5.5 Re-partition (S03a steps, S04 step, THE DESK solves, S06 lose-one-site)

- **Trigger:** a stepped threshold (S03a, S04), a completed solve or preset pick (THE DESK), a picker change (S06).
- **Initial → End:** record A's partition → record B's (section 4).
  1. **Status first** (200ms): the status word and source swap.
  2. **Squares:** closing sites' dock squares go hollow (200ms) at the start.
  3. **Bars travel** (scroll steps 1200ms smooth; DESK 800ms smooth). New keys grow in place, vanished keys shrink in place. `R` follows in log space if tons differ.
  4. **Squares:** opening sites' squares fill (200ms) at the end; labels crossfade to the new column centres (200ms).
  5. **Changed outline:** every key whose slot site changed, or that appeared, carries a 1px white outline for 2s, then fades (350ms).
  6. **Ledgers** tween to the new record (600ms numerals; text swaps 200ms).
- **Interruption:** a new step or solve retargets from the current blended slots.
- **Input:** S03a stepper, S04 DESIGN toggle, DESK controls, S06 picker.
- **Reduced motion:** instant swap; the changed outline still shows (static, 2s).
- **Performance:** ≤ 330 paths per frame for ≤ 1.2s.
- **Rapid steps** (S03a at more than 4 steps/s): hard-step (0ms), outlines suppressed.

### 5.6 What binds (S03b)

| p | Motion | Sync |
|---|---|---|
| 0.12 | Other columns dim to 50% (350ms); the Oklahoma City column takes a 1px white outline (200ms); its dock square fills orange (200ms); `FULL` and the ledger line enter (350ms premium) | stepped |
| 0.40 | The column outline fades (200ms); every Fort Worth top bar lights (the others dim, 350ms); the plant ledger enters | stepped |
| 0.68 | The dims clear (350ms); bottom bars **crossfade in place** from commodity colour to their demand-price luminance step (each a 200ms crossfade between two real encodings, seeded 0-300ms stagger); the price legend replaces the commodity legend (200ms) | stepped |

- **The check** (interaction 3): at S03b entry the worker loads; `WARMING UP THE BROWSER SOLVER` (fade 200ms); on completion the ✓ and hash line draw (200ms). A CAPACITY toggle triggers a live solve (7), then the predicted and found numbers tween (600ms) and, if needed, the `OPEN SET CHANGED` line enters (350ms). A re-partition (5.5) shows the new solution if it differs.
- **Reverse:** exact inverses.
- **Reduced motion:** three static docks; the toggle swaps instantly.

### 5.7 The unfold (S04) and the fold-back

| p | Motion | Sync |
|---|---|---|
| 0.10 | Legacy → optimized re-partition (5.5, 1200ms) | stepped |
| 0.18-0.55 | **The unfold.** Every bar's centreline and width blend from the dock to its map strand (section 4). The dock line fades out as the site squares fly (straight lines) to their map positions; plant diamonds fade in at the inbound strands' far ends; the camera blends G2 → MAP with the same parameter. At t 0.5 the encoding label crossfades from `AREA = TONS` to `WIDTH = TONS · GREAT-CIRCLE x 1.2 · NOT ROADS` (200ms) | scrubbed, symmetric |
| 0.55-0.62 | Cities (white, seeded 0-300ms stagger), candidate arcs (25%) and closed sites fade in (350ms) | scrubbed |
| 0.70 / 0.85 | **Map steps** LEGACY then OPTIMIZED: ribbons present in only one design fade out or in (600ms); ribbons in both **crossfade** to their new width (200ms); changed lanes carry the white outline for 2s | stepped |
| 0.92 | The verdict card enters (translateY 24px → 0, 600ms premium) | stepped |
| 0.98 (exit) | **Fold-back:** the exact reverse of the unfold, 800ms symmetric, landing in G2 for S05 | stepped |

- **Reverse:** scrubbed phases reverse exactly; steps reverse with the same timing.
- **Reduced motion:** the end state (the optimized map) plus a static 3-frame strip (dock, mid, map).
- **Performance:** about 330 strands of 25 points per frame during the unfold.

### 5.8 Break it (S05)

| Step | Motion | Sync |
|---|---|---|
| Strict | **Status first** (`INFEASIBLE`, 200ms, error colour). Bars **retract** into the dock (`o` → 0, 600ms symmetric). The needed disc's area appears as the 12% white hatch (opacity 0 → 1, 350ms) at `R_needed` (camera tween 350ms if it differs) | stepped |
| Relaxed | Status `RELAXED (ELASTIC)` (200ms). The hatch disc fades (200ms). Bars **open** (`o` → 1, 800ms symmetric, all columns together). Then the **slack hatches fill from the dock outward** (a clip that grows from the bar's dock end to its rim end over 600ms smooth, for rim-end hatches the clip starts at the hatch's inner edge). The words reveal (5.2) | stepped |
| Unserved column (STORM) | The column's bottom bars open with the others but draw as hatch; its top edge draws as a dashed line (stroke-dashoffset 0 → full, 600ms linear) and stays empty | stepped |
| Optimized storm | Re-partition from the legacy storm record (5.5, 1200ms), then Oklahoma City's overshoot hatch fills (600ms) | stepped |

- **Case changes** (any p, or via the selector): status swap, then the strict or relaxed motion of the new case from the current state.
- **SOLVE THIS LIVE:** the solving line (7), then the same motions from the result.
- **Reduced motion:** 8 static docks with words; toggles swap instantly.

### 5.9 Five hundred storms (S06)

- **The split** (S06 entry): the G2 disc moves to the legacy position and a second disc **opens** at the optimized position (5.1 opening compressed: 800ms, no package), both on draw 1.
- **Draw steps** (scrubbed integer index, never between draws). Each step:
  - `R` of each disc tweens in log space to the new draw's demand (350ms smooth)
  - served bars (one per surviving site) re-partition (350ms, 5.5 rules)
  - failed sites' squares go hollow (200ms); recovered ones fill
  - the unserved slot grows or shrinks in place (350ms); its top dashed edge redraws (200ms)
  - the draw line swaps text (200ms); the tally counts **jump** (they are counts)
- **Rapid scrub** (more than 10 draws/s): hard-step, no tweens; the draw line still updates.
- **p 0.74, the tail:** the pair shrinks to the top (800ms), and two rows of 25 mini-discs enter (350ms premium, 20ms stagger), each a static rendering of its draw.
- **p 0.86, lose one site:** the optimized disc returns to G4; each pick re-partitions (5.5, 800ms) and hollows the lost site's square.
- **Reverse:** scrubbed index reverses exactly; steps reverse.
- **Reduced motion:** 5 static draw pairs plus live controls.

### 5.10 Data transitions (keyed, everywhere)

| Element | Key | Transition |
|---|---|---|
| Bars, new record (re-solve, k step, design, preset) | `(echelon, from, to, commodity)` | Lateral travel, 1200ms (scroll) or 800ms (DESK), smooth. Grow or shrink in place for keys in one record only |
| Bars, no plan (`INFEASIBLE`) | all | Retract to the dock, 600ms symmetric; the hatch disc fades in |
| Bars, plan restored | all | Open from the dock, 800ms symmetric |
| Slack hatch | bar key or `unserved` | Fill from the dock outward, 600ms smooth |
| Map strands, new record | bar key | Present in one record only: fade 600ms. In both: crossfade to the new width, 200ms |
| Dock squares | site | Fill or hollow, 200ms |
| S06 served bars | site | Lateral travel, 350ms |
| Status word and source | n/a | Crossfade 200ms, **before** any geometry moves |
| Numerals (ledgers, readouts, inspector) | field id | 600ms tween, tabular, fixed `ch` box; counts jump |
| Explanation words | record id | Word reveal (5.2), 60ms stagger |
| Empty data | n/a | Bars retract (600ms); the copy fades in (350ms) |

### 5.11 Argument stack (S07)

Identical to P01-P05 5.11 (the shared component), with 7 exchanges:

- The objection enters (translateY 40px → 0, 350ms ease-in-out).
- `THE DESK IS TYPING...` appears only during the 350ms between cards (skipped under reduced motion).
- The answer enters offset (+24, +16) on D.
- Older cards dim through the palette (never by opacity below the AA threshold) and scale to 0.96.
- On M, cards older than 2 collapse to slivers.
- **Mini-visuals:** rule lines enter (350ms, 120ms stagger); the great-circle path draws (600ms linear); hash prefixes highlight and ✓ marks draw (200ms each); penalty rows enter (350ms, 120ms stagger); numerals tween.
- **Reverse:** cards retract in order.

### 5.12 THE DESK

- **Control change:** the value and the slider thumb update instantly; on D and T a solve is scheduled 300ms after the last change (a debounce on input, not a delay on output); on M nothing solves until SOLVE.
- **Solve lifecycle:**
  1. The current solution dims to 60% (200ms); the status shows `SOLVING IN BROWSER · HiGHS · {{ms}} MS`, counting real elapsed time (`linear`, updated each frame).
  2. **Optimal:** status swap (200ms), re-partition (5.5, 800ms), map strands crossfade (200ms), dim clears (200ms), ledgers tween.
  3. **Infeasible:** status swap, retract (5.8 strict), `EXPLAIN WHY` enters (350ms premium) and takes focus.
  4. **Relaxed:** 5.8 relaxed.
  5. **Time limit:** status in warning colour; if an incumbent exists, it re-partitions as Optimal with `BEST FOUND, NOT PROVEN OPTIMAL` (350ms); otherwise the error path.
  6. **Error:** the status crossfades to the error line with RETRY (200ms); the last good solution returns to 100% (200ms); no shake.
  7. **Cancel:** the worker is terminated and recreated; the dim clears (200ms); the status returns to the last good record.
- **Preset pick:** the same motion as a solve result, with `PRECOMPUTED · PYTHON HiGHS` and no solving line.
- **Selection:** a selected site's column and strands stay at 100% while everything else dims to 30% (350ms); a selected city's bars light in every column (350ms).
- **Inspector:** D enters from the right (x 24px → 0, opacity, 600ms premium); T/M bottom sheet (350ms premium, critically damped drag release).
- **FOLLOW ONE PACKAGE:** one orange 12px square runs the inbound strand (duration = road miles / 1,000 × 1.6s, symmetric), pauses at the site square for 400ms (the dock), runs the outbound strand, and stays at the city. The strands it uses brighten to 100% while it runs; all other marks hold at 40%. Esc or any new selection removes it (200ms). Reduced motion: the square appears at the city with the two strands outlined.
- **RESET:** all controls tween to their defaults (350ms), the optimized preset re-partitions in, and the button shows `RESET ✓` for 1.2s (`aria-live`).
- **Offscreen:** a solve that completes while THE DESK is offscreen is applied as an instant state on re-entry.

### 5.13 Closing: every product, again (S08)

| p | Motion | Sync |
|---|---|---|
| 0-0.35 | G5 (or the current state) → G0: `c` to the G0 centre, `R` in log space to G0. If the current view is the map, it folds back first (800ms, stepped at p 0.02). The scrim fades in (S08 has no LCP constraint) | scrubbed, symmetric |
| 0.35-0.65 | Paragraph word reveal (5.2 scrubbed) | scrubbed |
| 0.70 | **The echo** (stepped, once per down-crossing). The corner labels fade in (300ms). **The dock closes:** every bar retracts into the line (`o` → 0, 1200ms symmetric); the glow fades out; labels fade. Hold 300ms: the full-width line, its squares, and the hero package. **The dock opens again** on the same solution in the S00 cadence (5.1 rows 1500-3800). The caption fades in (350ms) after the hero outline | stepped |
| 0.80-1 | Links fade in (350ms, 60ms stagger) | stepped |

- **Reverse.** Re-crossing above 0.68 resets the echo: the disc is shown open, with no replay. The caption never duplicates.
- **Diameter rule.** During the echo the dock line stays at full G0 length; only `o` animates.
- **Reduced motion.** The static giant disc with caption and links.
- **Performance.** As S00, including the glow (drawn once after reopening).

### 5.14 Component microinteractions

| Component | Behaviour |
|---|---|
| Square buttons and chips | Hover: background to white and text to black (200ms ease-in-out). Press: scale 0.97 (120ms). Focus: a 2px white outline offset 2px on `:focus-visible` |
| Parameter segmented controls and steppers | The active block is **`#690DE2` with white text** and slides between items (Motion `layoutId`, 350ms premium). The nav's active block stays white (shared shell) |
| Sliders (THE DESK) | Native `input type="range"`; the value label updates instantly in tabular mono; the track's filled part is violet `#690DE2`, the thumb a white 16px square; no tween on the value |
| Closed-site grid | A tap toggles a square between filled violet (available) and a struck hollow (closed), 200ms; the map's site square mirrors it |
| Disabled controls | 50% white and a 45° hatch at 25%. No hover motion. The tooltip appears after 80ms and gives the reason |
| Bars and strands (pointer on D) | Hover gives the bar (and its strand, if visible) a 1px white outline (120ms) and the tooltip `{{from}} → {{to}} · {{commodity}} · {{tons}} T / YR`. Suppressed during transitions |
| Tooltips | Opacity 0 → 1 and y 4px → 0 (200ms, 80ms delay). Out in 120ms. They follow the pointer at a 12px offset, clamped to the viewport |
| ✓ / ✗ marks | The stroke draws over 200ms. ✗ uses `--state-error` and never animates repeatedly |
| Status line | Text crossfade 200ms; elapsed ms counts `linear`; loading percentages jump |
| Dock pan arrows (M) | 44px squares at the dock ends; press moves the camera by one column (350ms smooth) |

## 6. Navigation, chapter jumps, interruption

### 6.1 Nav

The nav is the shared shell, identical to P01-P05 6.1:

- **D bar.** Bottom centre, `--surface-glass` with a static 16px blur, square 13px mono items. The white active block slides (350ms premium) and hover is 200ms ease-in-out. The right end holds REPLAY INTRO and MOTION ON/OFF.
- **T/M MENU pill.** A 160x32 white pill showing the current label (200ms crossfade). A tap opens a clip-path list upward (300ms premium, 30ms item stagger), and the icon morphs from "=" to "-". Close is 250ms.
- **Labels:** JOURNEY · WHAT IS REAL · SITES · LIMITS · UNFOLD · BREAK IT · STORMS · EVIDENCE · THE DESK. S08 keeps THE DESK active.

### 6.2 Direct chapter jumps: instant, with a stage fade

We jump instantly (the reference reached its target within 190ms). Smooth-scrolling across S03a would replay twelve re-partitions and S04 the whole unfold, which is noise. **Procedure:**

1. `lenis.scrollTo(target, {immediate: true})`.
2. The DOM layer fades in over 350ms. The canvas renders the target state directly (no transition).
3. Every stepped state between the old and new positions is resolved without animation.
4. The hash is written with `replaceState` (`#unfold`). `popstate` jumps the same way.
5. Focus moves to the scene heading.

**Landing progress per scene.** Each value sits at least 0.03 clear of every threshold ± hysteresis.

| Scene | Landing p | Why |
|---|---|---|
| S01 | 0.78 | Statement revealed, cards typing |
| S02 | 0.14 | Card 1 centred |
| S03a | 0.50 | A middle k (about 8), the optimum, settled |
| S03b | 0.20 | The full site lit |
| S04 | 0.62 | Unfold complete, the map with cities |
| S05 | 0.22 | SUPPLY relaxed, words shown |
| S06 | 0.35 | Pair mid-scrub, tally visible |
| S07 | 0.05 | First objection |
| THE DESK | section top | |

### 6.3 Scroll interruption

| Case | Behaviour |
|---|---|
| Reverse scroll | Scrubbed phases reverse exactly. Steps use hysteresis. Transitions retarget from current slots. |
| Rapid scroll / fling | S03a hard-steps above 4 steps/s; S06 hard-steps above 10 draws/s. Other steps go straight to the final state. A scene entered and left within 200ms gets its stepped state set directly. The unfold is scrubbed, so a fling shows the target level. |
| Mid-transition exit | Transitions finish their remaining time, then the scene pauses. A scene re-entered within 1.2s continues from its current values. |
| Solve in flight while leaving THE DESK | The worker keeps running; the result is applied on re-entry as an instant state (5.12). |
| Resize / orientation | A `ResizeObserver` (debounced 150ms) records the scene and p, snaps transitions to their ends, re-measures, recomputes the G-state geometry from the D/T/M table (breakpoints 768 / 1024; `k` per viewport), resizes the canvas (DPR cap) and restores scrollY. Nothing animates during a resize. |
| Tab hidden | The loop stops. Transitions are time-based, so on return they are evaluated at their end. The worker continues. |
| Long task | Frames are skipped, never queued. |

## 7. Operational state motion

| State | Motion |
|---|---|
| **Initial** | The dock line and squares (from `network.json`), no bars. No shimmer. |
| **Loading** | The mono line `LOADING {ARTIFACT} · {n}%` with real byte progress (jumps, no tween). It fades in (200ms) only if loading lasts 150ms or longer. |
| **Solving** | `SOLVING IN BROWSER · HiGHS · {ms} MS`, the elapsed time `linear`; the previous solution at 60%. No percentage, no spinner. |
| **Ready** | The scene's own opening or re-partition runs from the line. |
| **Empty** | Bars retract (600ms). The copy fades in (350ms). Controls stay live. |
| **Infeasible** | Status first (error colour, 200ms), retract (600ms), the hatch disc (350ms), `EXPLAIN WHY` / `RELAX TO SEE WHY` (350ms premium, focus moves to it). |
| **Error** | The loading or solving line crossfades (200ms) to `COULD NOT LOAD {ARTIFACT} ({reason})` or `COULD NOT SOLVE ({reason})` in `--state-error`, plus `RETRY`. No shake. A schema-guard failure reads `{ARTIFACT} FAILED ITS CHECKS`. The last good state stays on screen. |
| **Fallback** | On a worker failure with preset-matching params, the preset re-partitions in with `PRECOMPUTED · PYTHON HiGHS · BROWSER SOLVER FAILED ({reason})` (the source chip crossfades 200ms). |
| **Retry** | The same fetch or solve re-runs. The button shows `RETRYING`. A second failure adds `(ATTEMPT 2)`. |
| **Disabled** | 50% white plus hatch, `aria-disabled`, and a tooltip with the reason. No hover motion. |
| **Reset** | Values tween to the defaults (350ms controls, then one re-partition), and the button shows `RESET ✓` for 1.2s (`aria-live`). |

## 8. Reduced motion

It is triggered by `prefers-reduced-motion: reduce` **or** the MOTION OFF toggle. The tokens zero their durations and blur. In addition:

1. The intro shows its end state at once. REPLAY plays the 0ms version.
2. Lenis is off, and native scroll is used.
3. **Pinned tracks become normal flow:**

| Scene | Static rendering |
|---|---|
| S01 | Statement, the disc at G1, and the cards |
| S02 | 4 cards stacked vertically |
| S03a | 4 docks (exactly 3, 5, 8, 14 open): a row on D, 2x2 on T, stacked on M, plus the live stepper on a fifth |
| S03b | 3 docks (full site, drained plant, demand prices) with ledgers; the live check works |
| S04 | A 3-frame unfold strip (dock, mid, map), then the optimized map with the DESIGN toggle (instant) |
| S05 | 8 docks (4 cases x strict/relaxed) with words: 2x4 on D, 2 columns on T and M |
| S06 | 5 static draw pairs (best, median and worst by legacy cost, the storm exemplar, a draw where only legacy fails), plus live controls |
| S07 | All 7 exchanges as a vertical list |
| THE DESK | Fully functional, instant updates (no travel: partitions and strands switch) |
| S08 | The static giant disc, caption and links |

4. No glow fade, no opening, no stagger, no blur, no word reveals, no travelling package.

**Tests (Playwright `reducedMotion: 'reduce'`):**

- The document height is below the pinned height.
- No sticky positioning inside scenes.
- The canvas frame counter is stable after idle.
- Every control still changes the visible state.

## 9. Performance budgets and rendering

### 9.1 Rendering decisions

**Rendering: Canvas2D for the disc, the map and the unfold. No WebGL.** HiGHS-wasm in a module worker.

| Option | Cost | Verdict |
|---|---|---|
| R3F + three.js (MASTER_PLAN default) | About 150-180 KB gz for flat 2D paths | Rejected: nothing here is 3D (ED #19, #21, #24 reasoning) |
| Raw WebGL2 | A path tessellator for variable-width bars and strands, plus hatch patterns, for about 1,200 primitives | Rejected: Canvas2D already handles this count within budget (precedent P04, ED #21), and WebGL would add a fallback path |
| SVG / DOM | About 1,200 nodes whose `d` changes every frame during the unfold and re-partitions | Rejected for the stage (per-frame path parsing and paint). Kept for the S02 card visuals and the S07 mini-visuals |
| **Canvas2D** | One main canvas plus two static 1/4-res glow canvases (seam glow, rim bloom); `Path2D` cached at rest; `setTransform` for camera-only frames | **Chosen** |

- **Bars** are filled paths with a per-commodity, per-half vertical `createLinearGradient` of six stops (VISUAL_DESIGN section 0). **Gradients are cached:** 6 objects (3 commodities x 2 halves) keyed by `(cy, R)` rounded to 0.5px, rebuilt only when the camera or a scenario radius changes (at most once per frame during a camera move, never per bar). Hero brightening is one extra translucent fill on 2 paths. No per-bar gradient is ever created.
- **Hatch** is a 6x6 `CanvasPattern` (`createPattern`) created once.
- **Seam glow** (every disc scene) and **rim bloom** (S00 and S08 only): two 1/4-res canvas elements composited by the browser (`filter: blur(5px)` + `mix-blend-mode: screen` at 75%, and `blur(38px)` at 20% under the stage). Each is redrawn once after an opening, re-partition or camera settle, never during a transition: during a transition the seam glow holds its last frame at 40% and catches up on landing (200ms crossfade); the rim bloom is hidden outside S00/S08.
- **The map:** 500 candidate arcs as one cached `Path2D` (24 points each); strands as per-key paths; cities as one batched path of arcs (100); site and plant squares.
- **Picking:** at rest, bars are picked by x within the half (binary search on slot edges) and y inside the chord; strands by a coarse grid of their sampled points; cities and squares by distance. No GPU picking.
- **The solver:** highs@1.15.3 (HiGHS-wasm, about 1.21 MB gz, ED #21) in a module worker, created at S03b entry (or a DESK deep link), prefetched at idle once S03a p > 0.5. The worker receives LP text and returns the column values by name, the status string and the time. One worker; a cancel terminates it.

### 9.2 Budgets

| Item | Desktop D | Tablet T / Mobile M | LOW tier |
|---|---|---|---|
| Frame budget | 16.7ms (60fps); JS 4ms or less | 33ms (30fps); JS 8ms or less | same targets |
| Canvas DPR cap | 2 | 1.5 | 1 |
| Paths per transition frame | about 330 bars, or 330 strands + 500 arcs (one cached path) | same | same |
| Transition setup (layout of a record) | 2ms or less | 4ms or less | same |
| Cached gradients | 6 per camera state; rebuild 0.2ms or less | same | same |
| Seam glow | Redrawn once per settle at 1/4 res, 1.5ms or less | same, 3ms or less | off (the seam's own gradient remains) |
| Rim bloom | Drawn once per S00/S08 opening at 1/4 res, 3ms or less | same, 6ms or less | off |
| Re-partition | 1200 / 800ms | same | 400ms |
| Unfold | scrubbed | same | scrubbed, strands drawn without gradients |
| Solve | off the main thread; the measured median in Node was 60ms (max 1,176ms); browser times are measured, not assumed | same | same |

- **Tier detection.** Median frame time over the first 60 frames after the intro: above 22ms on D or 40ms on M means LOW (`window.__orchestraQuality`). `?quality=low|high` forces a tier.
- **Offscreen pause.** The canvas draws only when dirty, and nothing in S07 once the cards settle.
- **Measured, not claimed.** FPS, LCP, TBT, solve times and transition frame times come only from real runs (Lighthouse desktop and mobile presets, a Playwright trace with frame pacing on a stated device, the evidence harness, and the in-page solve timer).

### 9.3 Loading budget (Lighthouse perf 90+, LCP 2.5s or less, CLS 0.1 or less)

Sizes are gzip, measured on the current artifacts (`gzip -9`), or DR estimates.

| Resource | Budget (gz) | When |
|---|---|---|
| HTML + critical CSS (headline, ghost state) | 25 KB or less | first paint |
| Main JS (React, shell, loop, Lenis, Motion lazy core, dock layout and drawing, map projection) | 150 KB or less | deferred module |
| Fonts (2 latin woff2, display preloaded) | about 172 KB, as accepted for P01 and P02 (ED #9, #23) | first paint |
| `facts` (0.7), `meta` (1.1), `network` (7.8), `solutions` (18.0) | 27.6 KB measured | in parallel with JS |
| `model` (2.9), `quality` (0.9) | 4 KB | idle after the intro |
| `sweep` (DR-1, under 70) | 70 KB or less | S03a entry |
| HiGHS-wasm + glue | about 1.21 MB (ED #21) | S03b entry (prefetch at S03a p > 0.5) |
| `robustness` (17.2) + DR-6 (under 25) | 45 KB or less | S05 entry |
| `solver_test_vectors` (38.0) | never on the page | CI only |

## 10. Technical stack recommendation

| Layer | Choice | Reason |
|---|---|---|
| App | React 18 + TypeScript strict + Vite, using the shared shell (`site/src/motion`, `scroll`, loader, nav, primitives) | Program standard. No rebuild |
| Styles | `tokens.css` + CSS Modules. Project overrides: `--accent-primary: #FF4C25`, `--accent-secondary: #B48CFF`, `--control-fill: #690DE2` (fill only), `--commodity-packaged: #FF4C25`, `--commodity-cold: #FFB26B`, `--commodity-bulky: #A8301A`, no orb override (P07 has no orb) | Tokens own the language; colour is provenance |
| Scroll | Lenis plus the one rAF loop | Same as P01-P05 |
| GSAP | Not used | The intro is a keyframe table run by the shared tween (P01 decision 6) |
| Component motion | Motion (`motion/react`, `LazyMotion` + `domAnimation`) | `layoutId` active blocks, inspector, sheets |
| Stage | Canvas2D in `src/dock/` (`layout.ts` half-disc partition, `transition.ts` keyed blending and retargeting, `draw.ts`, `glow.ts`) and `src/map/` (`albers.ts`, `greatCircle.ts`, `strands.ts`, `unfold.ts`) | 9.1 |
| Solver | `src/solver/`: `lp.ts` (straight TS port of `tests/parity/build_lp.mjs`, hash-identical), `worker.ts` (highs@1.15.3), `columns.ts` (map back by name), `relax.ts` (report and DR-8 word templates), `journeys.ts` (DR-4 proportional split) | The architecture contract (`docs/ARCHITECTURE.md`) |
| Models | Pure functions, each with Vitest parity against artifact fixtures: the partition and area sums for every record; the LP text hash for every vector in `solver_test_vectors` (Node, CI); the projection against DR-5; journeys against DR-4; words against DR-8 `examples`; routes-drawn parity | |
| Data | `fetch` with stream progress, plus hand-written type guards from the JSON Schemas | Validation at the trust boundary |

## 11. Motion test plan

Playwright runs against `npm run build && npm run preview` at D, T and M.

1. **Intro.**
   - SKIP is visible at 100ms, and the nav appears within 400ms of the click.
   - A wheel at 1s completes the intro within 400ms.
   - A same-session reload starts at the end state.
   - Under reduced motion, the end state shows in the first screenshot.
2. **LCP and CLS.** In the Lighthouse JSON, the LCP element is `h1[data-hero]`, LCP is 2.5s or less, CLS is 0.1 or less, and only the four first-paint data files precede FCP. No `.wasm` request before S03b.
3. **Track release.** At each scene's end plus 10px, the next heading is in view. No traps.
4. **Reverse and rapid.**
   - Fling S01 to S06 and back: the final frames match a direct load (screenshot diff under 0.5%).
   - S03a at p 0.50 shows the same k forward and backward.
   - S04 at p 0.36 (mid-unfold), reached in reverse, matches a forward load.
5. **Chapter jumps.** For every nav item: scrollY lands within 2px of the landing progress within 200ms, the hash updates, back/forward work, and focus is on the heading.
6. **Resize mid-scene.** At S04 p 0.36, resize 1440 → 390: scene and p preserved within ±0.01, no console errors, MAP-M geometry matches the table.
7. **Area rule.** Debug hook at the S00 end, every S03a k, S04 p 0.12, every S05 relaxed state and the DESK default: half-area sums equal tons / `k` (1e-9), column half-areas equal site throughputs, hatch areas equal slacks.
8. **Routes drawn == solution flows.** For every published record and after 3 DESK solves: the drawn key set equals the route set; demand balance and the objective recomputed from drawn routes match the solution (0.01 t, 1e-5 relative).
9. **No value in transit.** During 10 sampled frames of a re-partition, ledgers hold only the old or the new record's numbers; tooltips are absent on moving bars; no ribbon width tween (debug hook).
10. **Unfold geometry.** At S04 t 0 and t 1, three bars' centrelines are within 1px of their slot axes and their great-circle strands; strand widths equal tons × the viewport scale.
11. **Solver states.** Warm-up hash equals the published hash; a DESK solve of each preset matches its status and objective (1e-6); a forced worker failure shows the fallback (preset params) or the error (other params); CANCEL stops within 100ms; a test-only 1ms time limit produces the time-limit state.
12. **Touch safety.** On M, a vertical swipe starting on the dock scrolls the page; a horizontal drag on the dock pans the camera and never scrolls; sliders do not capture vertical pan.
13. **Reduced motion.** No sticky in scenes, no animated filter, a stable canvas counter, every control still works.
14. **Pause offscreen.** With S07 centred (after the cards settle), the canvas frame counter is flat for 2s.
15. **Giant geometry and the P01-P05 confusion check (QA evidence).**
    - A debug hook reports the dock line at full G0 length from 500ms into S00 to its end, never decreasing, and `R ≥ G0 R` at S00 end and S08 p 0.75.
    - At the S00 end state and S08 p 0.75, a screenshot check at D, T and M finds disc-edge pixels (lit bar ends with black beyond, radially) outside every scrim rectangle: the D left arc, the T bottom-right arc, the M bottom arc.
    - The evidence harness writes `artifacts/evidence/<stage>/p01-p05-vs-p07-open-close.png`: S00 frames (0.6s, 1.5s, 2.5s, end) and S08 frames (p 0.3, 0.75, 0.9) of all six sites, at D and M, as 240px-tall tiles, with the real P03 S00 end frame next to P07's, in colour and greyscale (the design-time check is `design/sketches/p03-p07-pair.png`, VISUAL_DESIGN section 2).
    - An independent QA reviewer confirms that no P07 frame shows any of these: a stroked ring; nodes or ticks on a circumference; chords; wedges, spokes or petals; a smooth glow disc; a small orb or marker; square cells, a grid or a limb; a rising horizon arc; dots or grains; horizontal stripes; a bowed-arc map; particles along lanes; flat-swatch bars, drawn separators or a drawn dock line at rest (criterion 21, chart-library look). Rejection criteria 2, 3 and 19 apply. The design-time version of this sheet is `design/sketches/distinctness-sheet.png`.
16. **Frame pacing** (evidence harness). Scroll recordings at D and M report p50/p95 frame times on a stated device and browser, including the S00 opening, one S03a re-partition, the S04 unfold and one DESK solve. These are recorded, never estimated.
