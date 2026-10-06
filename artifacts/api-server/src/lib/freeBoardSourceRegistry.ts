import { FREE_BOARD_SOURCES, type FreeBoardSource } from "./freeBoardSources";
import { SUPPLEMENTAL_FREE_BOARD_SOURCES } from "./supplementalFreeBoardSources";

export const ALL_FREE_BOARD_SOURCES: readonly FreeBoardSource[] = [
  ...FREE_BOARD_SOURCES,
  ...SUPPLEMENTAL_FREE_BOARD_SOURCES,
];

const FREE_BOARD_SOURCE_IDS = new Set(ALL_FREE_BOARD_SOURCES.map((source) => source.id));

export function isFreeBoardSourceId(value: unknown): value is string {
  return typeof value === "string" && FREE_BOARD_SOURCE_IDS.has(value);
}
