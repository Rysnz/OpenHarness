import React, { useState, useCallback, useRef, useEffect } from 'react';
import PairingPage from './pages/PairingPage';
import WorkspacePage from './pages/WorkspacePage';
import SessionListPage from './pages/SessionListPage';
import ChatPage from './pages/ChatPage';
import { I18nProvider } from './i18n';
import { RelayHttpClient } from './services/RelayHttpClient';
import { RemoteSessionManager } from './services/RemoteSessionManager';
import { ThemeProvider } from './theme';
import './styles/index.scss';

type Page = 'pairing' | 'workspace' | 'sessions' | 'chat';
type NavDirection = 'push' | 'pop' | null;

const NAV_DURATION = 300;
const INITIAL_PAGE: Page = 'pairing';
const ROOT_PAGES = new Set<Page>(['pairing', 'sessions']);

interface MobileRuntime {
  client: RelayHttpClient | null;
  sessionMgr: RemoteSessionManager | null;
}

interface NavigatorState {
  page: Page;
  prevPage: Page | null;
  navDir: NavDirection;
  isAnimating: boolean;
  navigateTo: (target: Page, direction: NavDirection) => void;
  resetToSessions: () => void;
  shouldShow: (target: Page) => boolean;
}

const getNavClass = (
  targetPage: Page,
  currentPage: Page,
  navDir: NavDirection,
  isAnimating: boolean,
): string => {
  if (!isAnimating) {
    return '';
  }

  const entering = currentPage === targetPage;
  if (navDir === 'push') {
    return entering ? 'nav-push-enter' : 'nav-push-exit';
  }

  return entering ? 'nav-pop-enter' : 'nav-pop-exit';
};

const isExternalHttpLink = (href: string): boolean => (
  href.startsWith('http://') || href.startsWith('https://')
);

const useExternalLinkInterception = (): void => {
  useEffect(() => {
    const handleLinkClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      const link = target.closest('a') as HTMLAnchorElement | null;

      if (!link?.href || !isExternalHttpLink(link.href)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      window.open(link.href, '_blank', 'noopener,noreferrer');
    };

    document.addEventListener('click', handleLinkClick, true);
    return () => document.removeEventListener('click', handleLinkClick, true);
  }, []);
};

const useMobileNavigator = (): NavigatorState => {
  const [page, setPage] = useState<Page>(INITIAL_PAGE);
  const [prevPage, setPrevPage] = useState<Page | null>(null);
  const [navDir, setNavDir] = useState<NavDirection>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  const pageStackRef = useRef<Page[]>([INITIAL_PAGE]);
  const isPopstateNavRef = useRef(false);

  const clearNavigationTimer = useCallback(() => {
    clearTimeout(timerRef.current);
  }, []);

  const finishAnimationLater = useCallback(() => {
    clearNavigationTimer();
    timerRef.current = setTimeout(() => {
      setPrevPage(null);
      setNavDir(null);
    }, NAV_DURATION);
  }, [clearNavigationTimer]);

  const navigateTo = useCallback((target: Page, direction: NavDirection) => {
    setPage((current) => {
      setPrevPage(current);
      return target;
    });
    setNavDir(direction);
    finishAnimationLater();

    if (direction === 'push') {
      pageStackRef.current = [...pageStackRef.current, target];
      if (!isPopstateNavRef.current) {
        history.pushState({ page: target }, '');
      }
    } else if (direction === 'pop') {
      pageStackRef.current = pageStackRef.current.slice(0, -1);
      if (!isPopstateNavRef.current) {
        history.back();
      }
    }
  }, [finishAnimationLater]);

  const resetToSessions = useCallback(() => {
    pageStackRef.current = ['pairing', 'sessions'];
    history.pushState({ page: 'sessions' }, '');
    setPage('sessions');
    setPrevPage(null);
    setNavDir(null);
  }, []);

  useEffect(() => () => clearNavigationTimer(), [clearNavigationTimer]);

  useEffect(() => {
    const onPopState = () => {
      const stack = pageStackRef.current;
      const currentPage = stack[stack.length - 1];

      if (ROOT_PAGES.has(currentPage)) {
        history.pushState({ page: currentPage }, '');
        return;
      }

      isPopstateNavRef.current = true;
      try {
        navigateTo('sessions', 'pop');
      } finally {
        isPopstateNavRef.current = false;
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [navigateTo]);

  const isAnimating = navDir !== null;
  const shouldShow = useCallback(
    (target: Page) => page === target || (isAnimating && prevPage === target),
    [isAnimating, page, prevPage]
  );

  return {
    page,
    prevPage,
    navDir,
    isAnimating,
    navigateTo,
    resetToSessions,
    shouldShow,
  };
};

const AppContent: React.FC = () => {
  const [runtime, setRuntime] = useState<MobileRuntime>({ client: null, sessionMgr: null });
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [activeSessionName, setActiveSessionName] = useState('Session');
  const [chatAutoFocus, setChatAutoFocus] = useState(false);
  const navigator = useMobileNavigator();

  useExternalLinkInterception();

  const clearActiveSessionAfterTransition = useCallback(() => {
    setTimeout(() => setActiveSessionId(null), NAV_DURATION);
  }, []);

  const handlePaired = useCallback(
    (client: RelayHttpClient, sessionMgr: RemoteSessionManager) => {
      setRuntime({ client, sessionMgr });
      navigator.resetToSessions();
    },
    [navigator],
  );

  const handleOpenWorkspace = useCallback(() => {
    navigator.navigateTo('workspace', 'push');
  }, [navigator]);

  const handleWorkspaceReady = useCallback(() => {
    navigator.navigateTo('sessions', 'pop');
  }, [navigator]);

  const handleSelectSession = useCallback((sessionId: string, sessionName?: string, isNew?: boolean) => {
    setActiveSessionId(sessionId);
    setActiveSessionName(sessionName || 'Session');
    setChatAutoFocus(Boolean(isNew));
    navigator.navigateTo('chat', 'push');
  }, [navigator]);

  const handleBackToSessions = useCallback(() => {
    navigator.navigateTo('sessions', 'pop');
    clearActiveSessionAfterTransition();
  }, [clearActiveSessionAfterTransition, navigator]);

  useEffect(() => {
    if (navigator.page === 'sessions' && navigator.prevPage === 'chat' && navigator.navDir === 'pop') {
      clearActiveSessionAfterTransition();
    }
  }, [clearActiveSessionAfterTransition, navigator.navDir, navigator.page, navigator.prevPage]);

  const navClassFor = useCallback((target: Page) => (
    getNavClass(target, navigator.page, navigator.navDir, navigator.isAnimating)
  ), [navigator.isAnimating, navigator.navDir, navigator.page]);

  const { sessionMgr } = runtime;

  return (
    <div className="mobile-app">
      {navigator.page === 'pairing' && <PairingPage onPaired={handlePaired} />}

      {navigator.shouldShow('workspace') && sessionMgr && (
        <div className={`nav-page ${navClassFor('workspace')}`}>
          <WorkspacePage sessionMgr={sessionMgr} onReady={handleWorkspaceReady} />
        </div>
      )}

      {navigator.shouldShow('sessions') && sessionMgr && (
        <div className={`nav-page ${navClassFor('sessions')}`}>
          <SessionListPage
            sessionMgr={sessionMgr}
            onSelectSession={handleSelectSession}
            onOpenWorkspace={handleOpenWorkspace}
          />
        </div>
      )}

      {navigator.shouldShow('chat') && sessionMgr && activeSessionId && (
        <div className={`nav-page ${navClassFor('chat')}`}>
          <ChatPage
            sessionMgr={sessionMgr}
            sessionId={activeSessionId}
            sessionName={activeSessionName}
            onBack={handleBackToSessions}
            autoFocus={chatAutoFocus}
          />
        </div>
      )}
    </div>
  );
};

const App: React.FC = () => (
  <ThemeProvider>
    <I18nProvider>
      <AppContent />
    </I18nProvider>
  </ThemeProvider>
);

export default App;
