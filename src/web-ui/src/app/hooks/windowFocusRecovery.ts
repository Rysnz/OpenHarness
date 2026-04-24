export interface WindowFocusSnapshot {
  activeElement: HTMLElement | null;
  wasInputFocused: boolean;
}

export function captureRichInputFocus(): WindowFocusSnapshot {
  const activeElement = document.activeElement as HTMLElement | null;
  const wasInputFocused = Boolean(
    activeElement &&
      (activeElement.classList.contains('rich-text-input') ||
        activeElement.closest('.rich-text-input') !== null ||
        activeElement.isContentEditable)
  );

  return { activeElement, wasInputFocused };
}

export function ensureRichTextInputsEditable(): void {
  const chatInputs = document.querySelectorAll('.rich-text-input[contenteditable]');
  chatInputs.forEach((input) => {
    const element = input as HTMLElement;
    if (element.getAttribute('contenteditable') !== 'true') {
      element.setAttribute('contenteditable', 'true');
    }
  });
}

export function restoreRichInputFocus(snapshot: WindowFocusSnapshot): void {
  ensureRichTextInputsEditable();

  const { activeElement, wasInputFocused } = snapshot;
  if (!wasInputFocused || !activeElement || !activeElement.isConnected) {
    return;
  }

  try {
    const rect = activeElement.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) {
      activeElement.focus();
    }
  } catch {
    // Best-effort focus restoration after native window changes.
  }
}
