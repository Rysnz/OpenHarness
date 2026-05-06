import { ModelConfig } from '../types';
import { aiApi } from '@/infrastructure/api';
import { createLogger } from '@/shared/utils/logger';
import type { ConnectionTestMessageCode } from './aiConnectionTestMessages';

const log = createLogger('ConfigConverter');
const DEFAULT_CONTEXT_WINDOW = 128128;

export interface RustModelConfig {
  id: string;
  name: string;
  model_name: string;
  format: string;
  base_url: string;
  api_key?: string;
  context_window: number;
  max_tokens?: number;
}

export interface ConnectionTestResult {
  success: boolean;
  response_time_ms: number;
  model_response?: string;
  message_code?: ConnectionTestMessageCode;
  error_details?: string;
}

type ConfigValidationRule = {
  isInvalid: (config: ModelConfig, isNewConfig: boolean) => boolean;
  message: string;
};

const VALIDATION_RULES: ConfigValidationRule[] = [
  {
    isInvalid: (config, isNewConfig) => !isNewConfig && !config.id,
    message: 'Missing configuration ID',
  },
  { isInvalid: (config) => !config.name, message: 'Missing configuration name' },
  { isInvalid: (config) => !config.modelName, message: 'Missing model name' },
  { isInvalid: (config) => !config.format, message: 'Missing API format' },
  { isInvalid: (config) => !config.baseUrl, message: 'Missing API base URL' },
];

export function convertToRustConfig(config: ModelConfig): RustModelConfig {
  return {
    id: config.id,
    name: config.name,
    model_name: config.modelName,
    format: config.format,
    base_url: config.baseUrl,
    api_key: config.apiKey,
    context_window: config.contextWindow || DEFAULT_CONTEXT_WINDOW,
    max_tokens: config.maxTokens,
  };
}

export function validateModelConfig(config: ModelConfig, isNewConfig = false): string[] {
  return VALIDATION_RULES
    .filter((rule) => rule.isInvalid(config, isNewConfig))
    .map((rule) => rule.message);
}

export async function invokeAICommand<T>(
  command: string,
  config: ModelConfig,
  additionalArgs?: Record<string, any>,
): Promise<T> {
  try {
    assertValidConfig(config);
    return await aiApi.invokeAICommand<T>(command, convertToRustConfig(config), additionalArgs);
  } catch (error) {
    log.error('AI command invocation failed', { command, error });
    throw normalizeBackendError(command, error);
  }
}

export async function invokeAIChat(config: ModelConfig, messages: any[]): Promise<any> {
  return invokeAICommand('ai_chat', config, { messages });
}

export async function testAIConnection(config: ModelConfig): Promise<ConnectionTestResult> {
  return invokeAICommand<ConnectionTestResult>('test_ai_connection', config);
}

export async function testAIConfigConnection(config: ModelConfig): Promise<ConnectionTestResult> {
  return invokeAICommand('test_ai_config_connection', config);
}

function assertValidConfig(config: ModelConfig): void {
  const configErrors = validateModelConfig(config, false);
  if (configErrors.length > 0) {
    throw new Error(`Configuration validation failed: ${configErrors.join(', ')}`);
  }
}

function normalizeBackendError(command: string, error: unknown): Error {
  if (!(error instanceof Error)) {
    return new Error(`Rust backend invocation failed: ${String(error)}`);
  }

  if (error.message.includes('Failed to fetch')) {
    return new Error(
      `Failed to connect to the Tauri backend. Make sure the app is running. Original error: ${error.message}`,
    );
  }

  if (error.message.includes('command not found')) {
    return new Error(`Rust backend command not found: ${command}. Please check the backend build.`);
  }

  return new Error(`Rust backend invocation failed: ${error.message}`);
}
