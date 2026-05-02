import { create } from 'zustand';
import { listen } from '@tauri-apps/api/event';
import {
  insightsApi,
  type InsightsReport,
  type InsightsReportMeta,
  type InsightsProgressEvent,
} from '@/infrastructure/api/insightsApi';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('InsightsStore');

const RETRY_STAGES = new Set(['facet_retry', 'recommendations_retry']);
const DEFAULT_SELECTED_DAYS = 30;

export type InsightsView = 'list' | 'report';

interface InsightsProgress {
  stage: string;
  message: string;
  current: number;
  total: number;
  isRetrying: boolean;
}

interface InsightsState {
  view: InsightsView;
  reportMetas: InsightsReportMeta[];
  currentReport: InsightsReport | null;
  generating: boolean;
  progress: InsightsProgress;
  selectedDays: number;
  error: string;
  loadingMetas: boolean;

  setSelectedDays: (days: number) => void;
  fetchReportMetas: () => Promise<void>;
  loadReport: (meta: InsightsReportMeta) => Promise<void>;
  generateReport: () => Promise<void>;
  cancelGeneration: () => Promise<void>;
  backToList: () => void;
  clearError: () => void;
}

const defaultProgress: InsightsProgress = {
  stage: '',
  message: '',
  current: 0,
  total: 0,
  isRetrying: false,
};

const freshProgress = (message = ''): InsightsProgress => ({
  ...defaultProgress,
  message,
});

function eventToProgress(event: InsightsProgressEvent): InsightsProgress {
  const { message, stage, current, total } = event;
  return {
    stage,
    message,
    current,
    total,
    isRetrying: RETRY_STAGES.has(stage),
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export const useInsightsStore = create<InsightsState>((set, get) => ({
  view: 'list',
  reportMetas: [],
  currentReport: null,
  generating: false,
  progress: freshProgress(),
  selectedDays: DEFAULT_SELECTED_DAYS,
  error: '',
  loadingMetas: false,

  setSelectedDays: (days) => set({ selectedDays: days }),

  fetchReportMetas: async () => {
    set({ loadingMetas: true });
    try {
      const metas = await insightsApi.getLatestInsights();
      set({ reportMetas: metas, loadingMetas: false });
    } catch (err) {
      log.error('Failed to fetch report metas', err);
      set({ loadingMetas: false });
    }
  },

  loadReport: async (meta) => {
    try {
      const report = await insightsApi.loadReport(meta.path);
      set({ currentReport: report, view: 'report', error: '' });
    } catch (err) {
      log.error('Failed to load report', err);
      set({ error: errorMessage(err) });
    }
  },

  generateReport: async () => {
    const { selectedDays, generating } = get();
    if (generating) return;

    set({
      generating: true,
      error: '',
      progress: freshProgress('Starting...'),
    });

    const unlisten = await listen<InsightsProgressEvent>('insights-progress', (event) => {
      set({ progress: eventToProgress(event.payload) });
    });

    try {
      const report = await insightsApi.generateInsights(selectedDays);
      log.info('Insights report generated', {
        sessions: report.total_sessions,
        analyzed: report.analyzed_sessions,
      });
      set({
        currentReport: report,
        view: 'report',
        generating: false,
        progress: freshProgress(),
      });
      void get().fetchReportMetas();
    } catch (err) {
      log.error('Failed to generate insights', err);
      set({
        generating: false,
        view: 'list',
        error: errorMessage(err),
        progress: freshProgress(),
      });
    } finally {
      unlisten();
    }
  },

  cancelGeneration: async () => {
    if (!get().generating) return;
    try {
      await insightsApi.cancelGeneration();
    } catch (err) {
      log.error('Failed to cancel insights generation', err);
    }
    set({
      generating: false,
      progress: freshProgress(),
    });
  },

  backToList: () => set({ view: 'list', currentReport: null }),

  clearError: () => set({ error: '' }),
}));
