import { useActiveScene } from "./hooks";
import { sceneIndex } from "../app/scenes";

/** True once the visitor is in scene `id` or beyond (lazy artifacts that must stay off the first-paint path). */
export function useReached(id: string) {
  const a = useActiveScene();
  return a ? sceneIndex(a) >= sceneIndex(id) : false;
}
