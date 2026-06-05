import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from "@tanstack/react-query";
import type { GroupMembers, TransferGroupInput, TransferGroupResult } from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";

const GROUP_MEMBERS_KEY = ["group-members"] as const;

/** Stable cache key for one group's members in a given month. */
function groupMembersKey(groupId: string, year: number, month: number): readonly unknown[] {
  return [...GROUP_MEMBERS_KEY, groupId, year, month] as const;
}

/**
 * A group's members for a month (GET /groups/:id/members). `enabled` only once a
 * group is selected, mirroring useRoster — an unselected drawer makes no call. An
 * AuthError from the ApiClient propagates so RequireAuth can redirect on 401.
 */
export function useGroupMembers(
  groupId: string | null,
  year: number,
  month: number
): UseQueryResult<GroupMembers, Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: groupId ? groupMembersKey(groupId, year, month) : [...GROUP_MEMBERS_KEY, "idle"],
    queryFn: () => api.getGroupMembers(groupId as string, year, month),
    enabled: groupId !== null
  });
}

/**
 * Move a client between groups for a month; on success invalidates the groups,
 * group-members, and bookings caches so every affected screen re-reads the server's
 * decided state (the console computes none of the transfer math itself).
 */
export function useTransferGroupMember(): UseMutationResult<
  TransferGroupResult,
  Error,
  TransferGroupInput
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: TransferGroupInput) => api.transferGroupMember(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["groups"] });
      void queryClient.invalidateQueries({ queryKey: GROUP_MEMBERS_KEY });
      void queryClient.invalidateQueries({ queryKey: ["bookings"] });
    }
  });
}
