import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from "@tanstack/react-query";
import type { CourtBlock, CreateCourtBlock } from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";
import type { DateRange } from "../ui/DateRangeFilter";
import { COURT_LOAD_KEY } from "./useCourtLoad";

const COURT_BLOCKS_KEY = ["court-blocks"] as const;

/** Stable cache key for one inclusive `from..to` range of court blocks. */
function blocksKey(range: DateRange): readonly unknown[] {
  return [...COURT_BLOCKS_KEY, range.from, range.to] as const;
}

/**
 * C5/C6 — court blocks over an inclusive date range (GET /court-blocks?from=…&to=…).
 * Gated: no call until a range is supplied (single day = `from === to`). AuthError
 * propagates so RequireAuth can redirect.
 */
export function useCourtBlocks(range: DateRange | null): UseQueryResult<CourtBlock[], Error> {
  const api = useApiClient();
  return useQuery({
    queryKey: range ? blocksKey(range) : [...COURT_BLOCKS_KEY, "idle"],
    queryFn: () => api.listCourtBlocks(range as DateRange),
    enabled: range !== null
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

/**
 * Move a block to another court (PATCH /court-blocks/:id). Surfaced for group
 * auto-blocks; refreshes the blocks list and the load grid on success. A 409
 * (target court clash / over the limit) surfaces as a thrown Error the screen
 * renders — the client computes no availability itself.
 */
export function useReassignCourtBlock(): UseMutationResult<
  CourtBlock,
  Error,
  { id: string; courtId: string }
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, courtId }) => api.reassignCourtBlock(id, courtId),
    onSuccess: () => invalidateBlocks(queryClient)
  });
}
