import { useState } from "react";
import type {
  ListSubscriptionsQuery,
  SubscriptionPaymentState,
  SubscriptionSummary
} from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { SelectField } from "../ui/Field";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { useT } from "../i18n/LanguageProvider";
import { formatRsd } from "../lib/format";
import { useMarkSubscriptionPaid, useSubscriptions } from "../hooks/useSubscriptions";

type Translate = (key: string, params?: Record<string, string | number>) => string;

type StateFilter = SubscriptionPaymentState | "all";

/** The payment-state filter options, in order; "all" clears the server filter. */
const STATE_FILTERS: readonly StateFilter[] = ["all", "unpaid", "partial", "paid"];

/** Catalog key for one payment state — the server owns the value, we only label it. */
function stateLabel(state: SubscriptionPaymentState, t: Translate): string {
  switch (state) {
    case "paid":
      return t("admin.subscriptions.statePaid");
    case "partial":
      return t("admin.subscriptions.statePartial");
    case "unpaid":
      return t("admin.subscriptions.stateUnpaid");
  }
}

/** Tag tone per payment state: paid is ok, unpaid a warning, partial neutral. */
function stateTagClass(state: SubscriptionPaymentState): string {
  if (state === "paid") return "tag tag--ok";
  if (state === "unpaid") return "tag tag--warn";
  return "tag";
}

/**
 * Subscription payments: the monthly group subscriptions (bookings sharing one
 * groupSubscriptionId) with a payment-state filter and a per-row paid/unpaid
 * toggle. Counts, totals, and the payment state are all server-decided over
 * non-cancelled bookings; this screen renders the validated rows and never sums
 * money or derives state itself.
 */
export function Subscriptions(): JSX.Element {
  const t = useT();
  const { notify } = useToast();

  const [stateFilter, setStateFilter] = useState<StateFilter>("all");
  const [pending, setPending] = useState<SubscriptionSummary | null>(null);

  const filters: ListSubscriptionsQuery =
    stateFilter !== "all" ? { paymentState: stateFilter } : {};
  const subscriptions = useSubscriptions(filters);
  const markPaid = useMarkSubscriptionPaid();

  // A fully-paid subscription is "snapped back" to unpaid; anything else is marked
  // paid. The target `paid` value is the server's job to apply to the whole batch.
  const targetPaid = pending ? pending.paymentState !== "paid" : false;

  function closeConfirm(): void {
    setPending(null);
  }

  function submit(): void {
    if (!pending) return;
    markPaid.mutate(
      { id: pending.groupSubscriptionId, paid: targetPaid },
      {
        onSuccess: () => {
          notify(t("admin.subscriptions.marked", { client: pending.clientName }), "success");
          closeConfirm();
        },
        onError: (error) =>
          notify(error instanceof Error ? error.message : t("admin.subscriptions.markError"), "error")
      }
    );
  }

  const stateOptions = STATE_FILTERS.map((value) => ({
    value,
    label: value === "all" ? t("admin.subscriptions.filterAll") : stateLabel(value, t)
  }));

  const columns: Column<SubscriptionSummary>[] = [
    { key: "client", header: t("admin.subscriptions.colClient"), render: (s) => s.clientName },
    { key: "group", header: t("admin.subscriptions.colGroup"), render: (s) => s.groupName ?? "—" },
    { key: "month", header: t("admin.subscriptions.colMonth"), render: (s) => `${s.year}-${String(s.month).padStart(2, "0")}` },
    {
      key: "dates",
      header: t("admin.subscriptions.colDates"),
      numeric: true,
      render: (s) => `${s.paidCount}/${s.dateCount}`
    },
    {
      key: "total",
      header: t("admin.subscriptions.colTotal"),
      numeric: true,
      render: (s) => formatRsd(s.totalRsd)
    },
    {
      key: "state",
      header: t("admin.subscriptions.colState"),
      render: (s) => <span className={stateTagClass(s.paymentState)}>{stateLabel(s.paymentState, t)}</span>
    },
    {
      key: "actions",
      header: t("admin.subscriptions.colActions"),
      render: (s) => (
        <Button
          variant={s.paymentState === "paid" ? "ghost" : "primary"}
          onClick={() => setPending(s)}
        >
          {s.paymentState === "paid"
            ? t("admin.subscriptions.markUnpaid")
            : t("admin.subscriptions.markPaid")}
        </Button>
      )
    }
  ];

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>{t("admin.subscriptions.title")}</h1>
          <p>{t("admin.subscriptions.lead")}</p>
        </div>
      </header>

      <div className="stack">
        <div className="cluster">
          <SelectField
            label={t("admin.subscriptions.filterLabel")}
            value={stateFilter}
            onChange={(event) => setStateFilter(event.target.value as StateFilter)}
            options={stateOptions}
          />
        </div>

        {subscriptions.isPending ? (
          <p className="state state--loading">{t("admin.subscriptions.loading")}</p>
        ) : subscriptions.isError ? (
          <p className="state state--error" role="alert">
            {t("admin.subscriptions.loadError", { message: subscriptions.error.message })}
          </p>
        ) : (
          <DataTable
            caption={t("admin.subscriptions.title")}
            columns={columns}
            rows={subscriptions.data}
            rowKey={(s) => s.groupSubscriptionId}
            emptyLabel={t("admin.subscriptions.empty")}
          />
        )}
      </div>

      <Modal
        open={pending !== null}
        onClose={closeConfirm}
        title={t("admin.subscriptions.markConfirmTitle")}
        footer={
          <div className="cluster">
            <Button variant="ghost" onClick={closeConfirm}>
              {t("admin.action.cancel")}
            </Button>
            <Button variant="primary" disabled={markPaid.isPending} onClick={submit}>
              {markPaid.isPending
                ? t("admin.action.saving")
                : targetPaid
                  ? t("admin.subscriptions.markPaid")
                  : t("admin.subscriptions.markUnpaid")}
            </Button>
          </div>
        }
      >
        {pending ? (
          <p>
            {t("admin.subscriptions.markConfirmPrompt", {
              client: pending.clientName,
              group: pending.groupName ?? "—",
              month: `${pending.year}-${String(pending.month).padStart(2, "0")}`,
              total: formatRsd(pending.totalRsd)
            })}
          </p>
        ) : null}
      </Modal>
    </AppShell>
  );
}
