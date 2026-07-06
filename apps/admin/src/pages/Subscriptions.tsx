import { useEffect, useState } from "react";
import type {
  ListSubscriptionsQuery,
  ReplaceTrainingPricingTierRow,
  SubscriptionPaymentState,
  SubscriptionPricingBreakdownRow,
  SubscriptionSummary,
  TrainingPricingTier
} from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { NumberField, SelectField, TextField } from "../ui/Field";
import { Modal } from "../ui/Modal";
import { useToast } from "../ui/Toast";
import { useT } from "../i18n/LanguageProvider";
import { formatRsd } from "../lib/format";
import {
  useMarkSubscriptionPaid,
  useReplaceTrainingPricingTiers,
  useSubscriptions,
  useTrainingPricingTiers
} from "../hooks/useSubscriptions";

type Translate = (key: string, params?: Record<string, string | number>) => string;

type StateFilter = SubscriptionPaymentState | "all";

interface EditableTierRow {
  key: string;
  label: string;
  minTrainings: number | null;
  maxTrainings: number | null;
  pricePerTrainingRsd: number | null;
  sortOrder: number;
}

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

function monthLabel(summary: SubscriptionSummary): string {
  return `${summary.year}-${String(summary.month).padStart(2, "0")}`;
}

function tierRange(min: number | null, max: number | null): string {
  if (min === null) return "—";
  return max === null ? `${min}+` : `${min}-${max}`;
}

function tierRowFromApi(tier: TrainingPricingTier): EditableTierRow {
  return {
    key: tier.id,
    label: tier.label,
    minTrainings: tier.minTrainings,
    maxTrainings: tier.maxTrainings,
    pricePerTrainingRsd: tier.pricePerTrainingRsd,
    sortOrder: tier.sortOrder
  };
}

function emptyTierRow(index: number): EditableTierRow {
  return {
    key: `new-${Date.now()}-${index}`,
    label: "",
    minTrainings: null,
    maxTrainings: null,
    pricePerTrainingRsd: null,
    sortOrder: index
  };
}

function obviousTierError(rows: readonly EditableTierRow[], t: Translate): string | null {
  for (const row of rows) {
    if (row.label.trim() === "") return t("admin.subscriptions.tiersErrorLabel");
    if (row.minTrainings === null || !Number.isInteger(row.minTrainings) || row.minTrainings < 1) {
      return t("admin.subscriptions.tiersErrorMin");
    }
    if (row.maxTrainings !== null && (!Number.isInteger(row.maxTrainings) || row.maxTrainings < 1)) {
      return t("admin.subscriptions.tiersErrorMax");
    }
    if (row.maxTrainings !== null && row.minTrainings !== null && row.maxTrainings < row.minTrainings) {
      return t("admin.subscriptions.tiersErrorRange");
    }
    if (
      row.pricePerTrainingRsd === null ||
      !Number.isInteger(row.pricePerTrainingRsd) ||
      row.pricePerTrainingRsd < 1
    ) {
      return t("admin.subscriptions.tiersErrorPrice");
    }
  }
  return null;
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
  const [pricingDetail, setPricingDetail] = useState<SubscriptionSummary | null>(null);

  const filters: ListSubscriptionsQuery =
    stateFilter !== "all" ? { paymentState: stateFilter } : {};
  const subscriptions = useSubscriptions(filters);
  const markPaid = useMarkSubscriptionPaid();
  const pricingTiers = useTrainingPricingTiers();
  const replacePricingTiers = useReplaceTrainingPricingTiers();

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
    { key: "month", header: t("admin.subscriptions.colMonth"), render: (s) => monthLabel(s) },
    {
      key: "dates",
      header: t("admin.subscriptions.colDates"),
      numeric: true,
      render: (s) => (
        <span className="cluster" style={{ justifyContent: "flex-end", gap: 8 }}>
          {`${s.paidCount}/${s.dateCount}`}
          {s.waitlistedCount > 0 ? (
            <span className="tag tag--info">
              {t("admin.subscriptions.waitlisted", { count: s.waitlistedCount })}
            </span>
          ) : null}
        </span>
      )
    },
    {
      key: "pricing",
      header: t("admin.subscriptions.colPricing"),
      render: (s) => (
        <div className="subscription-pricing">
          <span>
            {t("admin.subscriptions.pricingCount", {
              count: s.monthlyPricingCountContext.pricingCountedBookingCount,
              excluded: s.monthlyPricingCountContext.excludedBookingCount
            })}
          </span>
          <span>{s.storedBookingPricesRsd.map(formatRsd).join(", ") || "—"}</span>
          <Button variant="ghost" className="btn--compact" onClick={() => setPricingDetail(s)}>
            {t("admin.subscriptions.breakdownAction")}
          </Button>
        </div>
      )
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

        <PricingTierEditor
          tiers={pricingTiers.data}
          loading={pricingTiers.isPending}
          error={pricingTiers.isError ? pricingTiers.error : null}
          save={replacePricingTiers}
          t={t}
        />

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

      <Modal
        open={pricingDetail !== null}
        onClose={() => setPricingDetail(null)}
        title={t("admin.subscriptions.breakdownTitle")}
      >
        {pricingDetail ? <PricingBreakdown summary={pricingDetail} t={t} /> : null}
      </Modal>
    </AppShell>
  );
}

function PricingTierEditor({
  tiers,
  loading,
  error,
  save,
  t
}: {
  tiers: TrainingPricingTier[] | undefined;
  loading: boolean;
  error: Error | null;
  save: ReturnType<typeof useReplaceTrainingPricingTiers>;
  t: Translate;
}): JSX.Element {
  const { notify } = useToast();
  const [rows, setRows] = useState<EditableTierRow[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (tiers) {
      setRows(tiers.map(tierRowFromApi));
      setFormError(null);
    }
  }, [tiers]);

  function updateRow(index: number, patch: Partial<EditableTierRow>): void {
    setRows((current) =>
      current.map((row, rowIndex) => (rowIndex === index ? { ...row, ...patch } : row))
    );
  }

  function submit(): void {
    const obviousError = obviousTierError(rows, t);
    if (obviousError) {
      setFormError(obviousError);
      return;
    }
    const payload: ReplaceTrainingPricingTierRow[] = rows.map((row, index) => ({
      label: row.label.trim(),
      minTrainings: row.minTrainings as number,
      maxTrainings: row.maxTrainings,
      pricePerTrainingRsd: row.pricePerTrainingRsd as number,
      sortOrder: index
    }));
    setFormError(null);
    save.mutate(
      { tiers: payload },
      {
        onSuccess: () => notify(t("admin.subscriptions.tiersSaved"), "success"),
        onError: (mutationError) =>
          setFormError(
            mutationError instanceof Error ? mutationError.message : t("admin.subscriptions.tiersSaveError")
          )
      }
    );
  }

  return (
    <section className="pricing-editor" aria-labelledby="pricing-editor-title">
      <div className="cluster cluster--spread">
        <div>
          <h2 id="pricing-editor-title">{t("admin.subscriptions.tiersTitle")}</h2>
          <p>{t("admin.subscriptions.tiersLead")}</p>
        </div>
        <Button
          variant="ghost"
          onClick={() => setRows((current) => [...current, emptyTierRow(current.length)])}
          disabled={loading || save.isPending}
        >
          {t("admin.subscriptions.tiersAdd")}
        </Button>
      </div>

      {loading ? <p className="state">{t("admin.subscriptions.tiersLoading")}</p> : null}
      {error ? (
        <p className="state state--error" role="alert">
          {t("admin.subscriptions.tiersLoadError", { message: error.message })}
        </p>
      ) : null}
      {formError ? (
        <p className="state state--error" role="alert">
          {formError}
        </p>
      ) : null}

      <div className="pricing-editor__rows">
        {rows.map((row, index) => (
          <div className="pricing-editor__row" key={row.key}>
            <TextField
              label={t("admin.subscriptions.tiersLabel")}
              value={row.label}
              onChange={(event) => updateRow(index, { label: event.target.value })}
            />
            <NumberField
              label={t("admin.subscriptions.tiersMin")}
              value={row.minTrainings}
              min={1}
              onValueChange={(value) => updateRow(index, { minTrainings: value })}
            />
            <NumberField
              label={t("admin.subscriptions.tiersMax")}
              value={row.maxTrainings}
              min={1}
              placeholder={t("admin.subscriptions.tiersMaxOpen")}
              onValueChange={(value) => updateRow(index, { maxTrainings: value })}
            />
            <NumberField
              label={t("admin.subscriptions.tiersPrice")}
              value={row.pricePerTrainingRsd}
              min={1}
              onValueChange={(value) => updateRow(index, { pricePerTrainingRsd: value })}
            />
            <Button
              variant="ghost"
              className="pricing-editor__remove"
              onClick={() => setRows((current) => current.filter((_, rowIndex) => rowIndex !== index))}
              disabled={rows.length <= 1 || save.isPending}
            >
              {t("admin.action.delete")}
            </Button>
          </div>
        ))}
      </div>

      <div className="cluster">
        <Button variant="primary" onClick={submit} disabled={loading || save.isPending || rows.length === 0}>
          {save.isPending ? t("admin.action.saving") : t("admin.action.save")}
        </Button>
      </div>
    </section>
  );
}

function PricingBreakdown({
  summary,
  t
}: {
  summary: SubscriptionSummary;
  t: Translate;
}): JSX.Element {
  return (
    <div className="stack">
      <dl className="detail-list">
        <div className="detail-list__row">
          <dt>{t("admin.subscriptions.breakdownTotal")}</dt>
          <dd>{formatRsd(summary.totalRsd)}</dd>
        </div>
        <div className="detail-list__row">
          <dt>{t("admin.subscriptions.breakdownScope")}</dt>
          <dd>{t(`admin.subscriptions.pricingScope.${summary.pricingScope}`)}</dd>
        </div>
        <div className="detail-list__row">
          <dt>{t("admin.subscriptions.breakdownCount")}</dt>
          <dd>
            {t("admin.subscriptions.pricingCount", {
              count: summary.monthlyPricingCountContext.pricingCountedBookingCount,
              excluded: summary.monthlyPricingCountContext.excludedBookingCount
            })}
          </dd>
        </div>
        <div className="detail-list__row">
          <dt>{t("admin.subscriptions.breakdownPaymentNote")}</dt>
          <dd>{t("admin.subscriptions.paymentPricingNote")}</dd>
        </div>
      </dl>

      <DataTable
        caption={t("admin.subscriptions.breakdownCaption", {
          client: summary.clientName,
          month: monthLabel(summary)
        })}
        columns={breakdownColumns(t)}
        rows={summary.pricingBreakdown}
        rowKey={(row) => row.bookingId}
        emptyLabel={t("admin.subscriptions.breakdownEmpty")}
      />
    </div>
  );
}

function breakdownColumns(t: Translate): Column<SubscriptionPricingBreakdownRow>[] {
  return [
    { key: "date", header: t("admin.subscriptions.breakdownColDate"), render: (row) => row.date },
    {
      key: "ordinal",
      header: t("admin.subscriptions.breakdownColOrdinal"),
      numeric: true,
      render: (row) => row.bookingOrdinalInMonth ?? "—"
    },
    {
      key: "tier",
      header: t("admin.subscriptions.breakdownColTier"),
      render: (row) =>
        row.pricingTierLabel
          ? `${row.pricingTierLabel} (${tierRange(row.pricingTierMinTrainings, row.pricingTierMaxTrainings)})`
          : "—"
    },
    {
      key: "price",
      header: t("admin.subscriptions.breakdownColPrice"),
      numeric: true,
      render: (row) => (row.priceSnapshotRsd === null ? "—" : formatRsd(row.priceSnapshotRsd))
    },
    { key: "status", header: t("admin.subscriptions.breakdownColStatus"), render: (row) => row.status }
  ];
}
