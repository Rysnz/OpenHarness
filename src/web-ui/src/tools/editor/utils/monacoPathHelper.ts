import { createLogger } from '@/shared/utils/logger';

const log = createLogger('MonacoPathHelper');

type MonacoResourceCheck = {
  key: 'loaderAvailable' | 'cssAvailable' | 'workerAvailable';
  label: string;
  path: string;
};

const MONACO_DEV_PATH = '/node_modules/monaco-editor/min/vs';
const MONACO_PROD_PATH = './monaco-editor/vs';

export function getMonacoPath(): string {
  return import.meta.env.DEV ? MONACO_DEV_PATH : MONACO_PROD_PATH;
}

export function getMonacoWorkerPath(workerFile: string): string {
  return `${getMonacoPath()}/${workerFile}`;
}

export function getMonacoCssPath(): string {
  return getMonacoWorkerPath('editor/editor.main.css');
}

export async function checkMonacoResources(): Promise<{
  loaderAvailable: boolean;
  cssAvailable: boolean;
  workerAvailable: boolean;
  errors: string[];
}> {
  const errors: string[] = [];
  const results = {
    loaderAvailable: false,
    cssAvailable: false,
    workerAvailable: false,
    errors
  };

  const checks: MonacoResourceCheck[] = [
    { key: 'loaderAvailable', label: 'Loader', path: getMonacoWorkerPath('loader.js') },
    { key: 'cssAvailable', label: 'CSS', path: getMonacoCssPath() },
    { key: 'workerAvailable', label: 'Worker', path: getMonacoWorkerPath('base/worker/workerMain.js') }
  ];

  for (const check of checks) {
    try {
      const response = await fetch(check.path);
      results[check.key] = response.ok;
      if (!response.ok) {
        errors.push(`${check.label} not found: ${check.path} (${response.status})`);
      }
    } catch (error) {
      errors.push(`${check.label} fetch error: ${error}`);
    }
  }

  return results;
}

export async function logMonacoResourceCheck(): Promise<void> {
  const results = await checkMonacoResources();
  const metadata = {
    environment: import.meta.env.DEV ? 'Development' : 'Production',
    basePath: getMonacoPath()
  };

  if (results.errors.length > 0) {
    log.error('Monaco resource check failed', {
      ...metadata,
      errors: results.errors
    });
  } else {
    log.debug('Monaco resource check passed', {
      ...metadata,
      results
    });
  }
}

