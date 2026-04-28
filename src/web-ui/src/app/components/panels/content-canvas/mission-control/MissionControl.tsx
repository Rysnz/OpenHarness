/**
 * MissionControl component.
 * Mission control overlay showing thumbnails of all open files.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { X, Merge } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ThumbnailCard } from './ThumbnailCard';
import { SearchFilter } from './SearchFilter';
import { useCanvasStore } from '../stores';
import type { CanvasTab, EditorGroupId, EditorGroupState } from '../types';
import './MissionControl.scss';

const ALL_GROUP_IDS: EditorGroupId[] = ['primary', 'secondary', 'tertiary'];
const GROUP_FILTERS: Array<{
  id: EditorGroupId;
  labelKey: string;
  shortLabelKey: string;
  color: string;
  colorRgb: string;
}> = [
  { id: 'primary', labelKey: 'canvas.groupPrimaryFull', shortLabelKey: 'canvas.groupPrimary', color: '#3b82f6', colorRgb: '59, 130, 246' },
  { id: 'secondary', labelKey: 'canvas.groupSecondaryFull', shortLabelKey: 'canvas.groupSecondary', color: '#10b981', colorRgb: '16, 185, 129' },
  { id: 'tertiary', labelKey: 'canvas.groupTertiaryFull', shortLabelKey: 'canvas.groupTertiary', color: '#f59e0b', colorRgb: '245, 158, 11' },
];

interface MissionTabEntry {
  tab: CanvasTab;
  groupId: EditorGroupId;
}

type OrganizedTabs = Record<EditorGroupId, MissionTabEntry[]> & {
  all: MissionTabEntry[];
};

export interface MissionControlProps {
  /** Whether open */
  isOpen: boolean;
  /** Close callback */
  onClose: () => void;
  /** Dirty-check callback before closing tab */
  handleCloseWithDirtyCheck?: (tabId: string, groupId: EditorGroupId) => Promise<boolean>;
}

function createDefaultGroupSelection(): Set<EditorGroupId> {
  return new Set(ALL_GROUP_IDS);
}

function visibleEntriesForGroup(tabs: CanvasTab[], groupId: EditorGroupId): MissionTabEntry[] {
  return tabs
    .filter(tab => !tab.isHidden)
    .map(tab => ({ tab, groupId }));
}

function organizeTabsByGroup(
  primaryTabs: CanvasTab[],
  secondaryTabs: CanvasTab[],
  tertiaryTabs: CanvasTab[],
): OrganizedTabs {
  const primary = visibleEntriesForGroup(primaryTabs, 'primary');
  const secondary = visibleEntriesForGroup(secondaryTabs, 'secondary');
  const tertiary = visibleEntriesForGroup(tertiaryTabs, 'tertiary');

  return {
    primary,
    secondary,
    tertiary,
    all: [...primary, ...secondary, ...tertiary],
  };
}

function tabMatchesSearch(tab: CanvasTab, query: string): boolean {
  return (
    tab.title.toLowerCase().includes(query) ||
    tab.content.data?.filePath?.toLowerCase().includes(query) ||
    tab.content.type.toLowerCase().includes(query)
  );
}

function filterMissionTabs(
  allTabs: MissionTabEntry[],
  searchQuery: string,
  selectedGroups: Set<EditorGroupId>,
): MissionTabEntry[] {
  const scopedTabs = selectedGroups.size < ALL_GROUP_IDS.length
    ? allTabs.filter(({ groupId }) => selectedGroups.has(groupId))
    : allTabs;

  const query = searchQuery.trim().toLowerCase();
  return query ? scopedTabs.filter(({ tab }) => tabMatchesSearch(tab, query)) : scopedTabs;
}

function getActiveTabId(
  activeGroupId: EditorGroupId,
  primaryGroup: EditorGroupState,
  secondaryGroup: EditorGroupState,
  tertiaryGroup: EditorGroupState,
): string | null {
  const group = activeGroupId === 'primary'
    ? primaryGroup
    : activeGroupId === 'secondary'
      ? secondaryGroup
      : tertiaryGroup;

  return group.activeTabId;
}

function toggleGroupSelection(
  selectedGroups: Set<EditorGroupId>,
  groupId: EditorGroupId,
): Set<EditorGroupId> {
  const next = new Set(selectedGroups);
  if (next.has(groupId)) {
    next.delete(groupId);
  } else {
    next.add(groupId);
  }
  return next;
}

function groupFilterClassName(isActive: boolean): string {
  return `canvas-mission-control__group-filter ${isActive ? 'is-active' : ''}`;
}

function shouldShowFilteredEmpty(searchQuery: string, selectedGroups: Set<EditorGroupId>): boolean {
  return Boolean(searchQuery) || selectedGroups.size < ALL_GROUP_IDS.length;
}

export const MissionControl: React.FC<MissionControlProps> = ({
  isOpen,
  onClose,
  handleCloseWithDirtyCheck,
}) => {
  const { t } = useTranslation('components');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGroups, setSelectedGroups] = useState<Set<EditorGroupId>>(createDefaultGroupSelection);
  const [, setDraggingTabId] = useState<string | null>(null);
  const {
    primaryGroup,
    secondaryGroup,
    tertiaryGroup,
    activeGroupId,
    layout,
    switchToTab,
    closeTab,
    togglePinTab,
    setSplitMode,
  } = useCanvasStore();
  // Organize tabs by group
  const organizedTabs = useMemo(() => {
    return organizeTabsByGroup(primaryGroup.tabs, secondaryGroup.tabs, tertiaryGroup.tabs);
  }, [primaryGroup.tabs, secondaryGroup.tabs, tertiaryGroup.tabs]);

  // Aggregate all tabs (for search and stats)
  const allTabs = organizedTabs.all;

  // Filter matching tabs (search + group filter)
  const filteredTabs = useMemo(() => {
    return filterMissionTabs(allTabs, searchQuery, selectedGroups);
  }, [allTabs, searchQuery, selectedGroups]);

  // Active tab ID
  const activeTabId = useMemo(() => {
    return getActiveTabId(activeGroupId, primaryGroup, secondaryGroup, tertiaryGroup);
  }, [activeGroupId, primaryGroup, secondaryGroup, tertiaryGroup]);

  // Keyboard handling
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Close on backdrop click
  const handleBackdropClick = useCallback((e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  }, [onClose]);

  // Handle tab click
  const handleTabClick = useCallback((tabId: string, groupId: EditorGroupId) => {
    switchToTab(tabId, groupId);
    onClose();
  }, [switchToTab, onClose]);

  // Handle tab close
  const handleTabClose = useCallback(async (tabId: string, groupId: EditorGroupId) => {
    if (handleCloseWithDirtyCheck) {
      await handleCloseWithDirtyCheck(tabId, groupId);
      return;
    }
    closeTab(tabId, groupId);
  }, [closeTab, handleCloseWithDirtyCheck]);

  // Handle pin
  const handleTabPin = useCallback((tabId: string, groupId: EditorGroupId) => {
    togglePinTab(tabId, groupId);
  }, [togglePinTab]);

  // Drag start
  const handleDragStart = useCallback((tabId: string) => (_e: React.DragEvent) => {
    setDraggingTabId(tabId);
  }, []);

  // Drag end
  const handleDragEnd = useCallback(() => {
    setDraggingTabId(null);
  }, []);

  // Reset search and filters
  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setSelectedGroups(createDefaultGroupSelection());
    }
  }, [isOpen]);

  // Toggle group filter
  const toggleGroupFilter = useCallback((groupId: EditorGroupId) => {
    setSelectedGroups(prev => toggleGroupSelection(prev, groupId));
  }, []);

  // Check for multiple groups
  const hasMultipleGroups = useMemo(() => {
    return layout.splitMode !== 'none';
  }, [layout.splitMode]);

  // Merge all groups into primary
  const handleMergeAll = useCallback(() => {
    setSplitMode('none');
    onClose();
  }, [setSplitMode, onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div
      className="canvas-mission-control"
      onClick={handleBackdropClick}
    >
      <div className="canvas-mission-control__content">
        {/* Header */}
        <div className="canvas-mission-control__header">
          <h2 className="canvas-mission-control__title">{t('tabs.missionControl')}</h2>
          <div className="canvas-mission-control__header-actions">
            {hasMultipleGroups && (
              <button
                className="canvas-mission-control__merge-btn"
                onClick={handleMergeAll}
                title={t('canvas.mergeAllGroups')}
              >
                <Merge size={14} />
                <span>{t('canvas.mergeAll')}</span>
              </button>
            )}
            <button
              className="canvas-mission-control__close-btn"
              onClick={onClose}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Search and filter area */}
        <div className="canvas-mission-control__filters">
          <div className="canvas-mission-control__filters-row">
            <div className="canvas-mission-control__search-wrapper">
              <SearchFilter
                value={searchQuery}
                onChange={setSearchQuery}
                matchCount={filteredTabs.length}
                totalCount={allTabs.length}
              />
            </div>
            
            {/* Group filters - compact icon buttons */}
            {hasMultipleGroups && (
              <div className="canvas-mission-control__group-filters">
                {GROUP_FILTERS.map(({ id, labelKey, shortLabelKey, color, colorRgb }) => {
                  const hasTabs = organizedTabs[id].length > 0;
                  if (!hasTabs) return null;
                  
                  return (
                    <button
                      key={id}
                      className={groupFilterClassName(selectedGroups.has(id))}
                      onClick={() => toggleGroupFilter(id)}
                      title={t(labelKey)}
                      style={{ 
                        '--group-color': color,
                        '--group-color-rgb': colorRgb,
                      } as React.CSSProperties}
                    >
                      <span className="canvas-mission-control__group-filter-indicator" />
                      <span className="canvas-mission-control__group-filter-text">{t(shortLabelKey)}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Thumbnail grid - unified display */}
        <div className="canvas-mission-control__grid">
          {filteredTabs.length > 0 ? (
            filteredTabs.map(({ tab, groupId }) => (
              <ThumbnailCard
                key={tab.id}
                tab={tab}
                groupId={groupId}
                isActive={tab.id === activeTabId && groupId === activeGroupId}
                onClick={() => handleTabClick(tab.id, groupId)}
                onClose={() => handleTabClose(tab.id, groupId)}
                onPin={() => handleTabPin(tab.id, groupId)}
                onDragStart={handleDragStart(tab.id)}
                onDragEnd={handleDragEnd}
              />
            ))
          ) : (
            <div className="canvas-mission-control__empty">
              {shouldShowFilteredEmpty(searchQuery, selectedGroups) ? (
                <span>{t('canvas.noMatchingFiles')}</span>
              ) : (
                <span>{t('canvas.noOpenFiles')}</span>
              )}
            </div>
          )}
        </div>

        {/* Footer hint */}
        <div className="canvas-mission-control__footer">
          <span>{t('canvas.clickToSwitch')}</span>
          <div className="canvas-mission-control__separator" />
          <span><kbd>Esc</kbd> {t('canvas.exit')}</span>
        </div>
      </div>
    </div>
  );
};

MissionControl.displayName = 'MissionControl';

export default MissionControl;
