import AppLayout from '../../app/layout/AppLayout';
import { NotificationContainer } from '../../shared/notification-system/components/NotificationContainer';
import { useShortcut } from '../../infrastructure/hooks/useShortcut';
import { useGlobalSceneShortcuts } from '../../app/hooks/useGlobalSceneShortcuts';
import { WorkbenchProviders } from '../providers/WorkbenchProviders';
import {
  WorkbenchStartupLifecycleState,
  useWorkbenchStartupLifecycle,
} from '../startup/useWorkbenchStartupLifecycle';
import { WorkbenchDeferredOverlays } from './WorkbenchDeferredOverlays';
import { WorkbenchSplash } from '../startup/WorkbenchSplash';

function WorkbenchShellContent({
  nonCriticalUiReady,
  splashVisible,
  splashExiting,
  onSplashExited,
}: WorkbenchStartupLifecycleState) {
  useShortcut(
    'app.closePreview',
    { key: 'Escape', scope: 'app', allowInInput: true },
    () => window.dispatchEvent(new CustomEvent('closePreview')),
    { priority: 1, description: 'keyboard.shortcuts.app.closePreview' }
  );

  useGlobalSceneShortcuts();

  return (
    <>
      <AppLayout />
      <NotificationContainer />
      <WorkbenchDeferredOverlays enabled={nonCriticalUiReady} />
      <WorkbenchSplash
        visible={splashVisible}
        isExiting={splashExiting}
        onExited={onSplashExited}
      />
    </>
  );
}

export default function WorkbenchShell() {
  const startupState = useWorkbenchStartupLifecycle();

  return (
    <WorkbenchProviders>
      <WorkbenchShellContent {...startupState} />
    </WorkbenchProviders>
  );
}
