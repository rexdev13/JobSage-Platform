export function shouldAutoRefreshSector(
  previousIndustry: string,
  nextIndustry: string,
): boolean {
  return nextIndustry !== "" && nextIndustry !== previousIndustry;
}