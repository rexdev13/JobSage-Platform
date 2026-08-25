// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  detectSubmissionSignal,
  retryTrackedApplicationConfirmation,
  watchForSubmissionConfirmation,
} from "../lib/trackerDetector";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("detectSubmissionSignal", () => {
  it("recognizes a dedicated application confirmation URL", () => {
    expect(
      detectSubmissionSignal(document, "https://apply.example.org/application-submitted"),
    ).toEqual({ source: "confirmation_url" });
  });

  it("recognizes a clear confirmation heading", () => {
    document.body.innerHTML = "<h1>Thank you for your application</h1>";

    expect(
      detectSubmissionSignal(document, "https://apply.example.org/next-step"),
    ).toEqual({ source: "confirmation_heading" });
  });

  it("recognizes a success message exposed by an in-page ATS wizard", () => {
    document.body.innerHTML = `
      <div role="status">Your application has been submitted successfully.</div>
    `;

    expect(
      detectSubmissionSignal(document, "https://apply.example.org/form"),
    ).toEqual({ source: "success_message" });
  });

  it("does not treat generic page copy or a submit button as confirmation", () => {
    document.body.innerHTML = `
      <main>
        <p>Submit your application before the closing date.</p>
        <button type="submit">Submit application</button>
      </main>
    `;

    expect(
      detectSubmissionSignal(document, "https://apply.example.org/form"),
    ).toBeNull();
  });

  it("does not trust generic success query parameters or an empty confirmation route", () => {
    expect(
      detectSubmissionSignal(document, "https://apply.example.org/form?success"),
    ).toBeNull();
    expect(
      detectSubmissionSignal(document, "https://apply.example.org/form?success=false"),
    ).toBeNull();
    expect(
      detectSubmissionSignal(document, "https://apply.example.org/confirmation"),
    ).toBeNull();
  });
});

describe("watchForSubmissionConfirmation", () => {
  it("fires once when a single-page form renders a trustworthy success message", async () => {
    let signals = 0;
    const stop = watchForSubmissionConfirmation(() => {
      signals += 1;
    });

    document.body.insertAdjacentHTML(
      "beforeend",
      "<div role='alert'>Your application has been received.</div>",
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    document.body.insertAdjacentHTML(
      "beforeend",
      "<div role='status'>Application submitted</div>",
    );
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(signals).toBe(1);
    stop();
  });
});

describe("retryTrackedApplicationConfirmation", () => {
  it("retries a short-lived missing click record before confirming", async () => {
    let attempts = 0;
    const waits: number[] = [];

    await retryTrackedApplicationConfirmation(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("HTTP 404: No tracked JOBSAGE application was found");
      },
      async (milliseconds) => {
        waits.push(milliseconds);
      },
    );

    expect(attempts).toBe(3);
    expect(waits).toEqual([200, 500]);
  });

  it("does not retry errors other than a missing tracked click record", async () => {
    let attempts = 0;

    await expect(
      retryTrackedApplicationConfirmation(async () => {
        attempts += 1;
        throw new Error("HTTP 401: Authentication required");
      }, async () => undefined),
    ).rejects.toThrow("HTTP 401");

    expect(attempts).toBe(1);
  });
});