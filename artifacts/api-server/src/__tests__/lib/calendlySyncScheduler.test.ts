import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  scheduleMock,
  syncCalendlyEventsMock,
  getCalendlyConnectionIssueMock,
  loggerWarnMock,
  loggerErrorMock,
  loggerInfoMock,
} = vi.hoisted(() => ({
  scheduleMock: vi.fn(),
  syncCalendlyEventsMock: vi.fn(),
  getCalendlyConnectionIssueMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  loggerInfoMock: vi.fn(),
}));

vi.mock("node-cron", () => ({
  default: { schedule: scheduleMock },
}));

vi.mock("../../lib/calendlySync", () => ({
  getCalendlyConnectionIssue: getCalendlyConnectionIssueMock,
  syncCalendlyEvents: syncCalendlyEventsMock,
}));

vi.mock("../../lib/logger", () => ({
  logger: {
    warn: loggerWarnMock,
    error: loggerErrorMock,
    info: loggerInfoMock,
  },
}));

const { startCalendlySyncScheduler } = await import("../../lib/calendlySyncScheduler");

describe("Calendly sync scheduler connection handling", () => {
  beforeEach(() => {
    scheduleMock.mockReset();
    syncCalendlyEventsMock.mockReset();
    getCalendlyConnectionIssueMock.mockReset();
    loggerWarnMock.mockReset();
    loggerErrorMock.mockReset();
    loggerInfoMock.mockReset();
  });

  it("reports an absent connection as disconnected, not as an operational failure", async () => {
    const missingConnection = new Error("Calendly is not connected.");
    syncCalendlyEventsMock.mockRejectedValue(missingConnection);
    getCalendlyConnectionIssueMock.mockReturnValue({ connectionStatus: "disconnected" });

    startCalendlySyncScheduler();
    const scheduledTick = scheduleMock.mock.calls[0]?.[1];
    expect(typeof scheduledTick).toBe("function");

    scheduledTick();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(getCalendlyConnectionIssueMock).toHaveBeenCalledWith(missingConnection);
    expect(loggerWarnMock).toHaveBeenCalledWith(
      { connectionStatus: "disconnected" },
      "Calendly sync is waiting for a valid connection",
    );
    expect(loggerErrorMock).not.toHaveBeenCalled();
  });
});
