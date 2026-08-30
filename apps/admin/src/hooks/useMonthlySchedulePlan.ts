import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CreateMonthlySchedulePlanInput,
  GenerateMonthlySchedulePlanInput,
  MonthlySchedulePlanView,
  UpdateMonthlySchedulePeriodInput,
  UpdateMonthlyScheduleTemplateInput
} from "@beosand/types";
import { useApiClient } from "../api/ApiProvider";

export const MONTHLY_SCHEDULE_KEY = ["monthly-schedule-plan"] as const;
const key = (startDate: string, endDate: string) =>
  [...MONTHLY_SCHEDULE_KEY, startDate, endDate] as const;
export function useMonthlySchedulePlan(startDate: string, endDate: string) {
  const api = useApiClient();
  return useQuery({
    queryKey: key(startDate, endDate),
    queryFn: () => api.getMonthlySchedulePlan(startDate, endDate)
  });
}
function replace(queryClient: ReturnType<typeof useQueryClient>, view: MonthlySchedulePlanView) {
  queryClient.setQueryData(key(view.plan.startDate, view.plan.endDate), view);
}
export function useCreateMonthlySchedulePlan() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateMonthlySchedulePlanInput) => api.createMonthlySchedulePlan(input),
    onSuccess: (view) => replace(queryClient, view)
  });
}
export function useMonthlyScheduleActions() {
  const api = useApiClient();
  const queryClient = useQueryClient();
  const accept = (result: { view: MonthlySchedulePlanView }) => replace(queryClient, result.view);
  return {
    approve: useMutation({
      mutationFn: (id: string) => api.approveMonthlySchedulePlan(id),
      onSuccess: accept
    }),
    generate: useMutation({
      mutationFn: ({
        planId,
        input
      }: {
        planId: string;
        input: GenerateMonthlySchedulePlanInput;
      }) => api.generateMonthlySchedulePlan(planId, input),
      onSuccess: accept
    }),
    publish: useMutation({
      mutationFn: (id: string) => api.publishMonthlySchedulePlan(id),
      onSuccess: accept
    }),
    updatePeriod: useMutation({
      mutationFn: ({
        planId,
        input
      }: {
        planId: string;
        input: UpdateMonthlySchedulePeriodInput;
      }) => api.updateMonthlySchedulePeriod(planId, input),
      onSuccess: (view) => replace(queryClient, view)
    }),
    markDayOff: useMutation({
      mutationFn: ({ planId, date }: { planId: string; date: string }) =>
        api.markMonthlyScheduleDayOff(planId, date),
      onSuccess: (view) => replace(queryClient, view)
    }),
    unmarkDayOff: useMutation({
      mutationFn: ({ planId, date }: { planId: string; date: string }) =>
        api.unmarkMonthlyScheduleDayOff(planId, date),
      onSuccess: (view) => replace(queryClient, view)
    }),
    updateTemplate: useMutation({
      mutationFn: ({
        planId,
        templateId,
        input
      }: {
        planId: string;
        templateId: string;
        input: UpdateMonthlyScheduleTemplateInput;
      }) => api.updateMonthlyScheduleTemplate(planId, templateId, input),
      onSuccess: accept
    }),
    createTemplate: useMutation({
      mutationFn: ({
        planId,
        input
      }: {
        planId: string;
        input: import("@beosand/types").CreateMonthlyScheduleTemplateInput;
      }) => api.createMonthlyScheduleTemplate(planId, input),
      onSuccess: (view) => replace(queryClient, view)
    }),
    deleteTemplate: useMutation({
      mutationFn: ({ planId, templateId }: { planId: string; templateId: string }) =>
        api.deleteMonthlyScheduleTemplate(planId, templateId),
      onSuccess: (view) => replace(queryClient, view)
    })
  };
}
