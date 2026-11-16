// Dev only (Story 2.4, NFR-3 spot checks): how long each search took from Enter to its results on
// screen. The clock starts when the search is sent (Enter sends it at once) and stops in the second
// animation frame after its `searchDone`: a frame callback runs before that frame's layout and paint,
// so the second one runs once the frame showing the final results has been painted. Only the
// latest search can render, so a new one drops the clocks of older ones. It sees ids and reply
// types only, never the search text.
import type { SearchTrace } from "./session";

/** A SearchTrace that calls `report` with each finished search's id and its Enter-to-screen ms. */
export function onScreenTimer(
  report: (id: string, ms: number) => void,
  now: () => number = () => performance.now(),
  nextFrame: (callback: () => void) => void = (callback) =>
    requestAnimationFrame(() => requestAnimationFrame(() => callback())), // after the results' paint
): SearchTrace {
  const started = new Map<string, number>();
  return (id, type) => {
    if (id === null) return;
    if (type === "search") {
      started.clear();
      started.set(id, now());
      return;
    }
    if (type !== "searchDone" && type !== "cancelled" && type !== "error") return;
    const start = started.get(id);
    started.delete(id);
    if (type === "searchDone" && start !== undefined) nextFrame(() => report(id, now() - start));
  };
}
