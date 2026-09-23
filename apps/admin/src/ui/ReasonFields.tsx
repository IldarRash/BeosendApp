import { useState } from "react";
import { decisionReasonSchema, type DecisionReason, type DecisionReasonCode } from "@beosand/types";
import { SelectField, TextAreaField } from "./Field";
import { useT } from "../i18n/LanguageProvider";

const codes: readonly DecisionReasonCode[] = [
  "unavailable",
  "schedule-change",
  "staff-unavailable",
  "other"
];

/** Shared UI boundary: only the package contract decides whether a reason can submit. */
export function validateDecisionReason(code: DecisionReasonCode | "", comment: string): DecisionReason | null {
  const parsed = decisionReasonSchema.safeParse({ code, comment });
  return parsed.success ? parsed.data : null;
}

/** Collects the required staff decision reason without duplicating the shared contract. */
export function useDecisionReason(): {
  fields: JSX.Element;
  value: DecisionReason | null;
  validate: () => DecisionReason | null;
} {
  const t = useT();
  const [code, setCode] = useState<DecisionReasonCode | "">("");
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | undefined>();
  const value = validateDecisionReason(code, comment);

  function validate(): DecisionReason | null {
    const parsed = validateDecisionReason(code, comment);
    if (parsed !== null) {
      setError(undefined);
      return parsed;
    }
    setError(t("admin.reason.validation"));
    return null;
  }

  return {
    value,
    validate,
    fields: <div className="form">
      <SelectField
        label={t("admin.reason.label")}
        options={[
          { value: "", label: t("admin.reason.pick") },
          ...codes.map((item) => ({ value: item, label: t(`admin.reason.${item}`) }))
        ]}
        value={code}
        onChange={(event) => { setCode(event.target.value as DecisionReasonCode | ""); setError(undefined); }}
        error={error}
      />
      <TextAreaField
        label={t("admin.reason.comment")}
        value={comment}
        maxLength={500}
        onChange={(event) => { setComment(event.target.value); setError(undefined); }}
        required={code === "other"}
        hint={code === "other" ? t("admin.reason.otherHint") : t("admin.reason.commentHint")}
      />
    </div>
  };
}
