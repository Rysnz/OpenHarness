import type { ReactNode } from 'react';

export type NotificationType = 'success' | 'error' | 'warning' | 'info';
export type NotificationVariant = 'toast' | 'progress' | 'persistent' | 'silent' | 'loading';
export type ProgressMode = 'percentage' | 'fraction' | 'text-only';
export type NotificationStatus = 'active' | 'dismissed' | 'completed' | 'failed' | 'cancelled';
export type ActionVariant = 'primary' | 'secondary' | 'danger';
export type NotificationFilter = 'all' | NotificationType;

export type NotificationMetadata = Record<string, any>;
export type NotificationPosition = 'top-right' | 'bottom-right' | 'top-left' | 'bottom-left';

export interface NotificationAction {
  label: string;
  onClick: () => void;
  variant?: ActionVariant;
}

export interface NotificationMessagePayload {
  title: string;
  message: string;
  metadata?: NotificationMetadata;
}

export interface NotificationActionPayload {
  actions?: NotificationAction[];
  closable?: boolean;
}

export interface CancellableNotificationPayload extends NotificationMessagePayload {
  cancellable?: boolean;
  onCancel?: () => void;
}

export interface ProgressPayload {
  progress?: number;
  progressText?: string;
  progressMode?: ProgressMode;
  current?: number;
  total?: number;
  textOnly?: boolean;
}

export interface Notification extends NotificationMessagePayload, ProgressPayload {
  id: string;
  type: NotificationType;
  variant: NotificationVariant;
  timestamp: number;
  messageNode?: ReactNode;
  cancellable?: boolean;
  onCancel?: () => void;
  actions?: NotificationAction[];
  duration?: number;
  closable?: boolean;
  read?: boolean;
  status?: NotificationStatus;
}

export interface NotificationRecord extends Notification {
  dismissedAt?: number;
  showInCenter?: boolean;
}

export interface ToastOptions extends NotificationActionPayload {
  title?: string;
  duration?: number;
  messageNode?: ReactNode;
  metadata?: NotificationMetadata;
}

export interface ProgressOptions extends CancellableNotificationPayload {
  initialProgress?: number;
  progressMode?: ProgressMode;
  initialCurrent?: number;
  total?: number;
  textOnly?: boolean;
}

export interface PersistentOptions extends NotificationMessagePayload, NotificationActionPayload {
  type: NotificationType;
}

export interface SilentOptions extends NotificationMessagePayload {
  type?: NotificationType;
}

export interface LoadingOptions extends CancellableNotificationPayload {}

export interface ProgressController {
  id: string;
  update(progress: number, text?: string): void;
  updateFraction(current: number, total?: number, text?: string): void;
  complete(message?: string): void;
  fail(message?: string): void;
  cancel(): void;
}

export interface LoadingController {
  id: string;
  updateMessage(message: string): void;
  complete(message?: string): void;
  fail(message?: string): void;
  cancel(): void;
}

export interface NotificationConfig {
  maxActiveNotifications: number;
  defaultDuration: number;
  enableSound: boolean;
  enableAnimation: boolean;
  position: NotificationPosition;
}

export interface NotificationState {
  activeNotifications: Notification[];
  notificationHistory: NotificationRecord[];
  unreadCount: number;
  centerOpen: boolean;
  config: NotificationConfig;
}
