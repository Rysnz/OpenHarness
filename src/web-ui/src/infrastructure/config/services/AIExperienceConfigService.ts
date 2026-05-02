import { configManager } from './ConfigManager';
import { createLogger } from '@/shared/utils/logger';

const log = createLogger('AIExperienceConfig');
const CONFIG_PATH = 'app.ai_experience';

export interface AIExperienceSettings {
  enable_session_title_generation: boolean;
  enable_visual_mode: boolean;
  enable_agent_companion: boolean;
}

const defaultSettings: AIExperienceSettings = {
  enable_session_title_generation: true,
  enable_visual_mode: false,
  enable_agent_companion: false,
};

type SettingsListener = (settings: AIExperienceSettings) => void;

function mergeSettings(settings?: Partial<AIExperienceSettings> | null): AIExperienceSettings {
  return { ...defaultSettings, ...settings };
}

export class AIExperienceConfigService {
  private static instance: AIExperienceConfigService;

  private cachedSettings: AIExperienceSettings | null = null;
  private readonly listeners = new Set<SettingsListener>();
  private unwatchConfig: (() => void) | null = null;

  private constructor() {
    void Promise.resolve().then(() => this.bindConfigWatcher());
  }

  static getInstance(): AIExperienceConfigService {
    AIExperienceConfigService.instance ??= new AIExperienceConfigService();
    return AIExperienceConfigService.instance;
  }

  private bindConfigWatcher(): void {
    this.unwatchConfig = configManager.watch(CONFIG_PATH, () => {
      void this.reload();
    });
    void this.loadSettings();
  }

  private async loadSettings(): Promise<void> {
    try {
      const settings = await configManager.getConfig<AIExperienceSettings>(CONFIG_PATH);
      this.cachedSettings = mergeSettings(settings);
    } catch (error) {
      log.warn('Failed to load config, using defaults', error);
      this.cachedSettings = mergeSettings();
    }
  }

  getSettings(): AIExperienceSettings {
    return mergeSettings(this.cachedSettings);
  }

  async getSettingsAsync(): Promise<AIExperienceSettings> {
    try {
      const settings = await configManager.getConfig<AIExperienceSettings>(CONFIG_PATH);
      this.cachedSettings = mergeSettings(settings);
      return this.getSettings();
    } catch (error) {
      log.error('Failed to get config', error);
      return this.getSettings();
    }
  }

  async saveSettings(settings: AIExperienceSettings): Promise<void> {
    try {
      await configManager.setConfig(CONFIG_PATH, settings);
      this.cachedSettings = mergeSettings(settings);
      this.notifyListeners();
    } catch (error) {
      log.error('Failed to save config', error);
      throw error;
    }
  }

  isSessionTitleGenerationEnabled(): boolean {
    return this.getSettings().enable_session_title_generation;
  }

  addChangeListener(listener: SettingsListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    const currentSettings = this.getSettings();
    this.listeners.forEach(listener => {
      try {
        listener(currentSettings);
      } catch (error) {
        log.error('Listener execution failed', error);
      }
    });
  }

  async reload(): Promise<void> {
    await this.loadSettings();
    this.notifyListeners();
  }

  dispose(): void {
    this.unwatchConfig?.();
    this.unwatchConfig = null;
    this.listeners.clear();
  }
}

export const aiExperienceConfigService = AIExperienceConfigService.getInstance();
