import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult
} from "@tanstack/react-query";
import type { CreateTrainerInput, Trainer, UpdateTrainerInput } from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";

const TRAINERS_KEY = ["trainers"] as const;

/** Active trainers (GET /trainers), validated by the ApiClient. */
export function useTrainers(): UseQueryResult<Trainer[], Error> {
  const api = useApiClient();
  return useQuery({ queryKey: TRAINERS_KEY, queryFn: () => api.listTrainers() });
}

/** Create a trainer (optional telegramId link); invalidates the list on success. */
export function useCreateTrainer(): UseMutationResult<Trainer, Error, CreateTrainerInput> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTrainerInput) => api.createTrainer(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TRAINERS_KEY })
  });
}

/** Update a trainer (name/type/status/telegramId); invalidates the list on success. */
export function useUpdateTrainer(): UseMutationResult<
  Trainer,
  Error,
  { id: string; input: UpdateTrainerInput }
> {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdateTrainerInput }) =>
      api.updateTrainer(id, input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: TRAINERS_KEY })
  });
}
