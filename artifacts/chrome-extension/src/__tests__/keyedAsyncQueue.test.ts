import { describe, expect, it } from "vitest";
import { createKeyedAsyncQueue } from "../lib/keyedAsyncQueue";

describe("keyed async queue", () => {
  it("serializes a click registration that arrives while its navigation is waiting", async () => {
    const queue = createKeyedAsyncQueue<number>();
    const events: string[] = [];
    let releaseNavigation: (() => void) | undefined;
    const navigationGate = new Promise<void>((resolve) => {
      releaseNavigation = resolve;
    });

    const navigation = queue.run(12, async () => {
      events.push("navigation-start");
      await navigationGate;
      events.push("navigation-finish");
    });
    const registration = queue.run(12, async () => {
      events.push("registration");
    });

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(["navigation-start"]);

    releaseNavigation?.();
    await Promise.all([navigation, registration]);
    expect(events).toEqual(["navigation-start", "navigation-finish", "registration"]);
  });

  it("does not block independent tabs", async () => {
    const queue = createKeyedAsyncQueue<number>();
    const events: string[] = [];

    await Promise.all([
      queue.run(1, async () => events.push("first")),
      queue.run(2, async () => events.push("second")),
    ]);

    expect(events).toEqual(expect.arrayContaining(["first", "second"]));
  });
});