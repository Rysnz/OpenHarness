import { Suspense, lazy } from 'react';
import type { ReactNode } from 'react';
import type { SceneTabId } from '@/app/components/SceneBar/types';
import { useSceneManager } from '@/app/hooks/useSceneManager';
import { useDialogCompletionNotify } from '@/app/hooks/useDialogCompletionNotify';
import { useI18n } from '@/infrastructure/i18n/hooks/useI18n';
import { ProcessingIndicator } from '@/flow_chat/components/modern/ProcessingIndicator';
import PartnerScene from '@/app/scenes/partner/PartnerScene';
import SessionScene from '@/app/scenes/session/SessionScene';
import '@/app/scenes/SceneViewport.scss';

const SettingsScene = lazy(() => import('@/app/scenes/settings/SettingsScene'));
const TerminalScene = lazy(() => import('@/app/scenes/terminal/TerminalScene'));
const GitScene = lazy(() => import('@/app/scenes/git/GitScene'));
const FileViewerScene = lazy(() => import('@/app/scenes/file-viewer/FileViewerScene'));
const ProfileScene = lazy(() => import('@/app/scenes/profile/ProfileScene'));
const AgentsScene = lazy(() => import('@/app/scenes/agents/AgentsScene'));
const SkillsScene = lazy(() => import('@/app/scenes/skills/SkillsScene'));
const MiniAppGalleryScene = lazy(() => import('@/app/scenes/miniapps/MiniAppGalleryScene'));
const BrowserScene = lazy(() => import('@/app/scenes/browser/BrowserScene'));
const MermaidEditorScene = lazy(() => import('@/app/scenes/mermaid/MermaidEditorScene'));
const InsightsScene = lazy(() => import('@/app/scenes/my-agent/InsightsScene'));
const ShellScene = lazy(() => import('@/app/scenes/shell/ShellScene'));
const WelcomeScene = lazy(() => import('@/app/scenes/welcome/WelcomeScene'));
const MiniAppScene = lazy(() => import('@/app/scenes/miniapps/MiniAppScene'));
const PanelViewScene = lazy(() => import('@/app/scenes/panel-view/PanelViewScene'));

interface SceneViewportProps {
  workspacePath?: string;
  isEntering?: boolean;
}

interface SceneRenderContext {
  workspacePath?: string;
  isEntering: boolean;
  isActive: boolean;
}

type SceneRenderer = (context: SceneRenderContext) => ReactNode;

const STATIC_SCENE_RENDERERS: Partial<Record<SceneTabId, SceneRenderer>> = {
  welcome: () => <WelcomeScene />,
  session: ({ workspacePath, isEntering, isActive }) => (
    <SessionScene workspacePath={workspacePath} isEntering={isEntering} isActive={isActive} />
  ),
  terminal: ({ isActive }) => <TerminalScene isActive={isActive} />,
  git: ({ workspacePath, isActive }) => <GitScene workspacePath={workspacePath} isActive={isActive} />,
  settings: () => <SettingsScene />,
  'file-viewer': ({ workspacePath }) => <FileViewerScene workspacePath={workspacePath} />,
  profile: () => <ProfileScene />,
  agents: () => <AgentsScene />,
  skills: () => <SkillsScene />,
  miniapps: () => <MiniAppGalleryScene />,
  browser: () => <BrowserScene />,
  mermaid: () => <MermaidEditorScene />,
  partner: ({ workspacePath }) => <PartnerScene workspacePath={workspacePath} />,
  insights: () => <InsightsScene />,
  shell: ({ isActive }) => <ShellScene isActive={isActive} />,
  'panel-view': ({ workspacePath }) => <PanelViewScene workspacePath={workspacePath} />,
};

export default function WorkbenchSceneViewport({
  workspacePath,
  isEntering = false,
}: SceneViewportProps) {
  const { openTabs, activeTabId } = useSceneManager();
  const { t } = useI18n('common');
  useDialogCompletionNotify();

  if (openTabs.length === 0) {
    return (
      <div className="openharness-scene-viewport">
        <div className="openharness-scene-viewport__clip openharness-scene-viewport__clip--empty">
          <p className="openharness-scene-viewport__empty-hint">{t('welcomeScene.emptyHint')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="openharness-scene-viewport">
      <div className="openharness-scene-viewport__clip">
        {openTabs.map((tab) => {
          const isActive = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              className={[
                'openharness-scene-viewport__scene',
                isActive && 'openharness-scene-viewport__scene--active',
              ].filter(Boolean).join(' ')}
              aria-hidden={!isActive}
            >
              <Suspense fallback={isActive ? <SceneLoadingFallback label={t('loading.scenes')} /> : null}>
                {renderScene(tab.id, { workspacePath, isEntering, isActive })}
              </Suspense>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SceneLoadingFallback({ label }: { label: string }) {
  return (
    <div
      className="openharness-scene-viewport__lazy-fallback"
      role="status"
      aria-busy="true"
      aria-label={label}
    >
      <ProcessingIndicator visible />
    </div>
  );
}

function renderScene(id: SceneTabId, context: SceneRenderContext): ReactNode {
  const renderer = STATIC_SCENE_RENDERERS[id];
  if (renderer) {
    return renderer(context);
  }

  if (typeof id === 'string' && id.startsWith('miniapp:')) {
    return <MiniAppScene appId={id.slice('miniapp:'.length)} />;
  }

  return null;
}
