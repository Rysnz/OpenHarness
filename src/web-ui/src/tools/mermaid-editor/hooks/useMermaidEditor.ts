/**
 * Mermaid editor state hook.
 * Manages core state: source code, UI panels, and loading state.
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { MermaidEditorState } from '../types';
import { mermaidService } from '../services/MermaidService';

type MermaidStatePatch = Partial<MermaidEditorState>;

export interface UseMermaidEditorOptions {
  /** Initial source code. */
  initialSourceCode?: string;
  /** Enable auto validation. */
  autoValidate?: boolean;
  /** Debounce interval for auto validation (ms). */
  autoParseInterval?: number;
}

export interface UseMermaidEditorReturn {
  state: MermaidEditorState;
  actions: {
    setSourceCode: (sourceCode: string, immediate?: boolean) => void;
    setShowSourceEditor: (show: boolean) => void;
    setShowComponentLibrary: (show: boolean) => void;
    setLoading: (loading: boolean) => void;
    setError: (error: string | null) => void;
    reset: () => void;
    validateSourceCode: (sourceCode: string) => Promise<void>;
  };
  sourceCode: string;
  isDirty: boolean;
  isLoading: boolean;
  error: string | null;
  showSourceEditor: boolean;
  showComponentLibrary: boolean;
}

function createInitialEditorState(initialSourceCode?: string): MermaidEditorState {
  return {
    sourceCode: initialSourceCode || mermaidService.getDefaultTemplate(),
    isDirty: false,
    showSourceEditor: false,
    showComponentLibrary: false,
    isLoading: false,
    error: null,
  };
}

export function useMermaidEditor(options: UseMermaidEditorOptions = {}): UseMermaidEditorReturn {
  const {
    initialSourceCode,
    autoValidate = true,
    autoParseInterval = 300,
  } = options;

  const [state, setState] = useState<MermaidEditorState>(() => createInitialEditorState(initialSourceCode));

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialSourceCodeRef = useRef(initialSourceCode);

  const patchState = useCallback((patch: MermaidStatePatch) => {
    setState(prev => ({ ...prev, ...patch }));
  }, []);

  const clearPendingValidation = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    initialSourceCodeRef.current = initialSourceCode;
  }, [initialSourceCode]);

  const validateSourceCode = useCallback(async (sourceCode: string) => {
    try {
      patchState({ isLoading: true, error: null });
      const isValid = await mermaidService.validateSourceCode(sourceCode);

      patchState({
        isLoading: false,
        error: isValid ? null : 'Diagram syntax error',
      });
    } catch (error) {
      patchState({
        isLoading: false,
        error: error instanceof Error ? error.message : 'Validation failed',
      });
    }
  }, [patchState]);

  const debouncedValidate = useCallback((sourceCode: string) => {
    clearPendingValidation();

    debounceTimerRef.current = setTimeout(() => {
      validateSourceCode(sourceCode);
    }, autoParseInterval);
  }, [autoParseInterval, clearPendingValidation, validateSourceCode]);

  const setSourceCode = useCallback((sourceCode: string, immediate = false) => {
    const defaultTemplate = mermaidService.getDefaultTemplate();
    const baseCode = initialSourceCodeRef.current || defaultTemplate;

    patchState({
      sourceCode,
      isDirty: sourceCode !== baseCode,
    });

    if (autoValidate) {
      if (immediate) {
        validateSourceCode(sourceCode);
      } else {
        debouncedValidate(sourceCode);
      }
    }
  }, [autoValidate, debouncedValidate, patchState, validateSourceCode]);

  const setShowSourceEditor = useCallback((show: boolean) => {
    patchState({ showSourceEditor: show });
  }, [patchState]);

  const setShowComponentLibrary = useCallback((show: boolean) => {
    patchState({ showComponentLibrary: show });
  }, [patchState]);

  const setLoading = useCallback((loading: boolean) => {
    patchState({ isLoading: loading });
  }, [patchState]);

  const setError = useCallback((error: string | null) => {
    patchState({ error });
  }, [patchState]);

  const reset = useCallback(() => {
    const defaultTemplate = mermaidService.getDefaultTemplate();
    setState(createInitialEditorState(defaultTemplate));

    if (autoValidate) {
      debouncedValidate(defaultTemplate);
    }
  }, [autoValidate, debouncedValidate]);

  useEffect(() => {
    return () => {
      clearPendingValidation();
    };
  }, [clearPendingValidation]);

  const actions = useMemo(() => ({
    setSourceCode,
    setShowSourceEditor,
    setShowComponentLibrary,
    setLoading,
    setError,
    reset,
    validateSourceCode,
  }), [setSourceCode, setShowSourceEditor, setShowComponentLibrary, setLoading, setError, reset, validateSourceCode]);

  return {
    state,
    actions,
    sourceCode: state.sourceCode,
    isDirty: state.isDirty,
    isLoading: state.isLoading,
    error: state.error,
    showSourceEditor: state.showSourceEditor,
    showComponentLibrary: state.showComponentLibrary,
  };
}

// Legacy alias export for migration.
export { useMermaidEditor as useMermaidEditorSimple };
