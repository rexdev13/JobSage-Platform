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