// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { hasApplicationForm } from "../lib/scraper";

afterEach(() => {
  document.body.innerHTML = "";
  history.replaceState({}, "", "/");
});

describe("hasApplicationForm", () => {
  it("stays false for an ordinary job-listing/search page", () => {
    document.body.innerHTML = `
      <form action="/search">
        <input name="keyword" type="search">
        <button type="submit">Search jobs</button>
      </form>
    `;

    expect(hasApplicationForm()).toBe(false);
  });

  it("recognises a first application step with standard profile controls", () => {
    history.replaceState({}, "", "/vacancies/42/apply");
    document.body.innerHTML = `
      <form>
        <input name="firstName" type="text">
        <input name="email" type="email">
      </form>
    `;

    expect(hasApplicationForm()).toBe(true);
  });

  it("recognises supporting statements even on custom application routes", () => {
    document.body.innerHTML = `
      <textarea name="supporting-information"></textarea>
    `;

    expect(hasApplicationForm()).toBe(true);
  });
});