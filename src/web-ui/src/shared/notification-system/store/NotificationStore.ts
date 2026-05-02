import {
  Notification,
  NotificationConfig,
  NotificationRecord,
  NotificationState,
} from '../types';

const HISTORY_LIMIT = 100;

const DEFAULT_CONFIG: NotificationConfig = {
  maxActiveNotifications: 3,
  defaultDuration: 3000,
  enableSound: false,
  enableAnimation: true,
  position: 'bottom-left',
};

type Listener = (state: NotificationState) => void;

function isDeferredHistoryVariant(notification: Notification): boolean {
  return notification.variant === 'progress' || notification.variant === 'loading';
}

function shouldEnterHistoryImmediately(notification: Notification): boolean {
  return !isDeferredHistoryVariant(notification);
}

function isTerminalStatus(status: Notification['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

function toHistoryRecord(notification: Notification): NotificationRecord {
  return {
    ...notification,
    showInCenter: true,
  };
}

function trimHistory(history: NotificationRecord[]): NotificationRecord[] {
  return history.slice(0, HISTORY_LIMIT);
}

class NotificationStore {
  private state: NotificationState = {
    activeNotifications: [],
    notificationHistory: [],
    unreadCount: 0,
    centerOpen: false,
    config: DEFAULT_CONFIG,
  };

  private listeners = new Set<Listener>();

  getState(): NotificationState {
    return { ...this.state };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  addNotification(notification: Notification): void {
    const addToHistory = shouldEnterHistoryImmediately(notification);
    const notificationHistory = addToHistory
      ? this.addHistoryRecord(this.state.notificationHistory, notification)
      : this.state.notificationHistory;
    const unreadCount = this.state.unreadCount + (addToHistory ? 1 : 0);

    if (notification.variant === 'silent') {
      this.setState({
        notificationHistory,
        unreadCount,
      });
      return;
    }

    this.setState({
      activeNotifications: this.nextActiveNotifications(notification),
      notificationHistory,
      unreadCount,
    });
  }

  updateNotification(id: string, updates: Partial<Notification>): void {
    const activeNotifications = this.state.activeNotifications.map((notification) =>
      notification.id === id ? { ...notification, ...updates } : notification
    );
    const updatedNotification = activeNotifications.find((notification) => notification.id === id);

    this.setState({
      activeNotifications,
      notificationHistory: this.nextHistoryAfterUpdate(id, updates, updatedNotification),
      unreadCount: this.state.unreadCount,
    });
  }

  removeNotification(id: string): void {
    const notificationToRemove = this.state.activeNotifications.find((notification) => notification.id === id);

    this.setState({
      activeNotifications: this.state.activeNotifications.filter((notification) => notification.id !== id),
      notificationHistory: this.nextHistoryAfterDismiss(id, notificationToRemove),
    });
  }

  clearActiveNotifications(): void {
    this.setState({
      activeNotifications: [],
    });
  }

  markAsRead(id: string): void {
    const notificationHistory = this.state.notificationHistory.map((notification) =>
      notification.id === id && !notification.read ? { ...notification, read: true } : notification
    );

    this.setState({
      notificationHistory,
      unreadCount: this.countUnread(notificationHistory),
    });
  }

  markAllAsRead(): void {
    this.setState({
      notificationHistory: this.state.notificationHistory.map((notification) => ({
        ...notification,
        read: true,
      })),
      unreadCount: 0,
    });
  }

  removeFromHistory(id: string): void {
    const notificationHistory = this.state.notificationHistory.filter((notification) => notification.id !== id);

    this.setState({
      notificationHistory,
      unreadCount: this.countUnread(notificationHistory),
    });
  }

  clearHistory(): void {
    this.setState({
      notificationHistory: [],
      unreadCount: 0,
    });
  }

  toggleCenter(open?: boolean): void {
    this.setState({
      centerOpen: open ?? !this.state.centerOpen,
    });
  }

  updateConfig(config: Partial<NotificationConfig>): void {
    this.setState({
      config: {
        ...this.state.config,
        ...config,
      },
    });
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener(this.state));
  }

  private setState(updates: Partial<NotificationState>): void {
    this.state = {
      ...this.state,
      ...updates,
    };
    this.notify();
  }

  private nextActiveNotifications(notification: Notification): Notification[] {
    const activeNotifications = [...this.state.activeNotifications];

    if (activeNotifications.length >= this.state.config.maxActiveNotifications) {
      activeNotifications.shift();
    }

    activeNotifications.push(notification);
    return activeNotifications;
  }

  private addHistoryRecord(history: NotificationRecord[], notification: Notification): NotificationRecord[] {
    return trimHistory([toHistoryRecord(notification), ...history]);
  }

  private nextHistoryAfterUpdate(
    id: string,
    updates: Partial<Notification>,
    updatedNotification?: Notification
  ): NotificationRecord[] {
    if (!updatedNotification) {
      return this.updateExistingHistory(id, updates);
    }

    if (!isDeferredHistoryVariant(updatedNotification)) {
      return this.updateExistingHistory(id, updates);
    }

    if (!isTerminalStatus(updates.status)) {
      return this.state.notificationHistory;
    }

    const existingIndex = this.state.notificationHistory.findIndex((notification) => notification.id === id);
    if (existingIndex === -1) {
      return this.addHistoryRecord(this.state.notificationHistory, updatedNotification);
    }

    return this.updateExistingHistory(id, updates);
  }

  private nextHistoryAfterDismiss(id: string, notificationToRemove?: Notification): NotificationRecord[] {
    if (notificationToRemove && isDeferredHistoryVariant(notificationToRemove)) {
      const hasHistoryRecord = this.state.notificationHistory.some((notification) => notification.id === id);
      return hasHistoryRecord ? this.markHistoryDismissed(id) : this.state.notificationHistory;
    }

    return this.markHistoryDismissed(id);
  }

  private updateExistingHistory(id: string, updates: Partial<Notification>): NotificationRecord[] {
    return this.state.notificationHistory.map((notification) =>
      notification.id === id ? { ...notification, ...updates } : notification
    );
  }

  private markHistoryDismissed(id: string): NotificationRecord[] {
    const dismissedAt = Date.now();

    return this.state.notificationHistory.map((notification) =>
      notification.id === id
        ? {
            ...notification,
            status: 'dismissed' as const,
            dismissedAt,
          }
        : notification
    );
  }

  private countUnread(history: NotificationRecord[]): number {
    return history.filter((notification) => !notification.read).length;
  }
}

export const notificationStore = new NotificationStore();
