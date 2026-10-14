import { describe, expect, it } from "@jest/globals";

import { applicationAssistantStepKey, applicationPrefillPageKey } from "@/lib/smart-apply/auto-prefill";

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

  it("reopens Smart Apply when a new form step appears at the same URL", () => {
    const firstStep = applicationAssistantStepKey(17, "https://apply.example.org/form", ["contact|email"]);
    const secondStep = applicationAssistantStepKey(17, "https://apply.example.org/form", ["history|employer"]);
    expect(firstStep).not.toBe(secondStep);
    expect(secondStep).toBe(applicationAssistantStepKey(17, "https://apply.example.org/form", ["history|employer"]));
  });

  it("does not retain query data in a form-step key", () => {
    expect(applicationAssistantStepKey(17, "https://apply.example.org/form?token=one", ["contact"]))
      .toBe(applicationAssistantStepKey(17, "https://apply.example.org/form?token=two", ["contact"]));
  });
});
