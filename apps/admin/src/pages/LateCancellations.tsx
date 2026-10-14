import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type {
  LateCancellationLiability,
  LateCancellationLiabilityPaymentStatus
} from "@beosand/types";
import { AppShell } from "../ui/AppShell";
import { Button } from "../ui/Button";
import { DataTable, type Column } from "../ui/DataTable";
import { NumberField, SelectField } from "../ui/Field";
import { Modal } from "../ui/Modal";
import { useT } from "../i18n/LanguageProvider";
import { formatDateTime, formatRsd } from "../lib/format";
import {
  useLateCancellationLiabilities,
  useLateCancellationPolicy,
  useMarkStandaloneLateCancellationPaid,
  useUpdateLateCancellationPolicy
} from "../hooks/useLateCancellations";
import { useToast } from "../ui/Toast";

type PaymentFilter = LateCancellationLiabilityPaymentStatus | "all";
type BillingFilter = LateCancellationLiability["billingKind"] | "all";

function paymentLabel(value: LateCancellationLiabilityPaymentStatus, t: ReturnType<typeof useT>): string {
  return t(`admin.lateCancellations.payment.${value}`);
}

function paymentTag(value: LateCancellationLiabilityPaymentStatus): string {
  return value === "paid" ? "tag tag--ok" : "tag tag--warn";
}

/**
 * Admin policy editor and immutable late-cancellation ledger. Policy eligibility,
 * amounts, payment state, and subscription accounting are all decided by the API.
 */
export function LateCancellations(): JSX.Element {
  const t = useT();
  const { notify } = useToast();
  const policy = useLateCancellationPolicy();
  const updatePolicy = useUpdateLateCancellationPolicy();
  const markStandalonePaid = useMarkStandaloneLateCancellationPaid();
  const [enabled, setEnabled] = useState(false);
  const [hours, setHours] = useState<number | null>(null);
  const [paymentStatus, setPaymentStatus] = useState<PaymentFilter>("all");
  const [billingKind, setBillingKind] = useState<BillingFilter>("all");
  const [offset, setOffset] = useState(0);
  const [pendingPayment, setPendingPayment] = useState<LateCancellationLiability | null>(null);

  useEffect(() => {
    if (!policy.data) return;
    setEnabled(policy.data.enabled);
    setHours(policy.data.hours);
  }, [policy.data]);

  const liabilities = useLateCancellationLiabilities({
    paymentStatus: paymentStatus === "all" ? undefined : paymentStatus,
    billingKind: billingKind === "all" ? undefined : billingKind,
    offset,
    limit: 30
  });

  function savePolicy(): void {
    updatePolicy.mutate(
      { enabled, hours: enabled ? hours : null },
      {
        onSuccess: () => notify(t("admin.lateCancellations.policy.saved"), "success"),
        onError: (error) =>
          notify(error instanceof Error ? error.message : t("admin.lateCancellations.policy.saveError"), "error")
      }
    );
  }

  function confirmStandalonePayment(): void {
    if (!pendingPayment) return;
    const paid = pendingPayment.paymentStatus !== "paid";
    markStandalonePaid.mutate(
      { id: pendingPayment.id, paid },
      {
        onSuccess: () => {
          notify(t("admin.lateCancellations.payment.saved"), "success");
          setPendingPayment(null);
        },
        onError: (error) =>
          notify(error instanceof Error ? error.message : t("admin.lateCancellations.payment.saveError"), "error")
      }
    );
  }

  const columns: Column<LateCancellationLiability>[] = [
    { key: "client", header: t("admin.lateCancellations.colClient"), render: (row) => row.clientName },
    {
      key: "training",
      header: t("admin.lateCancellations.colTraining"),
      render: (row) => (
        <span>
          {row.trainingLabel}
          <br />
          <small>{`${row.trainingDate} · ${row.trainingStartTime}–${row.trainingEndTime} · ${row.trainerName}`}</small>
        </span>
      )
    },
    {
      key: "cancelledAt",
      header: t("admin.lateCancellations.colCancelledAt"),
      render: (row) => formatDateTime(row.cancelledAt),
      sortValue: (row) => row.cancelledAt
    },
    { key: "amount", header: t("admin.lateCancellations.colAmount"), numeric: true, render: (row) => formatRsd(row.amountRsd) },
    {
      key: "payment",
      header: t("admin.lateCancellations.colPayment"),
      render: (row) => <span className={paymentTag(row.paymentStatus)}>{paymentLabel(row.paymentStatus, t)}</span>
    },
    {
      key: "actions",
      header: t("admin.lateCancellations.colActions"),
      render: (row) =>
        row.billingKind === "subscription" ? (
          <Link className="btn btn--ghost btn--compact" to="/subscriptions">
            {t("admin.lateCancellations.openSubscription")}
          </Link>
        ) : (
          <Button className="btn--compact" variant="ghost" onClick={() => setPendingPayment(row)}>
            {row.paymentStatus === "paid"
              ? t("admin.lateCancellations.markUnpaid")
              : t("admin.lateCancellations.markPaid")}
          </Button>
        )
    }
  ];

  return (
    <AppShell>
      <header className="page-head">
        <div>
          <h1>{t("admin.lateCancellations.title")}</h1>
          <p>{t("admin.lateCancellations.lead")}</p>
        </div>
      </header>

      <section className="workspace late-cancellation-workspace" aria-labelledby="late-cancellation-policy">
        <div className="workspace__bar">
          <div>
            <h2 id="late-cancellation-policy">{t("admin.lateCancellations.policy.title")}</h2>
            <p className="field__hint">{t("admin.lateCancellations.policy.lead")}</p>
          </div>
          <Button onClick={savePolicy} disabled={policy.isLoading || policy.isError || updatePolicy.isPending || (enabled && hours === null)}>
            {updatePolicy.isPending ? t("admin.action.saving") : t("admin.action.save")}
          </Button>
        </div>
        <div className="workspace__body">
          {policy.isLoading ? <p className="state state--loading">{t("admin.lateCancellations.policy.loading")}</p> : null}
          {policy.isError ? <p className="state state--error" role="alert">{t("admin.lateCancellations.policy.loadError", { message: policy.error.message })}</p> : null}
          {!policy.isLoading && !policy.isError ? (
            <div className="filter-toolbar">
              <label className="court-picker__tile">
                <span>{t("admin.lateCancellations.policy.enabled")}</span>
                <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.currentTarget.checked)} />
              </label>
              <NumberField
                label={t("admin.lateCancellations.policy.hours")}
                value={hours}
                min={1}
                max={168}
                disabled={!enabled}
                onValueChange={setHours}
                hint={t("admin.lateCancellations.policy.hoursHint")}
              />
            </div>
          ) : null}
        </div>
      </section>

      <section className="workspace late-cancellation-workspace" aria-labelledby="late-cancellation-ledger">
        <div className="workspace__bar">
          <div>
            <h2 id="late-cancellation-ledger">{t("admin.lateCancellations.ledger.title")}</h2>
            <p className="field__hint">{t("admin.lateCancellations.ledger.lead")}</p>
          </div>
          <Button variant="ghost" onClick={() => void liabilities.refetch()} disabled={liabilities.isFetching}>
            {t("admin.action.refresh")}
          </Button>
        </div>
        <div className="workspace__body">
          <div className="filter-toolbar">
            <SelectField
              label={t("admin.lateCancellations.filter.payment")}
              value={paymentStatus}
              onChange={(event) => {
                setPaymentStatus(event.currentTarget.value as PaymentFilter);
                setOffset(0);
              }}
              options={[
                { value: "all", label: t("admin.lateCancellations.filter.all") },
                { value: "unpaid", label: paymentLabel("unpaid", t) },
                { value: "paid", label: paymentLabel("paid", t) }
              ]}
            />
            <SelectField
              label={t("admin.lateCancellations.filter.billing")}
              value={billingKind}
              onChange={(event) => {
                setBillingKind(event.currentTarget.value as BillingFilter);
                setOffset(0);
              }}
              options={[
                { value: "all", label: t("admin.lateCancellations.filter.all") },
                { value: "single", label: t("admin.lateCancellations.billing.single") },
                { value: "subscription", label: t("admin.lateCancellations.billing.subscription") }
              ]}
            />
          </div>
          {liabilities.isLoading ? <p className="state state--loading">{t("admin.lateCancellations.ledger.loading")}</p> : null}
          {liabilities.isError ? <p className="state state--error" role="alert">{t("admin.lateCancellations.ledger.loadError", { message: liabilities.error.message })}</p> : null}
          {liabilities.data ? (
            <>
              <DataTable
                caption={t("admin.lateCancellations.ledger.caption", { count: liabilities.data.total })}
                columns={columns}
                rows={liabilities.data.items}
                rowKey={(row) => row.id}
                emptyLabel={t("admin.lateCancellations.ledger.empty")}
              />
              {offset > 0 || liabilities.data.hasMore ? (
                <div className="row-actions">
                  {offset > 0 ? (
                    <Button variant="ghost" className="btn--compact" onClick={() => setOffset(Math.max(0, offset - 30))}>
                      {t("admin.lateCancellations.ledger.previous")}
                    </Button>
                  ) : null}
                  {liabilities.data.hasMore && liabilities.data.nextOffset !== null ? (
                    <Button className="btn--compact" onClick={() => setOffset(liabilities.data?.nextOffset ?? offset)}>
                      {t("admin.lateCancellations.ledger.next")}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </section>

      <Modal
        open={pendingPayment !== null}
        onClose={() => setPendingPayment(null)}
        title={t("admin.lateCancellations.payment.confirmTitle")}
        footer={
          <div className="row-actions">
            <Button variant="ghost" onClick={() => setPendingPayment(null)}>{t("admin.action.cancel")}</Button>
            <Button onClick={confirmStandalonePayment} disabled={markStandalonePaid.isPending}>
              {markStandalonePaid.isPending ? t("admin.action.saving") : t("admin.action.confirm")}
            </Button>
          </div>
        }
      >
        {pendingPayment ? (
          <p>{t("admin.lateCancellations.payment.confirm", { client: pendingPayment.clientName, amount: formatRsd(pendingPayment.amountRsd) })}</p>
        ) : null}
      </Modal>
    </AppShell>
  );
}
