export type BootDiagnostics = {
  stages: string[];
  lastStage: string | null;
  errors: Array<{ stage: string; message: string }>;
};

const BOOT_DIAGNOSTICS_KEY = '__OPENHARNESS_BOOT_DIAGNOSTICS__';

export function getBootDiagnostics(): BootDiagnostics {
  const windowWithDiagnostics = window as typeof window & {
    [BOOT_DIAGNOSTICS_KEY]?: BootDiagnostics;
  };

  if (!windowWithDiagnostics[BOOT_DIAGNOSTICS_KEY]) {
    windowWithDiagnostics[BOOT_DIAGNOSTICS_KEY] = {
      stages: [],
      lastStage: null,
      errors: [],
    };
  }

  return windowWithDiagnostics[BOOT_DIAGNOSTICS_KEY]!;
}

export function markBootStage(stage: string): void {
  const diagnostics = getBootDiagnostics();
  diagnostics.lastStage = stage;
  diagnostics.stages.push(stage);
}

export function recordBootError(stage: string, error: unknown): void {
  const diagnostics = getBootDiagnostics();
  diagnostics.lastStage = `${stage}:error`;
  diagnostics.errors.push({
    stage,
    message: error instanceof Error ? error.message : String(error),
  });
}
