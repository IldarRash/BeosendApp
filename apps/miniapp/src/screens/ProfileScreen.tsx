import { useCallback, useMemo, useState } from "react";
import { Modal, Snackbar } from "@telegram-apps/telegram-ui";
import { LOCALES, asLocale, localeLabel, type Locale } from "@beosand/i18n";
import type { Client } from "@beosand/types";
import { useLevels, useSetLanguage } from "../api/hooks";
import { useLanguage, useT } from "../i18n/LanguageProvider";
import { hapticSelection } from "../tg/buttons";
import { useTg } from "../tg/TgSdkProvider";
import { OptionList, type Option } from "../ui/OptionList";
import { TgAvatar } from "../ui/TgAvatar";

interface ProfileScreenProps {
  client: Client;
}

/** Right-pointing chevron used on the tappable language row (`.lrow__chev`). */
function Chevron(): JSX.Element {
  return (
    <span className="lrow__chev" aria-hidden="true">
      <svg viewBox="0 0 8 14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" focusable="false">
        <path d="M1 1l6 6-6 6" />
      </svg>
    </span>
  );
}

/**
 * The authenticated landing for S1: a read-only profile (name + level) with the
 * one editable control — the interface language. Name and level are read-only by
 * invariant (no edit affordance). All values come from the validated client record
 * and the levels cache; the level name is resolved by id, never recomputed.
 *
 * Rendered with the handoff prototype structure: `.tg-sech` section headers over
 * `.card` groups of `.lrow` rows. Only the language row is interactive (opens the
 * native picker); the identity rows are static facts.
 */
export function ProfileScreen({ client }: ProfileScreenProps): JSX.Element {
  const t = useT();
  const { user } = useTg();
  const { locale, setLocale } = useLanguage();
  const levels = useLevels();
  const setServerLanguage = useSetLanguage();

  const [pickerOpen, setPickerOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const levelName = useMemo(() => {
    if (client.levelId == null) {
      return t("miniapp.profile.levelNone");
    }
    return levels.data?.find((lvl) => lvl.id === client.levelId)?.name ?? t("miniapp.profile.levelNone");
  }, [client.levelId, levels.data, t]);

  const languageOptions = useMemo<ReadonlyArray<Option<Locale>>>(
    () => LOCALES.map((value) => ({ value, label: localeLabel[value] })),
    []
  );

  const onPickLanguage = useCallback(
    (next: Locale) => {
      if (next === locale) {
        setPickerOpen(false);
        return;
      }
      hapticSelection();
      const previous = locale;
      // Optimistic flip for an instant UI change; roll back if the PATCH fails.
      setLocale(next);
      setPickerOpen(false);
      setServerLanguage.mutate(next, {
        onError: (err) => {
          setLocale(previous);
          setErrorMessage(err instanceof Error ? err.message : t("miniapp.common.error"));
        }
      });
    },
    [locale, setLocale, setServerLanguage, t]
  );

  return (
    <div className="screen screen--no-mainbutton">
      {/* The current user's own Telegram avatar, shown large above the controls. */}
      <div className="profile-avatar">
        <TgAvatar user={user} size="large" />
      </div>

      {/* Identity — read-only facts, no edit affordance */}
      <section aria-label={t("miniapp.profile.title")}>
        <div className="tg-sech">{t("miniapp.profile.title")}</div>
        <div className="card">
          <div className="lrow" style={{ cursor: "default" }}>
            <div className="lrow__main">
              <div className="lrow__title">{client.name}</div>
              {client.telegramUsername && (
                <div className="lrow__sub">@{client.telegramUsername}</div>
              )}
            </div>
          </div>
          <div className="lrow" style={{ cursor: "default" }}>
            <div className="lrow__main">
              <div className="lrow__sub">{t("miniapp.profile.level")}</div>
              <div className="lrow__title">{levelName}</div>
            </div>
          </div>
          {client.bonusTrainingCredits > 0 && (
            <div className="lrow" style={{ cursor: "default" }}>
              <div className="lrow__main">
                <div className="lrow__sub">{t("miniapp.profile.bonusCredits")}</div>
                <div className="lrow__title">
                  {t("miniapp.profile.bonusCreditsValue", { count: client.bonusTrainingCredits })}
                </div>
              </div>
            </div>
          )}
        </div>
      </section>

      {/* Settings — the one editable control: interface language */}
      <section aria-label={t("miniapp.profile.settings")}>
        <div className="tg-sech">{t("miniapp.profile.settings")}</div>
        <div className="card">
          <button
            type="button"
            className="lrow"
            onClick={() => setPickerOpen(true)}
            style={{ width: "100%", border: "none", font: "inherit", textAlign: "left", background: "var(--tg-bg)" }}
          >
            <div className="lrow__main">
              <div className="lrow__title">{t("miniapp.profile.language")}</div>
              <div className="lrow__sub">{localeLabel[locale]}</div>
            </div>
            <Chevron />
          </button>
        </div>
      </section>

      <Modal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        header={<Modal.Header>{t("miniapp.onboarding.langHeader")}</Modal.Header>}
      >
        <OptionList
          name="profile-language"
          options={languageOptions}
          selected={asLocale(locale)}
          onSelect={onPickLanguage}
        />
      </Modal>

      {errorMessage && (
        <Snackbar onClose={() => setErrorMessage(null)} duration={5000}>
          {errorMessage}
        </Snackbar>
      )}
    </div>
  );
}
