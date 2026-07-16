import { describe, it, expect } from "vitest";
import { industryBucketForProfession } from "../routes/eligibility";

describe("industryBucketForProfession", () => {
  it("returns GMC for doctor", () => {
    expect(industryBucketForProfession("doctor")).toBe("GMC");
    expect(industryBucketForProfession("Doctor")).toBe("GMC");
    expect(industryBucketForProfession("DOCTOR")).toBe("GMC");
  });

  it("returns GMC for physician", () => {
    expect(industryBucketForProfession("physician")).toBe("GMC");
  });

  it("returns GMC for surgeon", () => {
    expect(industryBucketForProfession("consultant surgeon")).toBe("GMC");
  });

  it("returns GMC for GP", () => {
    expect(industryBucketForProfession("gp")).toBe("GMC");
    expect(industryBucketForProfession("GP trainee")).toBe("GMC");
  });

  it("returns GMC for psychiatrist", () => {
    expect(industryBucketForProfession("psychiatrist")).toBe("GMC");
  });

  it("returns GMC for clinical academic", () => {
    expect(industryBucketForProfession("clinical academic")).toBe("GMC");
  });

  it("returns NMC for nurse", () => {
    expect(industryBucketForProfession("nurse")).toBe("NMC");
    expect(industryBucketForProfession("registered nurse")).toBe("NMC");
  });

  it("returns NMC for nursing", () => {
    expect(industryBucketForProfession("nursing assistant")).toBe("NMC");
  });

  it("returns NMC for midwife", () => {
    expect(industryBucketForProfession("midwife")).toBe("NMC");
    expect(industryBucketForProfession("community midwife")).toBe("NMC");
  });

  it("returns NMC for midwifery", () => {
    expect(industryBucketForProfession("midwifery")).toBe("NMC");
  });

  it("returns HCPC for physiotherapist", () => {
    expect(industryBucketForProfession("physiotherapist")).toBe("HCPC");
  });

  it("returns HCPC for radiographer", () => {
    expect(industryBucketForProfession("diagnostic radiographer")).toBe("HCPC");
  });

  it("returns HCPC for allied health professional", () => {
    expect(industryBucketForProfession("allied health professional")).toBe("HCPC");
  });

  it("returns HCPC for occupational therapist", () => {
    expect(industryBucketForProfession("occupational therapist")).toBe("HCPC");
  });

  it("returns HCPC for paramedic", () => {
    expect(industryBucketForProfession("paramedic")).toBe("HCPC");
  });

  it("returns HCPC for speech and language therapist", () => {
    expect(industryBucketForProfession("speech and language therapist")).toBe("HCPC");
  });

  it("returns HCPC for biomedical scientist", () => {
    expect(industryBucketForProfession("biomedical scientist")).toBe("HCPC");
  });

  it("returns EDUCATION for teacher", () => {
    expect(industryBucketForProfession("primary school teacher")).toBe("EDUCATION");
    expect(industryBucketForProfession("secondary teacher")).toBe("EDUCATION");
  });

  it("returns EDUCATION for QTS", () => {
    expect(industryBucketForProfession("QTS holder")).toBe("EDUCATION");
  });

  it("returns HIGHER_EDUCATION for academic", () => {
    expect(industryBucketForProfession("academic researcher")).toBe("HIGHER_EDUCATION");
  });

  it("returns HIGHER_EDUCATION for lecturer", () => {
    expect(industryBucketForProfession("university lecturer")).toBe("HIGHER_EDUCATION");
  });

  it("returns HIGHER_EDUCATION for professor", () => {
    expect(industryBucketForProfession("professor of medicine")).toBe("HIGHER_EDUCATION");
  });

  it("returns ENGINEERING for engineer", () => {
    expect(industryBucketForProfession("software engineer")).toBe("ENGINEERING");
    expect(industryBucketForProfession("civil engineer")).toBe("ENGINEERING");
  });

  it("returns ENGINEERING for chartered engineer", () => {
    expect(industryBucketForProfession("chartered engineer")).toBe("ENGINEERING");
  });

  it("returns GENERAL for unrecognised professions", () => {
    expect(industryBucketForProfession("accountant")).toBe("GENERAL");
    expect(industryBucketForProfession("marketing manager")).toBe("GENERAL");
    expect(industryBucketForProfession("chef")).toBe("GENERAL");
  });
});
