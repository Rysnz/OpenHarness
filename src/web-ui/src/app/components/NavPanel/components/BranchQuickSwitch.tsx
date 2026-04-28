/**
 * Branch quick switch overlay.
 * Shown when clicking the branch badge in NavPanel Git item.
 * Supports search and checkout.
 */

import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { GitBranch, Check, Loader2 } from 'lucide-react';
import { type GitBranch as GitBranchType } from '../../../../infrastructure/api/service-api/GitAPI';
import { useI18n } from '@/infrastructure/i18n';
import { gitService, gitEventService } from '../../../../tools/git/services';
import { gitStateManager } from '../../../../tools/git/state/GitStateManager';
import { notificationService } from '../../../../shared/notification-system/services/NotificationService';
import { createLogger } from '@/shared/utils/logger';
import './BranchQuickSwitch.scss';

const log = createLogger('BranchQuickSwitch');
const PANEL_WIDTH = 280;
const PANEL_MARGIN = 12;
const PANEL_HEIGHT = 320;
const PANEL_GAP = 8;
const FOCUS_DELAY_MS = 50;
const OUTSIDE_CLICK_DELAY_MS = 10;

interface OverlayPosition {
  top: number;
  left: number;
}

export interface BranchQuickSwitchProps {
  isOpen: boolean;
  onClose: () => void;
  repositoryPath: string;
  currentBranch: string;
  anchorRef: React.RefObject<HTMLElement>;
  onSwitchSuccess?: (branchName: string) => void;
}

function getPanelPosition(anchor: HTMLElement): OverlayPosition {
  const rect = anchor.getBoundingClientRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;

  let left = rect.right + PANEL_GAP;
  if (left + PANEL_WIDTH > viewportWidth - PANEL_MARGIN) {
    left = rect.left - PANEL_WIDTH - PANEL_GAP;
  }

  let top = rect.top;
  if (top + PANEL_HEIGHT > viewportHeight - PANEL_MARGIN) {
    top = viewportHeight - PANEL_HEIGHT - PANEL_MARGIN;
  }

  return {
    top: Math.max(PANEL_MARGIN, top),
    left: Math.max(PANEL_MARGIN, left)
  };
}

function normalizeBranches(branches: GitBranchType[]): GitBranchType[] {
  return branches.map(branch => ({
    name: branch.name,
    current: branch.current,
    remote: branch.remote,
    lastCommit: branch.lastCommit,
    ahead: branch.ahead,
    behind: branch.behind,
  }));
}

function filterAndSortBranches(branches: GitBranchType[], searchTerm: string): GitBranchType[] {
  const query = searchTerm.trim().toLowerCase();
  const visibleBranches = query
    ? branches.filter(branch => branch.name.toLowerCase().includes(query))
    : branches;

  return [...visibleBranches].sort((a, b) => {
    if (a.current) return -1;
    if (b.current) return 1;
    return a.name.localeCompare(b.name);
  });
}

function branchItemClassName(branch: GitBranchType, index: number, selectedIndex: number, switchingBranch: string | null): string {
  return [
    'branch-quick-switch__item',
    branch.current && 'branch-quick-switch__item--current',
    index === selectedIndex && 'branch-quick-switch__item--selected',
    switchingBranch === branch.name && 'branch-quick-switch__item--switching',
  ].filter(Boolean).join(' ');
}

function scrollSelectedBranchIntoView(list: HTMLDivElement | null, selectedIndex: number): void {
  if (!list) {
    return;
  }

  const items = list.querySelectorAll('.branch-quick-switch__item');
  const selectedItem = items[selectedIndex] as HTMLElement;
  selectedItem?.scrollIntoView({ block: 'nearest' });
}

function emitBranchChanged(repositoryPath: string, branchName: string): void {
  gitEventService.emit('branch:changed', {
    repositoryPath,
    branch: { name: branchName, current: true, remote: false, ahead: 0, behind: 0 },
    timestamp: new Date(),
  });
}

export const BranchQuickSwitch: React.FC<BranchQuickSwitchProps> = ({
  isOpen,
  onClose,
  repositoryPath,
  currentBranch,
  anchorRef,
  onSwitchSuccess
}) => {
  const { t } = useI18n('panels/git');
  const [branches, setBranches] = useState<GitBranchType[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isSwitching, setIsSwitching] = useState(false);
  const [switchingBranch, setSwitchingBranch] = useState<string | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [position, setPosition] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Position relative to anchor (NavPanel item)
  useEffect(() => {
    if (isOpen && anchorRef.current) {
      setPosition(getPanelPosition(anchorRef.current));
    }
  }, [isOpen, anchorRef]);

  useEffect(() => {
    if (!isOpen) {
      setSearchTerm('');
      setSelectedIndex(0);
    } else {
      setTimeout(() => inputRef.current?.focus(), FOCUS_DELAY_MS);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, OUTSIDE_CLICK_DELAY_MS);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const loadBranches = useCallback(async () => {
    setIsLoading(true);
    try {
      const cachedState = gitStateManager.getState(repositoryPath);
      if (cachedState?.branches && cachedState.branches.length > 0) {
        setBranches(normalizeBranches(cachedState.branches));
        setIsLoading(false);
        gitStateManager.refresh(repositoryPath, { layers: ['detailed'], silent: true });
        return;
      }
      await gitStateManager.refresh(repositoryPath, { layers: ['detailed'], force: true });
      const updatedState = gitStateManager.getState(repositoryPath);
      if (updatedState?.branches) {
        setBranches(normalizeBranches(updatedState.branches));
      } else {
        const branchList = await gitService.getBranches(repositoryPath, false);
        setBranches(branchList);
      }
    } catch (err) {
      log.error('Failed to load branches', err);
    } finally {
      setIsLoading(false);
    }
  }, [repositoryPath]);

  useEffect(() => {
    if (isOpen && repositoryPath) {
      void loadBranches();
    }
  }, [isOpen, loadBranches, repositoryPath]);

  const filteredBranches = useMemo(() => {
    return filterAndSortBranches(branches, searchTerm);
  }, [branches, searchTerm]);

  useEffect(() => { setSelectedIndex(0); }, [filteredBranches.length]);

  const handleSwitchBranch = useCallback(async (branchName: string) => {
    if (branchName === currentBranch || isSwitching) return;
    setIsSwitching(true);
    setSwitchingBranch(branchName);
    try {
      const result = await gitService.checkoutBranch(repositoryPath, branchName);
      if (result.success) {
        notificationService.success(
          t('quickSwitch.notifications.switchSuccess', { branch: branchName }),
          { duration: 3000 }
        );
        emitBranchChanged(repositoryPath, branchName);
        onSwitchSuccess?.(branchName);
        onClose();
      } else {
        let errorMessage = result.error
          ? t('quickSwitch.errors.switchFailedWithMessage', { error: result.error })
          : t('quickSwitch.errors.switchFailed');
        if (result.error?.includes('local changes')) errorMessage = t('quickSwitch.errors.localChanges');
        else if (result.error?.includes('resolve your current index first')) errorMessage = t('quickSwitch.errors.indexConflict');
        notificationService.error(errorMessage, { title: t('quickSwitch.errors.title'), duration: 5000 });
      }
    } catch (error) {
      log.error('Failed to switch branch', error);
      notificationService.error(t('quickSwitch.errors.unexpected'), { duration: 5000 });
    } finally {
      setIsSwitching(false);
      setSwitchingBranch(null);
    }
  }, [repositoryPath, currentBranch, isSwitching, onSwitchSuccess, onClose, t]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (filteredBranches.length === 0) return;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => prev < filteredBranches.length - 1 ? prev + 1 : prev);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => prev > 0 ? prev - 1 : prev);
        break;
      case 'Enter': {
        e.preventDefault();
        const sel = filteredBranches[selectedIndex];
        if (sel && !sel.current) handleSwitchBranch(sel.name);
        break;
      }
    }
  }, [filteredBranches, selectedIndex, handleSwitchBranch]);

  useEffect(() => {
    if (listRef.current && filteredBranches.length > 0) {
      scrollSelectedBranchIntoView(listRef.current, selectedIndex);
    }
  }, [selectedIndex, filteredBranches.length]);

  if (!isOpen) return null;

  return (
    <div
      ref={panelRef}
      className="branch-quick-switch"
      style={{ top: position.top, left: position.left, width: PANEL_WIDTH }}
      onKeyDown={handleKeyDown}
    >
      <div className="branch-quick-switch__search">
        <input
          ref={inputRef}
          type="text"
          placeholder={t('quickSwitch.searchPlaceholder')}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="branch-quick-switch__input"
        />
      </div>
      <div ref={listRef} className="branch-quick-switch__list">
        {isLoading ? (
          <div className="branch-quick-switch__loading">
            <Loader2 size={16} className="branch-quick-switch__spinner" />
            <span>{t('quickSwitch.loading')}</span>
          </div>
        ) : filteredBranches.length === 0 ? (
          <div className="branch-quick-switch__empty">
            {searchTerm ? t('empty.noMatchingBranches') : t('empty.noBranches')}
          </div>
        ) : (
          filteredBranches.map((branch, index) => (
            <div
              key={branch.name}
              className={branchItemClassName(branch, index, selectedIndex, switchingBranch)}
              onClick={() => handleSwitchBranch(branch.name)}
              onMouseEnter={() => setSelectedIndex(index)}
            >
              <GitBranch size={14} className="branch-quick-switch__item-icon" />
              <span className="branch-quick-switch__item-name">{branch.name}</span>
              {branch.current && <Check size={14} className="branch-quick-switch__item-check" />}
              {switchingBranch === branch.name && <Loader2 size={14} className="branch-quick-switch__spinner" />}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default BranchQuickSwitch;
