import { describe, expect, it, vi } from "vitest";
import { onScreenTimer } from "./timer";

function harness() {
  let clock = 0;
  const frames: (() => void)[] = [];
  const report = vi.fn();
  const trace = onScreenTimer(
    report,
    () => clock,
    (callback) => frames.push(callback),
  );
  return {
    trace,
    report,
    at: (ms: number) => (clock = ms),
    frame: () => frames.splice(0).forEach((callback) => callback()),
    frames,
  };
}

describe("onScreenTimer", () => {
  it("reports the ms from the search's send to the frame after its searchDone", () => {
    const t = harness();
    t.at(100);
    t.trace("q1", "search");
    t.at(400);
    t.trace("q1", "searchParsed");
    t.trace("q1", "nameMatches", { matches: 200 });
    t.at(1500);
    t.trace("q1", "searchDone");
    expect(t.report).not.toHaveBeenCalled(); // not before the frame
    t.at(1516);
    t.frame();
    expect(t.report).toHaveBeenCalledExactlyOnceWith("q1", 1416);
  });

  it("reports nothing for a stopped or failed search", () => {
    const t = harness();
    t.trace("q1", "search");
    t.trace("q1", "cancel");
    t.trace("q1", "cancelled");
    t.trace("q2", "search");
    t.trace("q2", "error", { code: "folderNotFound" });
    t.trace("q2", "searchDone"); // nothing left to time
    t.frame();
    expect(t.frames).toEqual([]);
    expect(t.report).not.toHaveBeenCalled();
  });

  it("times only the latest search: a replaced one's late searchDone never reports", () => {
    const t = harness();
    t.at(0);
    t.trace("q1", "search");
    t.at(50);
    t.trace("q2", "search");
    t.at(80);
    t.trace("q1", "searchDone");
    t.at(300);
    t.trace("q2", "searchDone");
    t.at(310);
    t.frame();
    expect(t.report.mock.calls).toEqual([["q2", 260]]);
  });

  it("ignores events and replies it never saw sent", () => {
    const t = harness();
    t.trace(null, "ready");
    t.trace("q9", "searchDone");
    t.frame();
    expect(t.report).not.toHaveBeenCalled();
  });
});
