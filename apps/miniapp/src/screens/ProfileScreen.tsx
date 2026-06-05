import { useCallback, useMemo, useState } from "react";
import { Cell, List, Modal, Section, Snackbar, Title } from "@telegram-apps/telegram-ui";
import { LOCALES, asLocale, localeLabel, type Locale } from "@beosand/i18n";
import type { Client } from "@beosand/types";
import { useLevels, useSetLanguage } from "../api/hooks";
import { useLanguage, useT } from "../i18n/LanguageProvider";
import { hapticSelection } from "../tg/buttons";
import { OptionList, type Option } from "../ui/OptionList";

interface ProfileScreenProps {
  client: Client;
}

/**
 * The authenticated landing for S1: a read-only profile (name + level) with the
 * one editable control — the interface language. Name and level are read-only by
 * invariant (no edit affordance). All values come from the validated client record
 * and the levels cache; the level name is resolved by id, never recomputed.
 */
export function ProfileScreen({ client }: ProfileScreenProps): JSX.Element {
  const t = useT();
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
      <Title level="1" weight="2">
        {client.name}
      </Title>

      <List>
        <Section header={t("miniapp.profile.title")}>
          <Cell subtitle={client.telegramUsername ? `@${client.telegramUsername}` : undefined}>
            {client.name}
          </Cell>
          <Cell subhead={t("miniapp.profile.level")}>{levelName}</Cell>
        </Section>

        <Section header={t("miniapp.profile.settings")}>
          <Cell
            subtitle={localeLabel[locale]}
            onClick={() => setPickerOpen(true)}
            after={<span className="chevron" aria-hidden="true">›</span>}
          >
            {t("miniapp.profile.language")}
          </Cell>
        </Section>
      </List>

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
