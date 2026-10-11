import { useMemo } from "react";
import { WordReveal } from "./WordReveal";

/** The relaxation sentences (DR-8): they arrive word by word (60 ms stagger) whenever the record changes. */
export function WordsBlock({ words, k }: { words: string[]; k: string }) {
  const play = useMemo(() => ([...k].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) | 0, 7) >>> 0) + 1, [k]);
  return (
    <div className="words" aria-live="polite">
      {words.map((w, i) => (
        <WordReveal key={`${k}${i}`} as="p" className="words__line" text={w} blur={6} mode={{ kind: "time", playKey: play, per: 260, stagger: 60 }} />
      ))}
    </div>
  );
}
