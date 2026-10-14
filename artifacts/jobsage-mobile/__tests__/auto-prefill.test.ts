import { describe, expect, it } from "@jest/globals";

import { applicationPrefillPageKey } from "@/lib/smart-apply/auto-prefill";

describe("automatic Smart Apply profile prefill key", () => {
  it("deduplicates rescans on the same application page without retaining query data", () => {
    expect(applicationPrefillPageKey(17, "https://apply.example.org/form?session=private#contact"))
      .toBe(applicationPrefillPageKey(17, "https://apply.example.org/form?session=changed#contact"));
  });

  it("uses distinct keys for different applications and page paths", () => {
    expect(applicationPrefillPageKey(17, "https://apply.example.org/form"))
      .not.toBe(applicationPrefillPageKey(18, "https://apply.example.org/form"));
    expect(applicationPrefillPageKey(17, "https://apply.example.org/form"))
      .not.toBe(applicationPrefillPageKey(17, "https://apply.example.org/next-step"));
  });

  it("rejects invalid application identities and unsafe URLs", () => {
    expect(applicationPrefillPageKey(0, "https://apply.example.org/form")).toBeNull();
    expect(applicationPrefillPageKey(17, "http://apply.example.org/form")).toBeNull();
    expect(applicationPrefillPageKey(17, "https://localhost/form")).toBeNull();
  });
});
