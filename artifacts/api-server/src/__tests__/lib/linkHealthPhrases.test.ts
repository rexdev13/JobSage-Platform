import { describe, expect, it } from "vitest";
import { EXPIRATION_PHRASES } from "../../lib/linkHealth";

describe("job-board closure phrases", () => {
  it("covers the current NHS closed-advert banner and requested variants", () => {
    expect(EXPIRATION_PHRASES).toEqual(expect.arrayContaining([
      "this job is now closed",
      "closing date was",
      "applications ended",
      "no longer open",
      "you can no longer apply",
      "this job has closed",
      "vacancy expired",
    ]));
  });
});