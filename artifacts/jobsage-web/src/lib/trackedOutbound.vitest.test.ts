import { afterEach, describe, expect, it, vi } from "vitest";
import { openTrackedOutbound, openTrackedSponsorVacancy } from "./trackedOutbound";

describe("tracked outbound navigation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("records one vacancy click, hands it to the extension, then opens immediately", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    const openMock = vi.spyOn(window, "open").mockImplementation(() => null);
    vi.stubGlobal("fetch", fetchMock);
    const eventListener = vi.fn();
    window.addEventListener("jobsage:outbound-application", eventListener);

    await openTrackedOutbound({
      url: "https://employer.example/apply?source=listing",
      vacancy: {
        roleId: 41,
        title: "Staff Nurse",
        employer: "Example Trust",
        canonicalUrl: "https://employer.example/apply?source=listing",
      },
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/applications", expect.objectContaining({
      method: "POST",
      credentials: "include",
      body: JSON.stringify({
        applicationType: "website",
        status: "link_clicked",
        roleId: 41,
        companyName: "Example Trust",
        jobTitle: "Staff Nurse",
        applicationUrl: "https://employer.example/apply?source=listing&ref=jobsage",
      }),
    }));
    expect(eventListener).toHaveBeenCalledOnce();
    expect(eventListener.mock.calls[0][0].detail).toEqual(expect.objectContaining({
      roleId: 41,
      canonicalUrl: "https://employer.example/apply?source=listing",
      applicationUrl: "https://employer.example/apply?source=listing&ref=jobsage",
    }));
    expect(openMock).toHaveBeenCalledWith(
      "https://employer.example/apply?source=listing&ref=jobsage",
      "_blank",
      "noopener,noreferrer",
    );
    window.removeEventListener("jobsage:outbound-application", eventListener);
  });

  it("opens employer websites without creating a vacancy application", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const openMock = vi.spyOn(window, "open").mockImplementation(() => null);

    await openTrackedOutbound({ url: "https://employer.example/careers" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(openMock).toHaveBeenCalledOnce();
  });

  it("keeps the raw sponsor vacancy id in its click record and extension event", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    vi.stubGlobal("fetch", fetchMock);
    const eventListener = vi.fn();
    window.addEventListener("jobsage:outbound-application", eventListener);

    await openTrackedSponsorVacancy({
      vacancyId: 73,
      url: "https://employer.example/vacancy",
      title: "Carer",
      employer: "Sponsor Ltd",
    });

    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(expect.objectContaining({ roleId: 73 }));
    expect(eventListener.mock.calls[0][0].detail.roleId).toBe(73);
    window.removeEventListener("jobsage:outbound-application", eventListener);
  });
});