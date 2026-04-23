import { Suspense, lazy } from 'react';

const LazyContextMenuRenderer = lazy(async () => {
  const module = await import('../../shared/context-menu-system/components/ContextMenuRenderer');
  return { default: module.ContextMenuRenderer };
});

const LazyNotificationCenter = lazy(async () => {
  const module = await import('../../shared/notification-system/components/NotificationCenter');
  return { default: module.NotificationCenter };
});

const LazyAnnouncementProvider = lazy(
  () => import('../../shared/announcement-system/components/AnnouncementProvider')
);

const LazyConfirmDialogRenderer = lazy(async () => {
  const module = await import('../../component-library/components/ConfirmDialog/ConfirmDialogRenderer');
  return { default: module.ConfirmDialogRenderer };
});

interface WorkbenchDeferredOverlaysProps {
  enabled: boolean;
}

export function WorkbenchDeferredOverlays({ enabled }: WorkbenchDeferredOverlaysProps) {
  if (!enabled) {
    return null;
  }

  return (
    <>
      <Suspense fallback={null}>
        <LazyContextMenuRenderer />
      </Suspense>

      <Suspense fallback={null}>
        <LazyNotificationCenter />
      </Suspense>

      <Suspense fallback={null}>
        <LazyConfirmDialogRenderer />
      </Suspense>

      <Suspense fallback={null}>
        <LazyAnnouncementProvider />
      </Suspense>
    </>
  );
}
