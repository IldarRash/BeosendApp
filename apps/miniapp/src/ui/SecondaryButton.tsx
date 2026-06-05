import { Button } from "@telegram-apps/telegram-ui";

interface SecondaryButtonProps {
  text: string;
  onClick: () => void;
  disabled?: boolean;
}

/**
 * An ALWAYS-visible in-DOM secondary action, for terminal screens that offer a
 * second choice next to the primary one. The primary action is the native Telegram
 * MainButton (mirrored by {@link FallbackButton} only in the dev browser); since
 * Telegram exposes a single native MainButton, a second action would have no
 * affordance in production if it relied on the fallback — so it renders here
 * unconditionally, styled as a muted "plain" button so the coral primary stays the
 * one emphasised action.
 */
export function SecondaryButton({ text, onClick, disabled }: SecondaryButtonProps): JSX.Element {
  return (
    <Button mode="plain" size="m" stretched disabled={disabled} onClick={onClick}>
      {text}
    </Button>
  );
}
