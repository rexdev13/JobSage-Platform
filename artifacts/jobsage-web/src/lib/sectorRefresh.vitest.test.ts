import { shouldAutoRefreshSector } from "./sectorRefresh";

describe("sector refresh trigger", () => {
  it("refreshes when the selected sector changes to a real sector", () => {
    expect(shouldAutoRefreshSector("", "Healthcare")).toBe(true);
    expect(shouldAutoRefreshSector("Healthcare", "Technology")).toBe(true);
  });

  it("does not refresh for the same sector or the all-sectors view", () => {
    expect(shouldAutoRefreshSector("Healthcare", "Healthcare")).toBe(false);
    expect(shouldAutoRefreshSector("Healthcare", "")).toBe(false);
    expect(shouldAutoRefreshSector("", "")).toBe(false);
  });
});