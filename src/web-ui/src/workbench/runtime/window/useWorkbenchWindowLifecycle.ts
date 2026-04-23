import { useEffect } from 'react';
import { FlowChatManager } from '../../../flow_chat/services/FlowChatManager';
import { createLogger } from '../../../shared/utils/logger';

const log = createLogger('WorkbenchWindowLifecycle');

export function useWorkbenchWindowClosePersistence(): void {
  useEffect(() => {
    let unlistenFn: (() => void) | null = null;

    const setupWindowCloseListener = async () => {
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window');
        const currentWindow = getCurrentWindow();

        unlistenFn = await currentWindow.onCloseRequested(
          async (event: { preventDefault: () => void }) => {
            try {
              event.preventDefault();
              const flowChatManager = FlowChatManager.getInstance();
              await flowChatManager.saveAllInProgressTurns();
              await currentWindow.close();
            } catch (error) {
              log.error('Failed to save conversations, closing anyway', error);
              await currentWindow.close();
            }
          }
        );
      } catch (error) {
        log.error('Failed to setup window close listener', error);
      }
    };

    void setupWindowCloseListener();
    return () => {
      if (unlistenFn) {
        unlistenFn();
      }
    };
  }, []);
}

export function useWorkbenchDragAndDropGuard(): void {
  useEffect(() => {
    const handleDragStart = (event: DragEvent) => {
      if (event.dataTransfer) {
        if (event.dataTransfer.types.length === 0) {
          event.dataTransfer.setData('text/plain', 'dragging');
        }
        event.dataTransfer.effectAllowed = 'copy';
      }
    };
    const handleDragOver = (event: DragEvent) => event.preventDefault();
    const handleDragEnter = (_event: DragEvent) => {};
    const handleDrop = (event: DragEvent) => {
      if (!event.defaultPrevented) {
        event.preventDefault();
      }
    };

    document.addEventListener('dragstart', handleDragStart, true);
    document.addEventListener('dragover', handleDragOver, true);
    document.addEventListener('dragenter', handleDragEnter, true);
    document.addEventListener('drop', handleDrop, true);

    return () => {
      document.removeEventListener('dragstart', handleDragStart, true);
      document.removeEventListener('dragover', handleDragOver, true);
      document.removeEventListener('dragenter', handleDragEnter, true);
      document.removeEventListener('drop', handleDrop, true);
    };
  }, []);
}
