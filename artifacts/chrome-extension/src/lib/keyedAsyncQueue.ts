/**
 * Runs asynchronous work for the same key in strict order while allowing
 * unrelated keys to proceed independently.
 */
export function createKeyedAsyncQueue<K>() {
  const tails = new Map<K, Promise<void>>();

  return {
    run<T>(key: K, work: () => Promise<T>): Promise<T> {
      const previous = tails.get(key) ?? Promise.resolve();
      const result = previous.catch(() => undefined).then(work);
      const tail = result.then(() => undefined, () => undefined);
      tails.set(key, tail);
      void tail.finally(() => {
        if (tails.get(key) === tail) tails.delete(key);
      });
      return result;
    },
  };
}