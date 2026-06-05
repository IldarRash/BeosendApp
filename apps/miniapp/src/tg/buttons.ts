import { useEffect } from "react";
import { backButton, hapticFeedback, mainButton } from "@telegram-apps/sdk-react";

/**
 * Native Telegram button + haptic wiring, isolated so screens declare intent
 * ("this screen's primary action is X") without touching SDK lifecycle. Every
 * call is gated on the scope being mounted/available, so the app degrades to a
 * no-op outside Telegram (dev browser) instead of crashing. Handlers are detached
 * on cleanup to avoid stale closures firing after a screen unmounts.
 */

interface MainButtonConfig {
  text: string;
  onClick: () => void;
  /** Disable the button (e.g. an empty required field). Defaults to enabled. */
  isEnabled?: boolean;
  /** Show the in-button spinner while a submit is in flight. */
  isLoading?: boolean;
}

/**
 * Drive the native MainButton for the lifetime of a screen: show it on mount,
 * reflect label/enabled/loading as they change, run `onClick` on tap, and hide it
 * on unmount so the next screen starts clean. Visibility is toggled ONLY on
 * mount/unmount — params and the click handler update in place — so changing the
 * label or loading state mid-screen (e.g. wizard step transitions, submit) never
 * flickers the button by hiding and re-showing it.
 */
export function useMainButton({ text, onClick, isEnabled = true, isLoading = false }: MainButtonConfig): void {
  // Mount + show once; hide on unmount. Not re-run on param changes.
  useEffect(() => {
    if (!mainButton.mount.isAvailable()) {
      return;
    }
    if (!mainButton.isMounted()) {
      mainButton.mount();
    }
    mainButton.setParams({ isVisible: true });
    return () => {
      if (mainButton.isMounted()) {
        mainButton.setParams({ isVisible: false });
      }
    };
  }, []);

  // Reflect label/enabled/loading without touching visibility.
  useEffect(() => {
    if (!mainButton.isMounted()) {
      return;
    }
    mainButton.setParams({ text, isEnabled, isLoaderVisible: isLoading });
  }, [text, isEnabled, isLoading]);

  // Re-bind the tap handler when it changes (stale-closure safe).
  useEffect(() => {
    if (!mainButton.isMounted()) {
      return;
    }
    const off = mainButton.onClick(onClick);
    return () => off();
  }, [onClick]);
}

/**
 * Wire the native BackButton: show it and run `onBack` on tap while `visible` is
 * true; hide it otherwise. Hidden + detached on unmount.
 */
export function useBackButton(visible: boolean, onBack: () => void): void {
  useEffect(() => {
    if (!backButton.mount.isAvailable()) {
      return;
    }
    if (!backButton.isMounted()) {
      backButton.mount();
    }
    if (!visible) {
      backButton.hide();
      return;
    }
    backButton.show();
    const off = backButton.onClick(onBack);
    return () => {
      off();
      if (backButton.isMounted()) {
        backButton.hide();
      }
    };
  }, [visible, onBack]);
}

/** A selection tick (picking a row / switching language). No-op if unsupported. */
export function hapticSelection(): void {
  if (hapticFeedback.selectionChanged.isAvailable()) {
    hapticFeedback.selectionChanged();
  }
}

/** A success notification (onboarding finished). No-op if unsupported. */
export function hapticSuccess(): void {
  if (hapticFeedback.notificationOccurred.isAvailable()) {
    hapticFeedback.notificationOccurred("success");
  }
}

/**
 * A warning notification fired when a destructive confirm step opens (e.g. the
 * "Отменить запись?" cancel sheet), so the device gives tactile "this is a
 * consequential action" feedback distinct from the success/selection ticks.
 * No-op if unsupported (dev browser).
 */
export function hapticWarning(): void {
  if (hapticFeedback.notificationOccurred.isAvailable()) {
    hapticFeedback.notificationOccurred("warning");
  }
}
