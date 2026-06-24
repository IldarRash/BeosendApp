import { useCallback, useMemo, useState } from "react";
import { LOCALES, asLocale, localeLabel, type Locale } from "@beosand/i18n";
import { useApiClient } from "../api/ApiProvider";
import { useLevels, useOnboard, useSetLanguage } from "../api/hooks";
import { useLanguage, useT } from "../i18n/LanguageProvider";
import { hapticSelection, hapticSuccess, useBackButton, useMainButton } from "../tg/buttons";
import { FallbackButton } from "../ui/FallbackButton";
import { OptionList, type Option } from "../ui/OptionList";

/** Sentinel for the "not sure yet" level opt-out — distinct from a real level id. */
const NO_LEVEL = "";

/**
 * Privacy-policy link target for the consent step. Browser-safe public URL from
 * `VITE_PRIVACY_POLICY_URL`; defaults to a no-op `"#"` when unset so the link
 * never points at a missing page in environments without a configured policy.
 */
const POLICY_URL = import.meta.env.VITE_PRIVACY_POLICY_URL ?? "#";

interface OnboardingWizardProps {
  /** Called once onboarding succeeds; the router lands on the profile. */
  onDone: () => void;
}

/**
 * Four-step onboarding (consent → name → language → level) on one screen, driven
 * by the native MainButton (primary action) and BackButton (navigation). Step 0 is
 * the mandatory personal-data-processing consent: registration is refused until the
 * client ticks it, and the server stamps `consentGivenAt` when we send
 * `consentAccepted: true`. Identity comes from the verified session (getMe); the
 * wizard never accepts a foreign telegramId — the server resolves and enforces the
 * actor. No domain logic lives here: levels come from the API, the locale list from
 * @beosand/i18n.
 *
 * Markup follows the handoff prototype: a `.tg-sech` step overline, `.card`/`.note`
 * for the consent/name blocks, `.optrow` rows (a square checkbox for consent, via
 * OptionList for language/level), and the `.stateview`/`.spinner` calm-state pattern
 * while levels load.
 */
export function OnboardingWizard({ onDone }: OnboardingWizardProps): JSX.Element {
  const api = useApiClient();
  const t = useT();
  const { setLocale } = useLanguage();
  const me = api.getMe();

  const [step, setStep] = useState(0);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [name, setName] = useState(me?.name ?? "");
  const [language, setLanguageSel] = useState<Locale>(asLocale(me?.language));
  const [levelId, setLevelId] = useState<string>(NO_LEVEL);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const levels = useLevels();
  const onboard = useOnboard();
  const setServerLanguage = useSetLanguage();

  const trimmedName = name.trim();
  const submitting = onboard.isPending || setServerLanguage.isPending;

  const goBack = useCallback(() => setStep((s) => Math.max(0, s - 1)), []);

  const submit = useCallback(async () => {
    if (!me) {
      return;
    }
    setErrorMessage(null);
    try {
      await onboard.mutateAsync({
        telegramId: me.telegramId,
        name: trimmedName,
        // Consent is gated in the UI (step 0); the server re-validates and stamps consentGivenAt.
        consentAccepted: true,
        // Opt-out maps to omitting levelId entirely (level is optional), never a fake id.
        ...(levelId !== NO_LEVEL ? { levelId } : {})
      });
      // Persist the chosen locale only when it differs from what the server already has.
      if (language !== asLocale(me.language)) {
        await setServerLanguage.mutateAsync(language);
      }
      hapticSuccess();
      onDone();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : t("miniapp.common.error"));
    }
  }, [me, onboard, trimmedName, levelId, language, setServerLanguage, onDone, t]);

  const isLastStep = step === 3;
  const mainText = isLastStep ? t("miniapp.action.done") : t("miniapp.action.continue");
  const nameValid = trimmedName.length >= 1;

  const onMainClick = useCallback(() => {
    if (step === 0) {
      if (consentAccepted) {
        setStep(1);
      }
      return;
    }
    if (step === 1) {
      if (nameValid) {
        setStep(2);
      }
      return;
    }
    if (step === 2) {
      setStep(3);
      return;
    }
    void submit();
  }, [step, consentAccepted, nameValid, submit]);

  useMainButton({
    text: mainText,
    onClick: onMainClick,
    isEnabled: step === 0 ? consentAccepted : step === 1 ? nameValid : true,
    isLoading: submitting
  });
  useBackButton(step > 0, goBack);

  const toggleConsent = useCallback(() => {
    hapticSelection();
    setConsentAccepted((v) => !v);
  }, []);

  const onPickLanguage = useCallback(
    (next: Locale) => {
      hapticSelection();
      setLanguageSel(next);
      // Flip the whole wizard UI to the chosen language live (session-only until submit).
      setLocale(next);
    },
    [setLocale]
  );

  const onPickLevel = useCallback((next: string) => {
    hapticSelection();
    setLevelId(next);
  }, []);

  const languageOptions = useMemo<ReadonlyArray<Option<Locale>>>(
    () => LOCALES.map((value) => ({ value, label: localeLabel[value] })),
    []
  );

  const levelOptions = useMemo<ReadonlyArray<Option<string>>>(() => {
    const skip: Option<string> = { value: NO_LEVEL, label: t("miniapp.onboarding.levelSkip") };
    const active = (levels.data ?? []).map((lvl) => ({ value: lvl.id, label: lvl.name }));
    return [skip, ...active];
  }, [levels.data, t]);

  const consentLabel = t("miniapp.consent.checkboxLabel");

  return (
    <div className="screen" aria-busy={submitting || undefined}>
      {/* Step overline — uppercase muted (`.tg-sech`); announced on change. */}
      <div className="tg-sech" style={{ padding: 0 }} role="status" aria-live="polite">
        {t("miniapp.onboarding.step", { n: step + 1 })}
      </div>

      {step === 0 && (
        <div>
          <div className="tg-sech" style={{ padding: "0 0 7px" }}>
            {t("miniapp.consent.header")}
          </div>
          <div className="note" style={{ marginTop: 0 }}>
            {t("miniapp.consent.body")}
          </div>
          <div className="card">
            {/* Square-checkbox variant of `.optrow`: a visually hidden real checkbox
                carries the semantics (checked, aria-label, focus); the row toggles it. */}
            <label
              htmlFor="onboarding-consent"
              className={consentAccepted ? "optrow is-on" : "optrow"}
              onClick={toggleConsent}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggleConsent();
                }
              }}
              tabIndex={0}
            >
              <input
                id="onboarding-consent"
                type="checkbox"
                checked={consentAccepted}
                readOnly
                aria-label={consentLabel}
                style={{ position: "absolute", opacity: 0, width: 0, height: 0, pointerEvents: "none" }}
              />
              <span className="optrow__check" aria-hidden="true" />
              <span className="optrow__main">
                <span className="optrow__title">{consentLabel}</span>
              </span>
            </label>
          </div>
          <div className="note" style={{ marginTop: 8 }}>
            <a href={POLICY_URL} target="_blank" rel="noreferrer">
              {t("miniapp.consent.policyLink")}
            </a>
          </div>
        </div>
      )}

      {step === 1 && (
        <div>
          <div className="tg-sech" style={{ padding: "0 0 7px" }}>
            {t("miniapp.onboarding.nameHeader")}
          </div>
          <div className="card">
            <input
              className="tg-input"
              type="text"
              value={name}
              placeholder={t("miniapp.onboarding.namePlaceholder")}
              aria-label={t("miniapp.onboarding.nameHeader")}
              autoComplete="name"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="note">{t("miniapp.onboarding.nameHint")}</div>
        </div>
      )}

      {step === 2 && (
        <OptionList
          name="onboarding-language"
          header={t("miniapp.onboarding.langHeader")}
          options={languageOptions}
          selected={language}
          onSelect={onPickLanguage}
        />
      )}

      {step === 3 &&
        (levels.isLoading ? (
          <div className="stateview" role="status" aria-live="polite">
            <div className="spinner" aria-hidden="true" />
            <div className="stateview__sub">{t("miniapp.common.loading")}</div>
          </div>
        ) : (
          <OptionList
            name="onboarding-level"
            header={t("miniapp.onboarding.levelHeader")}
            footer={t("miniapp.onboarding.levelFooter")}
            options={levelOptions}
            selected={levelId}
            onSelect={onPickLevel}
          />
        ))}

      {errorMessage && (
        <div className="note" role="alert">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <circle cx="12" cy="12" r="8.5" />
            <path d="M12 8v4M12 16h.01" />
          </svg>
          <span>{errorMessage}</span>
        </div>
      )}

      <FallbackButton
        text={mainText}
        onClick={onMainClick}
        disabled={step === 0 ? !consentAccepted : step === 1 ? !nameValid : false}
        loading={submitting}
      />
    </div>
  );
}
