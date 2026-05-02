/**
 * Backend tool for interactive Mermaid panels.
 */

import {
  HighlightState,
  MermaidInteractiveToolInput,
  MermaidInteractiveToolOutput,
  MermaidPanelData,
  NodeMetadata,
} from '../types/MermaidPanelTypes';

type RenderPayload = NonNullable<MermaidInteractiveToolInput['render_data']>;
type HighlightPayload = NonNullable<MermaidInteractiveToolInput['update_data']>;
type SwitchPayload = NonNullable<MermaidInteractiveToolInput['switch_data']>;

const panelIdForSession = (sessionId: string): string => `mermaid-interactive-${sessionId}`;

export class MermaidInteractiveTool {
  private static instance: MermaidInteractiveTool;
  private readonly panels = new Map<string, MermaidPanelData>();

  static getInstance(): MermaidInteractiveTool {
    if (!MermaidInteractiveTool.instance) {
      MermaidInteractiveTool.instance = new MermaidInteractiveTool();
    }
    return MermaidInteractiveTool.instance;
  }

  async handle(input: MermaidInteractiveToolInput): Promise<MermaidInteractiveToolOutput> {
    try {
      switch (input.action) {
        case 'render':
          return await this.handleRender(this.requirePayload(input.render_data, 'render_data'));
        case 'update_highlights':
          return await this.handleUpdateHighlights(this.requirePayload(input.update_data, 'update_data'));
        case 'switch_mode':
          return await this.handleSwitchMode(this.requirePayload(input.switch_data, 'switch_data'));
        default:
          throw new Error(`Unknown action: ${input.action}`);
      }
    } catch (error) {
      return {
        success: false,
        panel_id: '',
        action: input.action,
        message: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  private async handleRender(data: RenderPayload): Promise<MermaidInteractiveToolOutput> {
    const panelId = panelIdForSession(data.session_id);
    const panelData = this.createPanelData(data);

    this.panels.set(panelId, panelData);
    await this.triggerPanelCreation(panelData, data.options.position);

    return {
      success: true,
      panel_id: panelId,
      action: 'render',
      message: 'Interactive Mermaid diagram opened',
      panel_info: {
        position: data.options.position,
        mode: 'interactive',
        node_count: Object.keys(data.node_metadata).length,
      },
    };
  }

  private async handleUpdateHighlights(data: HighlightPayload): Promise<MermaidInteractiveToolOutput> {
    const panelId = panelIdForSession(data.session_id);
    const panelData = this.getRequiredPanel(panelId);

    this.applyHighlightUpdate(panelData, data.highlights, data.update_metadata);
    await this.triggerPanelUpdate(panelId, {
      highlights: data.highlights,
      update_metadata: data.update_metadata,
    });

    return {
      success: true,
      panel_id: panelId,
      action: 'update_highlights',
      message: 'Highlights updated successfully',
    };
  }

  private async handleSwitchMode(data: SwitchPayload): Promise<MermaidInteractiveToolOutput> {
    const panelId = panelIdForSession(data.session_id);
    const panelData = this.getRequiredPanel(panelId);

    if (data.target_mode === 'interactive' && !panelData.interactive_config?.node_metadata) {
      throw new Error('Interactive mode requires node metadata');
    }

    panelData.mode = data.target_mode;
    await this.triggerModeSwitch(panelId, data.target_mode);

    return {
      success: true,
      panel_id: panelId,
      action: 'switch_mode',
      message: `Mode switched to ${data.target_mode}`,
    };
  }

  private createPanelData(data: RenderPayload): MermaidPanelData {
    return {
      mermaid_code: data.mermaid_code,
      title: data.title,
      session_id: data.session_id,
      mode: 'interactive',
      allow_mode_switch: data.options.allow_mode_switch,
      interactive_config: {
        node_metadata: data.node_metadata,
        highlights: data.highlights,
        enable_navigation: data.options.enable_navigation,
        enable_tooltips: true,
      },
    };
  }

  private getRequiredPanel(panelId: string): MermaidPanelData {
    const panelData = this.panels.get(panelId);
    if (!panelData) {
      throw new Error(`Panel not found: ${panelId}`);
    }
    return panelData;
  }

  private applyHighlightUpdate(
    panelData: MermaidPanelData,
    highlights: HighlightState,
    updateMetadata?: Record<string, Partial<NodeMetadata>>
  ): void {
    const config = panelData.interactive_config;
    if (!config) {
      return;
    }

    config.highlights = highlights;
    Object.entries(updateMetadata ?? {}).forEach(([nodeId, metadata]) => {
      if (config.node_metadata[nodeId]) {
        Object.assign(config.node_metadata[nodeId], metadata);
      }
    });
  }

  private requirePayload<T>(payload: T | undefined, name: string): T {
    if (!payload) {
      throw new Error(`Missing payload: ${name}`);
    }
    return payload;
  }

  private async triggerPanelCreation(panelData: MermaidPanelData, position: string): Promise<void> {
    this.dispatch('agent-create-tab', {
      type: 'mermaid-panel',
      title: panelData.title,
      data: panelData,
      position,
    });
  }

  private async triggerPanelUpdate(panelId: string, updateData: any): Promise<void> {
    this.dispatch('mermaid-panel-update', {
      panel_id: panelId,
      update_data: updateData,
    });
  }

  private async triggerModeSwitch(panelId: string, targetMode: string): Promise<void> {
    this.dispatch('mermaid-panel-mode-switch', {
      panel_id: panelId,
      target_mode: targetMode,
    });
  }

  private dispatch(eventName: string, detail: Record<string, unknown>): void {
    window.dispatchEvent(new CustomEvent(eventName, {
      detail: {
        ...detail,
      },
    }));
  }

  getPanelData(panelId: string): MermaidPanelData | undefined {
    return this.panels.get(panelId);
  }

  getAllPanels(): Map<string, MermaidPanelData> {
    return new Map(this.panels);
  }

  removePanel(panelId: string): boolean {
    return this.panels.delete(panelId);
  }

  clearAllPanels(): void {
    this.panels.clear();
  }
}

export const mermaidInteractiveTool = MermaidInteractiveTool.getInstance();
