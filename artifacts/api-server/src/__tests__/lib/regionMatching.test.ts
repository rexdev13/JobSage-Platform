import { describe, expect, it } from "vitest";
import { regionsFromLocationText, regionsOverlap } from "../../lib/regionMatching";

describe("deterministic UK region matching", () => {
  it("matches normalized region selections and keeps unknown data visible", () => {
    expect(regionsOverlap([" london "], ["London"])).toBe(true);
    expect(regionsOverlap(["North West"], ["London"])).toBe(false);
    expect(regionsOverlap([], ["London"])).toBe(true);
    expect(regionsOverlap(["London"], [])).toBe(true);
    expect(regionsOverlap(["National / Multiple Regions"], ["London"])).toBe(true);
  });

  it("derives regions from known location text without guessing unfamiliar places", () => {
    expect(regionsFromLocationText("Manchester, Greater Manchester")).toContain("North West");
    expect(regionsFromLocationText("London / hybrid")).toContain("London");
    expect(regionsFromLocationText("Remote in the United Kingdom")).toEqual([]);
  });
});