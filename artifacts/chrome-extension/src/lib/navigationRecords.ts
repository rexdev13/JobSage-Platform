/** Remove and return one matching navigation record without disturbing others. */
export function takeMatchingRecord<T>(
  records: T[],
  matches: (record: T) => boolean,
): T | null {
  const index = records.findIndex(matches);
  if (index < 0) return null;
  return records.splice(index, 1)[0] ?? null;
}