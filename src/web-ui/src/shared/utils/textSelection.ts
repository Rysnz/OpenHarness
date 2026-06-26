import { createLogger } from '@/shared/utils/logger';

const log = createLogger('TextSelection');

export interface TextSelection {
  text: string;
  element: HTMLElement;
  range?: Range;
}

const FLOW_CHAT_SELECTORS = {
  container: '.flow-chat-container',
  dialogTurn: '.flow-chat-dialog-turn',
  modelRound: '.model-round',
  textBlock: '.flow-text-block',
  toolCard: '.flow-tool-card',
  userMessage: '.user-message'
};

const elementFromRange = (range: Range): HTMLElement | null => {
  const ancestor = range.commonAncestorContainer;
  return ancestor.nodeType === Node.ELEMENT_NODE
    ? ancestor as HTMLElement
    : ancestor.parentElement;
};

export const getSelectedText = (): TextSelection | null => {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }

  const range = selection.getRangeAt(0);
  const text = range.toString().trim();
  const element = elementFromRange(range);

  return text && element ? { text, element, range } : null;
};

export const clearSelection = (): void => {
  window.getSelection()?.removeAllRanges();
};

const copyWithTextarea = (text: string): boolean => {
  const textArea = document.createElement('textarea');
  textArea.value = text;
  textArea.style.position = 'fixed';
  textArea.style.left = '-999999px';
  textArea.style.top = '-999999px';

  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();

  const result = document.execCommand('copy');
  document.body.removeChild(textArea);
  return result;
};

export const copyTextToClipboard = async (text: string): Promise<boolean> => {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }

    return copyWithTextarea(text);
  } catch (error) {
    log.error('Failed to copy text to clipboard', error);
    return false;
  }
};

export const getElementText = (element: HTMLElement): string => {
  if (element.tagName === 'PRE' || element.tagName === 'CODE') {
    return element.textContent || '';
  }

  return element.innerText || element.textContent || '';
};

export const isInFlowChat = (element: HTMLElement): boolean =>
  element.closest(FLOW_CHAT_SELECTORS.container) !== null;

export const getFlowChatContext = (element: HTMLElement) => {
  const flowChatContainer = element.closest(FLOW_CHAT_SELECTORS.container);
  if (!flowChatContainer) {
    return null;
  }

  return {
    container: flowChatContainer as HTMLElement,
    dialogTurn: element.closest(FLOW_CHAT_SELECTORS.dialogTurn) as HTMLElement | null,
    modelRound: element.closest(FLOW_CHAT_SELECTORS.modelRound) as HTMLElement | null,
    textBlock: element.closest(FLOW_CHAT_SELECTORS.textBlock) as HTMLElement | null,
    toolCard: element.closest(FLOW_CHAT_SELECTORS.toolCard) as HTMLElement | null,
    userMessage: element.closest(FLOW_CHAT_SELECTORS.userMessage) as HTMLElement | null
  };
};
