type Session<User> = { token: string; user: User };
type Dependencies<User> = {
  read: () => Promise<string | null>;
  write: (token: string) => Promise<void>;
  clear: () => Promise<void>;
  validate: (token: string, signal: AbortSignal) => Promise<User | null>;
  revoke: (token: string) => Promise<void>;
  changed: (session: Session<User> | null, loading: boolean) => void;
  started: () => void;
};

function superseded() {
  const error = new Error("A newer account operation superseded this request.");
  error.name = "AbortError";
  return error;
}

// Shared across provider remounts too: a late old keystore write must finish
// before a new provider writes the replacement credential.
let storageTail: Promise<unknown> = Promise.resolve();

/** Serializes keystore side effects; only the newest operation can unlock UI. */
export class NativeSessionLifecycle<User> {
  private revision = 0;
  private stopped = false;
  private session: Session<User> | null = null;
  private validation: AbortController | null = null;
  constructor(private readonly deps: Dependencies<User>) {}

  private current(revision: number) { return !this.stopped && this.revision === revision; }
  private begin() {
    this.validation?.abort(); this.validation = null;
    this.stopped = false;
    this.deps.started();
    return ++this.revision;
  }
  private publish(session: Session<User> | null, loading: boolean) {
    this.session = session;
    this.deps.changed(session, loading);
  }
  private storage<T>(revision: number, operation: () => Promise<T>, skipped: T): Promise<T> {
    const result = storageTail.then(() => this.current(revision) ? operation() : skipped);
    // A failed write must not poison the queue for the next sign-in.
    storageTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async bootstrap() {
    const revision = this.begin();
    this.publish(null, true);
    const controller = new AbortController();
    this.validation = controller;
    const timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const token = await this.storage(revision, this.deps.read, null);
      if (!this.current(revision) || !token) return;
      const user = await this.deps.validate(token, controller.signal);
      if (!this.current(revision) || controller.signal.aborted) return;
      if (user) this.publish({ token, user }, false);
      else await this.storage(revision, this.deps.clear, undefined);
    } catch (error) {
      if (!this.current(revision)) return;
      if (error && typeof error === "object" && "status" in error
        && (error.status === 401 || error.status === 403)) {
        await this.storage(revision, this.deps.clear, undefined);
      }
      // Offline is not authorization. Retain the protected credential for retry.
    } finally {
      clearTimeout(timer);
      if (this.validation === controller) this.validation = null;
      if (this.current(revision)) this.publish(this.session, false);
    }
  }

  async login(token: string, user: User) {
    const revision = this.begin();
    this.publish(null, true);
    try {
      await this.storage(revision, () => this.deps.write(token), undefined);
      if (!this.current(revision)) throw superseded();
      this.publish({ token, user }, false);
    } catch (error) {
      if (this.current(revision)) this.publish(null, false);
      throw error;
    }
  }

  async logout() {
    const token = this.session?.token;
    const revision = this.begin();
    // Immediately invalidate local capabilities, not after network revocation.
    this.publish(null, false);
    const results = await Promise.allSettled([
      this.storage(revision, this.deps.clear, undefined),
      token ? this.deps.revoke(token) : Promise.resolve(),
    ]);
    if (!this.current(revision)) throw superseded();
    for (const result of results) if (result.status === "rejected") throw result.reason;
  }

  stop() {
    this.stopped = true; ++this.revision;
    this.validation?.abort(); this.validation = null;
    this.session = null;
    this.deps.started();
  }
}
