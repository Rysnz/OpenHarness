import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { IdeControlEvent, IdeController, IdeControlOperation } from './types';
import { PanelController } from './PanelController';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('IdeControlEventBus');
const IDE_CONTROL_EVENT = 'ide-control-event';
const PANEL_CONTROLLER_KEY = 'panel';
const PANEL_OPERATIONS: IdeControlOperation[] = ['open_panel', 'close_panel', 'toggle_panel'];

export class IdeControlEventBus {
  private static instance: IdeControlEventBus;

  private readonly controllers = new Map<string, IdeController>();
  private initialized = false;
  private unlistenFn?: UnlistenFn;

  private constructor() {}

  public static getInstance(): IdeControlEventBus {
    IdeControlEventBus.instance ??= new IdeControlEventBus();
    return IdeControlEventBus.instance;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    this.registerPanelController();

    try {
      this.unlistenFn = await listen<IdeControlEvent>(IDE_CONTROL_EVENT, event => {
        void this.handleEvent(event);
      });
      this.initialized = true;
      log.info('Initialized successfully');
    } catch (error) {
      log.error('Failed to initialize', error);
      throw error;
    }
  }

  registerController(operation: string, controller: IdeController): void {
    this.controllers.set(operation, controller);
  }

  private registerPanelController(): void {
    const panelController = new PanelController();
    this.registerController(PANEL_CONTROLLER_KEY, panelController);
    PANEL_OPERATIONS.forEach(operation => this.registerController(operation, panelController));
  }

  private async handleEvent(event: { payload: IdeControlEvent }): Promise<void> {
    const { operation, target, options, metadata } = event.payload;

    try {
      const controller = this.getController(operation);
      if (!controller) {
        log.warn('No controller found for operation', { operation });
        return;
      }

      await controller.execute(target, options, metadata);
    } catch (error) {
      log.error('Error handling event', error);

      if (metadata?.request_id) {
        await this.sendErrorResult(metadata.request_id, error);
      }
    }
  }

  private getController(operation: IdeControlOperation): IdeController | undefined {
    return this.controllers.get(operation) ?? this.controllers.get(this.fallbackOperation(operation));
  }

  private fallbackOperation(operation: IdeControlOperation): string {
    return PANEL_OPERATIONS.includes(operation) ? PANEL_CONTROLLER_KEY : operation;
  }

  private async sendErrorResult(requestId: string, error: unknown): Promise<void> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('report_ide_control_result', {
        request_id: requestId,
        success: false,
        message: undefined,
        error: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      });
    } catch (invokeError) {
      log.error('Failed to send error result', invokeError);
    }
  }

  async destroy(): Promise<void> {
    this.unlistenFn?.();
    this.unlistenFn = undefined;
    this.controllers.clear();
    this.initialized = false;
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}

export function getIdeControlEventBus(): IdeControlEventBus {
  return IdeControlEventBus.getInstance();
}

export async function initializeIdeControl(): Promise<void> {
  await getIdeControlEventBus().initialize();
}
