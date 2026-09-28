export function normalizeSponsorIdentityValue(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFKC")
    .toLocaleLowerCase("en-GB")
    .replace(/&/g, " and ")
    .replace(/[’'`]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeSponsorLegalNameValue(value: string | null | undefined): string {
  return normalizeSponsorIdentityValue(value).replace(/\bltd$/, "limited");
}