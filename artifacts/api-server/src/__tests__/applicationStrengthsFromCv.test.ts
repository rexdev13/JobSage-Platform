import { describe, expect, it } from "vitest";
import {
  prepareCvEvidenceText,
  validateCvStrengths,
} from "../lib/applicationStrengthsFromCv";

describe("CV-backed professional-strength drafting", () => {
  const cvText = [
    "Registered nurse with experience in urgent and emergency care.",
    "Led a multidisciplinary team of 12 during a service redesign.",
    "Delivered staff mentoring and improved clinical handover.",
  ].join("\n");

  it("removes direct contact and identity details before producing AI input", () => {
    const result = prepareCvEvidenceText(
      "Name: Example\nEmail: candidate@example.com\nPhone: +44 7700 900123\n" +
      "Address: 123 Example Road\nNI Number: AB123456C\nPostcode: SW1A 1AA\n" +
      "Led a multidisciplinary team of 12.",
    );

    expect(result).not.toContain("candidate@example.com");
    expect(result).not.toContain("+44 7700 900123");
    expect(result).not.toContain("123 Example Road");
    expect(result).not.toContain("AB123456C");
    expect(result).not.toContain("SW1A 1AA");
    expect(result).toContain("Led a multidisciplinary team of 12.");
  });

  it("retains only statements supported by exact CV excerpts", () => {
    const result = validateCvStrengths(
      {
        strengths: [
          {
            text: "I lead multidisciplinary teams and support service improvement.",
            evidence: ["Led a multidisciplinary team of 12 during a service redesign."],
          },
          {
            text: "I reduced incidents by 40%.",
            evidence: ["Reduced incidents by 40%."],
          },
          { text: "I hold a master's degree.", evidence: [] },
        ],
      },
      cvText,
    );

    expect(result).toEqual([
      {
        text: "I lead multidisciplinary teams and support service improvement.",
        evidence: ["Led a multidisciplinary team of 12 during a service redesign."],
      },
    ]);
  });

  it("matches supporting excerpts despite normalised whitespace and letter case", () => {
    const result = validateCvStrengths(
      {
        strengths: [
          {
            text: "I have experience in urgent care.",
            evidence: ["registered  nurse WITH experience in urgent and emergency care."],
          },
        ],
      },
      cvText,
    );

    expect(result).toHaveLength(1);
  });

  it("drops malformed statements and statements that include personal contact details", () => {
    const result = validateCvStrengths(
      {
        strengths: [
          {
            text: "Contact me at example@example.com.",
            evidence: ["Registered nurse with experience in urgent and emergency care."],
          },
          {
            text: "I work in urgent care.\nI lead teams.",
            evidence: ["Registered nurse with experience in urgent and emergency care."],
          },
        ],
      },
      cvText,
    );

    expect(result).toEqual([]);
    expect(validateCvStrengths({ strengths: "not an array" }, cvText)).toEqual([]);
  });
});
