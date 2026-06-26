import { create } from 'zustand';
import type { ConfirmDialogType } from './ConfirmDialog';

export interface ConfirmDialogOptions {
  title: string;
  message: React.ReactNode;
  type?: ConfirmDialogType;
  confirmText?: string;
  cancelText?: string;
  confirmDanger?: boolean;
  showCancel?: boolean;
  preview?: string;
  previewMaxHeight?: number;
}

interface ConfirmDialogState {
  isOpen: boolean;
  options: ConfirmDialogOptions | null;
  resolve: ((value: boolean) => void) | null;
  show: (options: ConfirmDialogOptions) => Promise<boolean>;
  confirm: () => void;
  cancel: () => void;
  close: () => void;
}

const CLOSED_DIALOG_STATE = {
  isOpen: false,
  options: null,
  resolve: null,
};

export const useConfirmDialogStore = create<ConfirmDialogState>((set, get) => ({
  isOpen: false,
  options: null,
  resolve: null,

  show: (options: ConfirmDialogOptions) => {
    return new Promise<boolean>((resolve) => {
      set({
        isOpen: true,
        options,
        resolve,
      });
    });
  },

  confirm: () => {
    const { resolve } = get();
    resolve?.(true);
    set(CLOSED_DIALOG_STATE);
  },

  cancel: () => {
    const { resolve } = get();
    resolve?.(false);
    set(CLOSED_DIALOG_STATE);
  },

  close: () => {
    const { resolve } = get();
    resolve?.(false);
    set(CLOSED_DIALOG_STATE);
  },
}));

export function confirmDialog(options: ConfirmDialogOptions): Promise<boolean> {
  return useConfirmDialogStore.getState().show(options);
}

export function confirmWarning(title: string, message: React.ReactNode, options?: Partial<ConfirmDialogOptions>): Promise<boolean> {
  return confirmDialog({ title, message, type: 'warning', ...options });
}

export function confirmDanger(title: string, message: React.ReactNode, options?: Partial<ConfirmDialogOptions>): Promise<boolean> {
  return confirmDialog({
    title,
    message,
    type: 'error',
    confirmDanger: true,
    ...options,
  });
}

export function confirmInfo(title: string, message: React.ReactNode, options?: Partial<ConfirmDialogOptions>): Promise<boolean> {
  return confirmDialog({ title, message, type: 'info', showCancel: false, ...options });
}
