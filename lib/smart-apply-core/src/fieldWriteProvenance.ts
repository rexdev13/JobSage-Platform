type WritableField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

const extensionWrites = new WeakSet<WritableField>();
const extensionValues = new WeakMap<WritableField, string>();

function valueFingerprint(field: WritableField): string {
  if (field.tagName === "INPUT" && (field as HTMLInputElement).type === "radio") {
    const input = field as HTMLInputElement;
    return `${input.checked ? "checked" : "unchecked"}:${input.value}`;
  }
  return field.value;
}

/**
 * Programmatic JOBSAGE writes dispatch the same DOM events as candidate input.
 * Keep the marker active for the full synchronous event dispatch so answer
 * memory can ignore profile, AI, and restore writes.
 */
export function runExtensionFieldWrite<T>(field: WritableField, write: () => T): T {
  extensionWrites.add(field);
  try {
    return write();
  } finally {
    extensionValues.set(field, valueFingerprint(field));
    extensionWrites.delete(field);
  }
}

export function isExtensionFieldWrite(field: WritableField): boolean {
  return extensionWrites.has(field);
}

/**
 * A blur may occur well after the synchronous extension write. Preserve the
 * written value so an unchanged profile/AI/memory value is never mistaken for
 * candidate-authored input. Any real candidate edit changes the fingerprint.
 */
export function hasUnchangedExtensionValue(field: WritableField): boolean {
  const written = extensionValues.get(field);
  if (written === undefined) return false;
  if (written !== valueFingerprint(field)) {
    extensionValues.delete(field);
    return false;
  }
  return true;
}