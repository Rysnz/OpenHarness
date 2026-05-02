/**
 * Panel controller.
 *
 * Implements a subset of IDE control operations focused on opening/closing panels.
 */
import { i18nService } from '@/infrastructure/i18n';
import {
  IdeController,
  IdeControlEvent,
  IdeControlOptions,
  PanelType,
  PanelConfig,
  PanelOpenConfig,
} from './types';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('PanelController');
const PANEL_EXPAND_DELAY_MS = 300;
const PANEL_FOCUS_DELAY_MS = 100;

type TabDetail = {
  type: PanelType;
  title: string;
  data: Record<string, any>;
  metadata: {
    duplicateCheckKey: string;
  };
  checkDuplicate: boolean;
  replaceExisting: boolean;
  duplicateCheckKey: string;
};

type PanelEventName = 'agent-create-tab' | 'project-create-tab' | 'git-create-tab';

const modeEventNames: Record<NonNullable<IdeControlOptions['mode']>, PanelEventName> = {
  agent: 'agent-create-tab',
  project: 'project-create-tab',
  git: 'git-create-tab',
};

function dispatchIdeEvent(eventName: string, detail?: unknown): void {
  window.dispatchEvent(new CustomEvent(eventName, detail === undefined ? undefined : { detail }));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

 
export class PanelController implements IdeController {
  async execute(
    target: IdeControlEvent['target'],
    options?: IdeControlOptions,
    metadata?: IdeControlEvent['metadata']
  ): Promise<void> {
    const panelType = target.type as PanelType;
    await this.openPanel({
      panelType,
      position: target.position || 'right',
      config: target.config || {},
      options,
    });

    if (metadata?.request_id) {
      this.sendExecutionResult(metadata.request_id, true, `Panel ${panelType} opened successfully`);
    }
  }

  async openPanel(config: PanelOpenConfig): Promise<void> {
    const { panelType, position, config: panelConfig, options } = config;
    const eventName = this.resolveCreateEvent(options?.mode);
    const tabDetail = this.buildTabDetail(panelType, panelConfig || {}, options);

    if (position === 'right' && options?.expand_panel !== false) {
      dispatchIdeEvent('expand-right-panel');
      await this.waitForPanelExpansion();
    }

    dispatchIdeEvent(eventName, tabDetail);

    if (options?.auto_focus !== false) {
      setTimeout(() => this.focusPanel(panelType), PANEL_FOCUS_DELAY_MS);
    }
  }

  async closePanel(panelType: PanelType): Promise<void> {
    dispatchIdeEvent('ide-close-panel', { panelType });
  }

  async togglePanel(panelType: PanelType): Promise<void> {
    dispatchIdeEvent('ide-toggle-panel', { panelType });
  }

  focusPanel(panelType: PanelType): void {
    dispatchIdeEvent('ide-focus-panel', { panelType });
  }

  private resolveCreateEvent(mode: IdeControlOptions['mode'] = 'agent'): PanelEventName {
    return modeEventNames[mode];
  }

  private buildTabDetail(
    panelType: PanelType,
    config: PanelConfig,
    options?: IdeControlOptions
  ): TabDetail {
    const baseDetail = this.createBaseTabDetail(panelType, config, options);

    return this.applyPanelSpecificConfig(baseDetail, panelType, config);
  }

  private createBaseTabDetail(
    panelType: PanelType,
    config: PanelConfig,
    options?: IdeControlOptions
  ): TabDetail {
    const duplicateCheckKey = this.getDuplicateCheckKey(panelType, config);

    return {
      type: panelType,
      title: this.getPanelTitle(panelType, config),
      data: config.data || {},
      metadata: {
        duplicateCheckKey,
      },
      checkDuplicate: options?.check_duplicate ?? true,
      replaceExisting: options?.replace_existing ?? false,
      duplicateCheckKey,
    };
  }

  private applyPanelSpecificConfig(baseDetail: TabDetail, panelType: PanelType, config: PanelConfig): TabDetail {
    switch (panelType) {
      case 'git-diff':
        return {
          ...baseDetail,
          data: {
            ...baseDetail.data,
            filePath: config.file_path,
            diffType: config.diff_type || 'staged',
          },
        };

      case 'mermaid-editor':
        return {
          ...baseDetail,
          title: config.title || i18nService.getT()('common:tabs.mermaidChart'),
          data: {
            mermaid_code: config.mermaid_code,
            sourceCode: config.mermaid_code || config.sourceCode,
            mode: config.mode || 'interactive',
            session_id: config.session_id,
            allow_mode_switch: config.allow_mode_switch !== false,
            editor_config: config.editor_config,
            interactive_config: config.interactive_config,
          },
        };

      case 'code-editor':
      case 'file-viewer':
      case 'markdown-editor':
      case 'plan-viewer':
        return {
          ...baseDetail,
          data: {
            ...baseDetail.data,
            filePath: config.file_path,
            workspacePath: config.workspace_path,
          },
        };

      default:
        return baseDetail;
    }
  }

  private getPanelTitle(panelType: PanelType, config: PanelConfig): string {
    const t = i18nService.getT();

    switch (panelType) {
      case 'git-settings':
        return t('common:tabs.gitSettings');
      case 'git-diff':
        return config.file_path ? `${t('common:tabs.gitDiff')}: ${config.file_path}` : t('common:tabs.gitDiff');
      case 'planner':
        return t('common:tabs.taskPlanner');
      case 'file-viewer':
        return t('common:tabs.fileBrowser');
      case 'code-editor':
        return config.file_path || t('common:tabs.editor');
      case 'markdown-editor':
        return config.file_path || t('common:tabs.markdown');
      case 'mermaid-editor':
        return config.title || t('common:tabs.mermaidChart');
      default:
        return panelType;
    }
  }

  private getDuplicateCheckKey(panelType: PanelType, config: PanelConfig): string {
    const timestampedKey = () => `${panelType}-${Date.now()}`;

    switch (panelType) {
      case 'git-diff':
        return config.file_path ? `git-diff-${config.file_path}` : 'git-diff';
      case 'code-editor':
      case 'markdown-editor':
        return config.file_path || timestampedKey();
      case 'mermaid-editor':
        return config.session_id ? `mermaid-${config.session_id}` : `mermaid-${Date.now()}`;
      case 'planner':
      case 'git-settings':
        return panelType;
      default:
        return timestampedKey();
    }
  }

  private async waitForPanelExpansion(): Promise<void> {
    return delay(PANEL_EXPAND_DELAY_MS);
  }

  private sendExecutionResult(requestId: string, success: boolean, message: string): void {
    import('@tauri-apps/api/core').then(({ invoke }) => {
      invoke('report_ide_control_result', {
        request_id: requestId,
        success,
        message: success ? message : undefined,
        error: success ? undefined : message,
        timestamp: Date.now(),
      }).catch((error) => {
        log.error('Failed to send execution result', error);
      });
    });
  }
}
