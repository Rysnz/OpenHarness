/**
 * Infrastructure unified exports.
 */

// Event bus
export * from './event-bus';

// API layer
export * from './api';

// Contexts (explicit exports to avoid name collisions)
export { ChatProvider } from './contexts/ChatProvider';
export { useChat } from './contexts/ChatContext';
export { useWorkspaceContext } from './contexts/WorkspaceContext';

// Configuration
export * from './config';

// Infrastructure hooks
export * from './hooks/useAIInitialization';

// Infrastructure lifecycle
export {
  initializeInfrastructure,
  destroyInfrastructure,
  initializeCore,
  destroyCore,
} from './lifecycle';
