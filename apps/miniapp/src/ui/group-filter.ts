/**
 * The group-list filter selection — a UI model, NOT a domain contract, so it lives
 * in the design layer (mirrors {@link SlotFilters} for the browse screen). Every
 * field is optional ("any"); the group screen narrows the {@link useGroups} result
 * client-side via {@link matchesGroupFilter} and clears a field when it is unset.
 *
 * This is pure presentation filtering (membership checks on values the API already
 * decided), never domain/availability math — the server still owns the group set.
 */
import type { DayOfWeek, Group } from "@beosand/types";

export interface GroupFilters {
  /** ISO weekday 1–7; a group matches when its `daysOfWeek` includes this day. */
  weekday?: DayOfWeek;
  /** A group matches when its `trainerId` equals this. */
  trainerId?: string;
  /** A group matches when its `levelId` equals this. */
  levelId?: string;
}

/**
 * Whether a group passes the (possibly empty) filter. Each unset field is "any" and
 * passes every group; a set field narrows by membership (weekday) or equality
 * (level / trainer). Pure and total — no side effects, no domain math.
 */
export function matchesGroupFilter(group: Group, filters: GroupFilters): boolean {
  if (filters.weekday !== undefined && !group.daysOfWeek.includes(filters.weekday)) {
    return false;
  }
  if (filters.levelId !== undefined && group.levelId !== filters.levelId) {
    return false;
  }
  if (filters.trainerId !== undefined && group.trainerId !== filters.trainerId) {
    return false;
  }
  return true;
}

/** How many filter fields are set, for the filter chip's active-count badge. */
export function activeGroupFilterCount(filters: GroupFilters): number {
  return [filters.weekday, filters.levelId, filters.trainerId].filter((v) => v !== undefined)
    .length;
}
