/** Number formatting shared by every readout. */
export const int = (n: number) => Math.round(n).toLocaleString("en-US");
export const fixed = (n: number, d = 1) => n.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
/** USD per year as millions with one decimal: 563.6 */
export const musd = (usd: number, d = 1) => fixed(usd / 1e6, d);
export const pct = (frac: number, d = 1) => `${fixed(frac * 100, d)}%`;
export const upper = (s: string) => s.toUpperCase();
