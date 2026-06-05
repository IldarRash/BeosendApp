import { Button } from "@telegram-apps/telegram-ui";
import { mainButton } from "@telegram-apps/sdk-react";

interface FallbackButtonProps {
  text: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}

/**
 * In-DOM primary button shown ONLY when the native Telegram MainButton is
 * unavailable (a plain browser tab in dev). Inside Telegram the native MainButton
 * is the single primary action and this renders nothing, so there is never a
 * duplicate submit affordance.
 */
export function FallbackButton({ text, onClick, disabled, loading }: FallbackButtonProps): JSX.Element | null {
  if (mainButton.mount.isAvailable()) {
    return null;
  }
  return (
    <Button size="l" stretched disabled={disabled} loading={loading} onClick={onClick}>
      {text}
    </Button>
  );
}
