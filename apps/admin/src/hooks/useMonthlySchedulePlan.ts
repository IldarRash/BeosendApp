import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateMonthlySchedulePlanInput, MonthlySchedulePlanView, UpdateMonthlyScheduleTemplateInput } from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";

export const MONTHLY_SCHEDULE_KEY = ["monthly-schedule-plan"] as const;
const key = (year: number, month: number) => [...MONTHLY_SCHEDULE_KEY, year, month] as const;

export function useMonthlySchedulePlan(year: number, month: number) {
  const api = useApiClient();
  return useQuery({ queryKey: key(year, month), queryFn: () => api.getMonthlySchedulePlan(year, month) });
}

function replace(queryClient: ReturnType<typeof useQueryClient>, view: MonthlySchedulePlanView) {
  queryClient.setQueryData(key(view.plan.year, view.plan.month), view);
}

export function useCreateMonthlySchedulePlan() {
  const api = useApiClient(); const queryClient = useQueryClient();
  return useMutation({ mutationFn: (input: CreateMonthlySchedulePlanInput) => api.createMonthlySchedulePlan(input), onSuccess: (view) => replace(queryClient, view) });
}

export function useMonthlyScheduleActions() {
  const api = useApiClient(); const queryClient = useQueryClient();
  const accept = (result: { view: MonthlySchedulePlanView }) => replace(queryClient, result.view);
  return {
    approve: useMutation({ mutationFn: (id: string) => api.approveMonthlySchedulePlan(id), onSuccess: accept }),
    generate: useMutation({ mutationFn: (id: string) => api.generateMonthlySchedulePlan(id), onSuccess: accept }),
    publish: useMutation({ mutationFn: (id: string) => api.publishMonthlySchedulePlan(id), onSuccess: accept }),
    updateTemplate: useMutation({ mutationFn: ({ planId, templateId, input }: { planId: string; templateId: string; input: UpdateMonthlyScheduleTemplateInput }) => api.updateMonthlyScheduleTemplate(planId, templateId, input), onSuccess: accept }),
    createTemplate: useMutation({ mutationFn: ({ planId, input }: { planId: string; input: import("@beosand/types").CreateMonthlyScheduleTemplateInput }) => api.createMonthlyScheduleTemplate(planId, input), onSuccess: (view) => replace(queryClient, view) }),
    deleteTemplate: useMutation({ mutationFn: ({ planId, templateId }: { planId: string; templateId: string }) => api.deleteMonthlyScheduleTemplate(planId, templateId), onSuccess: (view) => replace(queryClient, view) })
  };
}
