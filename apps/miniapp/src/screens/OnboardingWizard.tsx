import { useCallback, useMemo, useState } from "react";
import {
  Caption,
  Input,
  Placeholder,
  Section,
  Snackbar,
  Spinner,
  Steps
} from "@telegram-apps/telegram-ui";
import { LOCALES, asLocale, localeLabel, type Locale } from "@beosand/i18n";
import { useApiClient } from "../api/ApiProvider";
import { useLevels, useOnboard, useSetLanguage } from "../api/hooks";
import { useLanguage, useT } from "../i18n/LanguageProvider";
import { hapticSelection, hapticSuccess, useBackButton, useMainButton } from "../tg/buttons";
import { FallbackButton } from "../ui/FallbackButton";
import { OptionList, type Option } from "../ui/OptionList";

/** Sentinel for the "not sure yet" level opt-out — distinct from a real level id. */
const NO_LEVEL = "";

interface OnboardingWizardProps {
  /** Called once onboarding succeeds; the router lands on the profile. */
  onDone: () => void;
}

/**
 * Three-step onboarding (name → language → level) on one screen, driven by the
 * native MainButton (primary action) and BackButton (navigation). Identity comes
 * from the verified session (getMe); the wizard never accepts a foreign telegramId
 * — the server resolves and enforces the actor. No domain logic lives here: levels
 * come from the API, the locale list from @beosand/i18n.
 */
export function OnboardingWizard({ onDone }: OnboardingWizardProps): JSX.Element {
  const api = useApiClient();
  const t = useT();
  const { setLocale } = useLanguage();
  const me = api.getMe();

  const [step, setStep] = useState(0);
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

  const isLastStep = step === 2;
  const mainText = isLastStep ? t("miniapp.action.done") : t("miniapp.action.continue");
  const nameValid = trimmedName.length >= 1;

  const onMainClick = useCallback(() => {
    if (step === 0) {
      if (nameValid) {
        setStep(1);
      }
      return;
    }
    if (step === 1) {
      setStep(2);
      return;
    }
    void submit();
  }, [step, nameValid, submit]);

  useMainButton({
    text: mainText,
    onClick: onMainClick,
    isEnabled: step === 0 ? nameValid : true,
    isLoading: submitting
  });
  useBackButton(step > 0, goBack);

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

  return (
    <div className="screen" aria-busy={submitting || undefined}>
      <div className="wizard-progress">
        <Steps count={3} progress={step} />
        <Caption level="1" className="muted">
          {t("miniapp.onboarding.step", { n: step + 1 })}
        </Caption>
      </div>

      {step === 0 && (
        <Section header={t("miniapp.onboarding.nameHeader")}>
          <Input
            value={name}
            placeholder={t("miniapp.onboarding.namePlaceholder")}
            onChange={(e) => setName(e.target.value)}
          />
          <Caption level="1" className="muted screen-hint">
            {t("miniapp.onboarding.nameHint")}
          </Caption>
        </Section>
      )}

      {step === 1 && (
        <OptionList
          name="onboarding-language"
          header={t("miniapp.onboarding.langHeader")}
          options={languageOptions}
          selected={language}
          onSelect={onPickLanguage}
        />
      )}

      {step === 2 &&
        (levels.isLoading ? (
          <Placeholder description={t("miniapp.common.loading")}>
            <Spinner size="m" />
          </Placeholder>
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

      <FallbackButton
        text={mainText}
        onClick={onMainClick}
        disabled={step === 0 ? !nameValid : false}
        loading={submitting}
      />

      {errorMessage && (
        <Snackbar onClose={() => setErrorMessage(null)} duration={5000}>
          {errorMessage}
        </Snackbar>
      )}
    </div>
  );
}
