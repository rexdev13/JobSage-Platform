// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { prefillPersonalDetails } from "../lib/prefill";
import { findCvFileInput } from "../lib/cvAttachment";

beforeEach(() => {
  document.body.innerHTML = "";
});

describe("prefillPersonalDetails", () => {
  it("fills only empty, labelled, safe profile fields and announces missing data", () => {
    document.body.innerHTML = `
      <label for="first">First name</label><input id="first" autocomplete="given-name">
      <label for="last">Last name</label><input id="last" value="Already entered">
      <label for="mail">Email address</label><input id="mail" type="email">
      <label for="tel">Mobile phone</label><input id="tel">
      <label for="post">Postcode</label><input id="post">
      <label for="password">Password</label><input id="password" type="password">
      <label for="ni">National Insurance number</label><input id="ni">
    `;
    const result = prefillPersonalDetails({
      firstName: "Ada",
      lastName: "Lovelace",
      email: "ada@example.test",
    });

    expect((document.getElementById("first") as HTMLInputElement).value).toBe("Ada");
    expect((document.getElementById("last") as HTMLInputElement).value).toBe("Already entered");
    expect((document.getElementById("mail") as HTMLInputElement).value).toBe("ada@example.test");
    expect((document.getElementById("password") as HTMLInputElement).value).toBe("");
    expect((document.getElementById("ni") as HTMLInputElement).value).toBe("");
    expect(result.filled).toEqual(["first name", "email"]);
    expect(result.missing).toEqual(expect.arrayContaining(["phone", "postcode"]));
  });

  it("does not fill an ambiguous bare name field", () => {
    document.body.innerHTML = `<label for="name">Name</label><input id="name">`;
    const result = prefillPersonalDetails({ fullName: "Ada Lovelace" });
    expect((document.getElementById("name") as HTMLInputElement).value).toBe("");
    expect(result.filled).toEqual([]);
  });

  it("preserves typed contact details and selects only a clear UK country option", () => {
    document.body.innerHTML = `
      <label for="street">Street address</label><input id="street">
      <label for="country">Country</label>
      <select id="country"><option value="">Choose</option><option value="GB">United Kingdom</option><option value="IE">Ireland</option></select>
      <label for="typed">City</label><input id="typed" value="Already typed">
    `;
    const result = prefillPersonalDetails({
      streetAddress: "10 Example Road",
      city: "Leeds",
      country: "United Kingdom",
    });

    expect((document.getElementById("street") as HTMLInputElement).value).toBe("10 Example Road");
    expect((document.getElementById("country") as HTMLSelectElement).value).toBe("GB");
    expect((document.getElementById("typed") as HTMLInputElement).value).toBe("Already typed");
    expect(result.filled).toEqual(expect.arrayContaining(["street address", "country"]));
  });

  it("fills every matching empty safe field while preserving filled and password fields", () => {
    document.body.innerHTML = `
      <label for="phone-primary">Phone</label><input id="phone-primary">
      <label for="phone-confirm">Contact number</label><input id="phone-confirm">
      <label for="phone-existing">Mobile phone</label><input id="phone-existing" value="Keep me">
      <label for="password-again">Password</label><input id="password-again" type="password">
    `;

    prefillPersonalDetails({ phone: "07123456789" });

    expect((document.getElementById("phone-primary") as HTMLInputElement).value).toBe("07123456789");
    expect((document.getElementById("phone-confirm") as HTMLInputElement).value).toBe("07123456789");
    expect((document.getElementById("phone-existing") as HTMLInputElement).value).toBe("Keep me");
    expect((document.getElementById("password-again") as HTMLInputElement).value).toBe("");
  });

  it("fills an empty position field only from trusted vacancy context", () => {
    document.body.innerHTML = `
      <label for="position">Position applied for</label><input id="position">
      <label for="company">Employer name</label><input id="company">
      <label for="existing-role">Job title</label><input id="existing-role" value="Keep this role">
    `;

    const result = prefillPersonalDetails(
      {},
      document,
      { jobTitle: "Band 5/6 Nurse" },
    );

    expect((document.getElementById("position") as HTMLInputElement).value).toBe("Band 5/6 Nurse");
    expect((document.getElementById("company") as HTMLInputElement).value).toBe("");
    expect((document.getElementById("existing-role") as HTMLInputElement).value).toBe("Keep this role");
    expect(result.filled).toContain("position applied for");
  });

  it("fills safe identity fields inside a same-origin iframe", () => {
    const iframe = document.createElement("iframe");
    document.body.appendChild(iframe);
    const iframeDocument = iframe.contentDocument!;
    iframeDocument.body.innerHTML = `
      <label for="first">First name</label><input id="first">
      <label for="phone">Telephone</label><input id="phone" type="tel">
    `;

    const result = prefillPersonalDetails({ firstName: "Ada", phone: "07123456789" });

    expect((iframeDocument.getElementById("first") as HTMLInputElement).value).toBe("Ada");
    expect((iframeDocument.getElementById("phone") as HTMLInputElement).value).toBe("07123456789");
    expect(result.filled).toEqual(expect.arrayContaining(["first name", "phone"]));
  });
});

describe("findCvFileInput", () => {
  it("prefers an explicit CV input and never a profile photo input", () => {
    document.body.innerHTML = `
      <label for="photo">Profile photo</label><input id="photo" type="file" accept="image/*">
      <label for="cv">Upload CV</label><input id="cv" type="file" accept=".pdf,.docx">
    `;
    expect(findCvFileInput()?.id).toBe("cv");
  });

  it("does not attach a CV to a sole photo, identity, or generic file input", () => {
    document.body.innerHTML = `
      <label for="photo">Profile photo</label><input id="photo" type="file" accept="image/*">
    `;
    expect(findCvFileInput()).toBeNull();

    document.body.innerHTML = `
      <label for="passport">Passport document</label><input id="passport" type="file">
    `;
    expect(findCvFileInput()).toBeNull();

    document.body.innerHTML = `<input id="attachment" type="file">`;
    expect(findCvFileInput()).toBeNull();
  });

  it("supports a strongly labelled native CV control hidden behind ATS styling", () => {
    document.body.innerHTML = `
      <label for="hidden-cv">Upload your CV</label>
      <input id="hidden-cv" type="file" style="display:none">
    `;
    expect(findCvFileInput()?.id).toBe("hidden-cv");
  });

  it("recognises a shared CV / awards / certificates upload control", () => {
    document.body.innerHTML = `
      <label for="application-documents">CV / Awards / Certificates</label>
      <input id="application-documents" type="file" accept=".pdf,.doc,.docx">
    `;
    expect(findCvFileInput()?.id).toBe("application-documents");
  });

  it("rejects cover-letter and generic PDF upload inputs without a CV label", () => {
    document.body.innerHTML = `
      <label for="cover-letter">Upload cover letter</label>
      <input id="cover-letter" type="file" accept=".pdf,.docx">
    `;
    expect(findCvFileInput()).toBeNull();

    document.body.innerHTML = `<input id="document" type="file" accept="application/pdf">`;
    expect(findCvFileInput()).toBeNull();
  });
});