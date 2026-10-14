import { describe, expect, it, jest } from "@jest/globals";
import { NativeSessionLifecycle } from "@/lib/native-session-lifecycle";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const flush = async () => { for (let i = 0; i < 10; ++i) await Promise.resolve(); };
function fixture(initial: string | null = null) {
  let stored = initial;
  const states: Array<{ token: string | null; loading: boolean }> = [];
  const deps = {
    read: jest.fn(async () => stored),
    write: jest.fn(async (token: string) => { stored = token; }),
    clear: jest.fn(async () => { stored = null; }),
    validate: jest.fn(async (_token: string, _signal: AbortSignal): Promise<string | null> => "user-a"),
    revoke: jest.fn(async (_token: string) => {}),
    changed: (session: { token: string; user: string } | null, loading: boolean) => { states.push({ token: session?.token ?? null, loading }); },
    started: jest.fn(),
  };
  return { deps, states, stored: () => stored, scope: new NativeSessionLifecycle(deps) };
}
describe("native session operation ordering", () => {
  it("does not let delayed logout clear a newer login and revokes only its captured token", async () => {
    const f = fixture();
    await f.scope.login("token-a", "user-a");
    const revocation = deferred<void>();
    f.deps.revoke.mockImplementation(() => revocation.promise);
    const oldLogout = f.scope.logout().catch(error => error);
    await flush();
    expect(f.states.at(-1)?.token).toBeNull();
    await f.scope.login("token-b", "user-b");
    revocation.resolve();
    expect((await oldLogout).name).toBe("AbortError");
    expect(f.deps.revoke).toHaveBeenCalledWith("token-a");
    expect(f.stored()).toBe("token-b");
    expect(f.states.at(-1)?.token).toBe("token-b");
  });
  it("ignores a stored-session validation that returns after a new login", async () => {
    const f = fixture("token-a");
    const validation = deferred<string | null>();
    f.deps.validate.mockImplementation(() => validation.promise);
    const oldBoot = f.scope.bootstrap();
    await flush();
    await f.scope.login("token-b", "user-b");
    validation.resolve("user-a"); await oldBoot;
    expect(f.states.at(-1)?.token).toBe("token-b");
    expect(f.stored()).toBe("token-b");
  });
  it("does not clear the new credential after a stale unauthorized response", async () => {
    const f = fixture("token-a");
    const validation = deferred<string | null>();
    f.deps.validate.mockImplementation(() => validation.promise);
    const oldBoot = f.scope.bootstrap();
    await flush();
    await f.scope.login("token-b", "user-b");
    validation.reject({ status: 401 }); await oldBoot;
    expect(f.deps.clear).not.toHaveBeenCalled();
    expect(f.stored()).toBe("token-b");
  });
  it("serializes overlapping writes and only unlocks the newest login", async () => {
    const f = fixture();
    const write = deferred<void>();
    const normalWrite = f.deps.write.getMockImplementation()!;
    f.deps.write.mockImplementation(async token => {
      if (token === "token-a") await write.promise;
      await normalWrite(token);
    });
    const a = f.scope.login("token-a", "user-a").catch(error => error);
    await flush();
    const b = f.scope.login("token-b", "user-b");
    await flush(); write.resolve();
    expect((await a).name).toBe("AbortError"); await b;
    expect(f.states.some(state => state.token === "token-a")).toBe(false);
    expect(f.stored()).toBe("token-b");
  });
  it("keeps offline credentials protected without unlocking cached user data", async () => {
    const f = fixture("token-a");
    f.deps.validate.mockRejectedValue(new Error("Offline"));
    await f.scope.bootstrap();
    expect(f.stored()).toBe("token-a");
    expect(f.states.at(-1)).toEqual({ token: null, loading: false });
  });
  it("clears expired stored credentials", async () => {
    const f = fixture("token-a");
    f.deps.validate.mockRejectedValue({ status: 401 });
    await f.scope.bootstrap();
    expect(f.stored()).toBeNull();
    expect(f.states.at(-1)).toEqual({ token: null, loading: false });
  });
  it("rejects failed secure writes and recovers for the next login", async () => {
    const f = fixture();
    f.deps.write.mockRejectedValueOnce(new Error("Keystore unavailable"));
    await expect(f.scope.login("token-a", "user-a")).rejects.toThrow("Keystore unavailable");
    expect(f.states.at(-1)).toEqual({ token: null, loading: false });
    await f.scope.login("token-b", "user-b");
    expect(f.stored()).toBe("token-b");
  });
  it("ignores validation results after disposal", async () => {
    const f = fixture("token-a");
    const validation = deferred<string | null>();
    f.deps.validate.mockImplementation(() => validation.promise);
    const boot = f.scope.bootstrap(); await flush();
    f.scope.stop();
    validation.resolve("user-a"); await boot;
    expect(f.states.some(state => state.token === "token-a")).toBe(false);
  });
  it("does not unlock after validation exceeds its deadline, even if transport ignores abort", async () => {
    jest.useFakeTimers();
    try {
      const f = fixture("token-a");
      const validation = deferred<string | null>();
      f.deps.validate.mockImplementation(() => validation.promise);
      const boot = f.scope.bootstrap(); await flush();
      await jest.advanceTimersByTimeAsync(15_000);
      validation.resolve("user-a"); await boot;
      expect(f.states.at(-1)).toEqual({ token: null, loading: false });
      expect(f.stored()).toBe("token-a");
    } finally { jest.useRealTimers(); }
  });
  it("serializes storage even when a new provider replaces the old one", async () => {
    const f = fixture();
    const write = deferred<void>();
    const normalWrite = f.deps.write.getMockImplementation()!;
    f.deps.write.mockImplementation(async token => {
      if (token === "token-a") await write.promise;
      await normalWrite(token);
    });
    const a = f.scope.login("token-a", "user-a").catch(error => error);
    await flush(); f.scope.stop();
    const replacement = new NativeSessionLifecycle(f.deps);
    const b = replacement.login("token-b", "user-b");
    await flush(); write.resolve();
    expect((await a).name).toBe("AbortError"); await b;
    expect(f.stored()).toBe("token-b");
  });
});
