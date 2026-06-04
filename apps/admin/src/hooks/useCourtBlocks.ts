import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from "@tanstack/react-query";
import type { CourtBlock, CreateCourtBlock } from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";
import { COURT_LOAD_KEY } from "./useCourtLoad";

const COURT_BLOCKS_KEY = ["court-blocks"] as const;

/** Stable cache key for one day's court blocks. */
function blocksKey(date: string): readonly unknown[] {
  return [...COURT_BLOCKS_KEY, date] as const;
}

/**
 * C5/C6 — court blocks for one date (GET /court-blocks?date=…). Gated: no call
 * until a date is supplied. AuthError propagates so RequireAuth can redirect.
 */
export function useCourtBlocks(date: string | null): UseQueryResult<CourtBlock[], Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: date ? blocksKey(date) : [...COURT_BLOCKS_KEY, "idle"],
    queryFn: () => api.listCourtBlocks(date as string),
    enabled: date !== null
  });
}

/**
 * Invalidate every blocks query and every load-grid day: a created/removed block
 * changes which cells the grid shows as blocked.
 */
function invalidateBlocks(queryClient: ReturnType<typeof useQueryClient>): Promise<void> {
  return Promise.all([
    queryClient.invalidateQueries({ queryKey: COURT_BLOCKS_KEY }),
    queryClient.invalidateQueries({ queryKey: COURT_LOAD_KEY })
  ]).then(() => undefined);
}

/** C5 — create a court block; refreshes the blocks list and the load grid on success. */
export function useCreateCourtBlock(): UseMutationResult<CourtBlock, Error, CreateCourtBlock> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateCourtBlock) => api.createCourtBlock(input),
    onSuccess: () => invalidateBlocks(queryClient)
  });
}

/** C5 — remove a court block; refreshes the blocks list and the load grid on success. */
export function useDeleteCourtBlock(): UseMutationResult<void, Error, string> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteCourtBlock(id),
    onSuccess: () => invalidateBlocks(queryClient)
  });
}
