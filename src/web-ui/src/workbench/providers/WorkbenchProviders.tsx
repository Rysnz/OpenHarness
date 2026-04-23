import type { ReactNode, FC } from 'react';
import { ChatProvider } from '../../infrastructure/contexts/ChatProvider';
import { ViewModeProvider } from '../../infrastructure/contexts/ViewModeProvider';
import { SSHRemoteProvider } from '../../features/ssh-remote/SSHRemoteProvider';
import { ToolbarModeProvider } from '../../flow_chat/components/toolbar-mode/ToolbarModeProvider';

interface WorkbenchProvidersProps {
  children: ReactNode;
}

export const WorkbenchProviders: FC<WorkbenchProvidersProps> = ({ children }) => {
  return (
    <ChatProvider>
      <ViewModeProvider defaultMode="coder">
        <SSHRemoteProvider>
          <ToolbarModeProvider>{children}</ToolbarModeProvider>
        </SSHRemoteProvider>
      </ViewModeProvider>
    </ChatProvider>
  );
};
