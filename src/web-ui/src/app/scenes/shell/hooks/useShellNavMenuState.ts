import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';

const WORKSPACE_MENU_VIEWPORT_PADDING = 8;
const WORKSPACE_MENU_ESTIMATED_WIDTH = 220;
const WORKSPACE_MENU_TOP_OFFSET = 6;

interface MenuPosition {
  top: number;
  left: number;
}

interface UseShellNavMenuStateReturn {
  menuOpen: boolean;
  setMenuOpen: Dispatch<SetStateAction<boolean>>;
  workspaceMenuOpen: boolean;
  setWorkspaceMenuOpen: Dispatch<SetStateAction<boolean>>;
  workspaceMenuPosition: MenuPosition | null;
  menuRef: React.RefObject<HTMLDivElement>;
  workspaceMenuRef: React.RefObject<HTMLDivElement>;
  workspaceTriggerRef: React.RefObject<HTMLButtonElement>;
}

export function useShellNavMenuState(
  hasMultipleWorkspaces: boolean,
): UseShellNavMenuStateReturn {
  const [menuOpen, setMenuOpen] = useState(false);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const [workspaceMenuPosition, setWorkspaceMenuPosition] = useState<MenuPosition | null>(null);

  const menuRef = useRef<HTMLDivElement>(null);
  const workspaceMenuRef = useRef<HTMLDivElement>(null);
  const workspaceTriggerRef = useRef<HTMLButtonElement>(null);

  const closeMenus = useCallback(() => {
    setMenuOpen(false);
    setWorkspaceMenuOpen(false);
  }, []);

  useEffect(() => {
    if (!menuOpen && !workspaceMenuOpen) {
      return;
    }

    const handleMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && isMenuInteractionTarget(target, [menuRef, workspaceMenuRef, workspaceTriggerRef])) {
        return;
      }

      closeMenus();
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenus();
      }
    };

    document.addEventListener('mousedown', handleMouseDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('mousedown', handleMouseDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [closeMenus, menuOpen, workspaceMenuOpen]);

  useEffect(() => {
    if (!hasMultipleWorkspaces && workspaceMenuOpen) {
      setWorkspaceMenuOpen(false);
    }
  }, [hasMultipleWorkspaces, workspaceMenuOpen]);

  const updateWorkspaceMenuPosition = useCallback(() => {
    const trigger = workspaceTriggerRef.current;
    if (!trigger) {
      return;
    }

    const rect = trigger.getBoundingClientRect();
    const maxLeft =
      window.innerWidth - WORKSPACE_MENU_ESTIMATED_WIDTH - WORKSPACE_MENU_VIEWPORT_PADDING;

    setWorkspaceMenuPosition({
      top: clampMenuCoordinate(
        rect.bottom + WORKSPACE_MENU_TOP_OFFSET,
        WORKSPACE_MENU_VIEWPORT_PADDING,
      ),
      left: clampMenuCoordinate(rect.left, WORKSPACE_MENU_VIEWPORT_PADDING, maxLeft),
    });
  }, []);

  useEffect(() => {
    if (!workspaceMenuOpen) {
      return;
    }

    updateWorkspaceMenuPosition();

    const handleViewportChange = () => updateWorkspaceMenuPosition();
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);

    return () => {
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [updateWorkspaceMenuPosition, workspaceMenuOpen]);

  return {
    menuOpen,
    setMenuOpen,
    workspaceMenuOpen,
    setWorkspaceMenuOpen,
    workspaceMenuPosition,
    menuRef,
    workspaceMenuRef,
    workspaceTriggerRef,
  };
}

type MenuRef =
  | RefObject<HTMLDivElement>
  | RefObject<HTMLButtonElement>;

function isMenuInteractionTarget(target: Node, refs: MenuRef[]): boolean {
  return refs.some((ref) => ref.current?.contains(target));
}

function clampMenuCoordinate(value: number, min: number, max = Number.POSITIVE_INFINITY): number {
  return Math.max(min, Math.min(value, max));
}
