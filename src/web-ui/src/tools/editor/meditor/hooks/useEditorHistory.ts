import { useState, useCallback, useRef, useEffect } from 'react'

/**
 * History entry
 */
interface HistoryEntry {
  content: string
  selectionStart: number | null
  selectionEnd: number | null
  transactionType: 'typing' | 'format' | 'structure' | 'external'
  timestamp: number
  versionId: number
}

export interface HistorySelection {
  start: number
  end: number
}

export interface PushChangeOptions {
  selectionStart?: number | null
  selectionEnd?: number | null
  transactionType?: HistoryEntry['transactionType']
}

/**
 * useEditorHistory options
 */
export interface UseEditorHistoryOptions {
  /** Initial content */
  initialContent: string
  /** Max history size (default: 100) */
  maxHistorySize?: number
  /** Content change callback */
  onChange?: (content: string) => void
  /** Dirty state change callback */
  onDirtyChange?: (isDirty: boolean) => void
  /** Debounce interval (ms). Edits within interval are merged into one history entry. */
  debounceMs?: number
}

/**
 * useEditorHistory return type
 */
export interface UseEditorHistoryReturn {
  /** Current content */
  content: string
  /** Current selection for the active editing surface */
  selection: HistorySelection | null
  
  /** Current version id (similar to Monaco alternativeVersionId) */
  currentVersionId: number
  /** Saved version id */
  savedVersionId: number
  /** Whether there are unsaved changes */
  isDirty: boolean
  
  /** Push a new content change */
  pushChange: (newContent: string, options?: PushChangeOptions) => void
  /** Undo */
  undo: () => boolean
  /** Redo */
  redo: () => boolean
  /** Whether undo is available */
  canUndo: boolean
  /** Whether redo is available */
  canRedo: boolean
  
  /** Mark current state as saved */
  markSaved: () => void
  /** Reset to specific content (clears history) */
  resetTo: (content: string) => void
  /** Set initial content (doesn't clear history; used for external loads) */
  setInitialContent: (content: string) => void
}

function createHistoryEntry(
  content: string,
  versionId: number,
  options?: PushChangeOptions
): HistoryEntry {
  return {
    content,
    selectionStart: options?.selectionStart ?? null,
    selectionEnd: options?.selectionEnd ?? null,
    transactionType: options?.transactionType ?? 'external',
    timestamp: Date.now(),
    versionId
  }
}

function getSelection(entry?: HistoryEntry): HistorySelection | null {
  if (!entry || entry.selectionStart === null || entry.selectionEnd === null) {
    return null
  }

  return {
    start: entry.selectionStart,
    end: entry.selectionEnd
  }
}

function canMergeTyping(
  entry: HistoryEntry | undefined,
  transactionType: HistoryEntry['transactionType'],
  now: number,
  debounceMs: number
): boolean {
  return Boolean(
    entry &&
    now - entry.timestamp < debounceMs &&
    transactionType === 'typing' &&
    entry.transactionType === 'typing'
  )
}

function capHistory(stack: HistoryEntry[], maxHistorySize: number): HistoryEntry[] {
  return stack.length > maxHistorySize ? stack.slice(stack.length - maxHistorySize) : stack
}

/**
 * Editor history hook.
 *
 * Version-based history tracking:
 * - currentVersionId: changes on edit/undo/redo
 * - savedVersionId: version at last save
 * - isDirty: currentVersionId !== savedVersionId
 *
 * When user undoes back to the save point, isDirty becomes false automatically.
 */
export function useEditorHistory(options: UseEditorHistoryOptions): UseEditorHistoryReturn {
  const {
    initialContent,
    maxHistorySize = 100,
    onChange,
    onDirtyChange,
    debounceMs = 300
  } = options

  const versionIdRef = useRef(1)
  
  const [historyStack, setHistoryStack] = useState<HistoryEntry[]>(() => [
    createHistoryEntry(initialContent, 1)
  ])
  
  const [currentIndex, setCurrentIndex] = useState(0)
  
  const [savedVersionId, setSavedVersionId] = useState(1)
  
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  
  const lastIsDirtyRef = useRef(false)

  const currentEntry = historyStack[currentIndex]
  const content = currentEntry?.content ?? initialContent
  const selection = getSelection(currentEntry)
  const currentVersionId = currentEntry?.versionId ?? 1
  const isDirty = currentVersionId !== savedVersionId
  
  const canUndo = currentIndex > 0
  const canRedo = currentIndex < historyStack.length - 1

  useEffect(() => {
    if (lastIsDirtyRef.current !== isDirty) {
      lastIsDirtyRef.current = isDirty
      onDirtyChange?.(isDirty)
    }
  }, [isDirty, onDirtyChange])

  /** Push a new content change */
  const pushChange = useCallback((newContent: string, options?: PushChangeOptions) => {
    if (newContent === content) {
      return
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    const lastEntry = historyStack[currentIndex]
    const transactionType = options?.transactionType ?? 'typing'
    const now = Date.now()
    
    const shouldMerge =
      currentIndex === historyStack.length - 1 &&
      canMergeTyping(lastEntry, transactionType, now, debounceMs)

    if (shouldMerge) {
      setHistoryStack(prev => {
        const newStack = [...prev]
        newStack[currentIndex] = {
          ...newStack[currentIndex],
          content: newContent,
          selectionStart: options?.selectionStart ?? null,
          selectionEnd: options?.selectionEnd ?? null,
          timestamp: now
        }
        return newStack
      })
    } else {
      versionIdRef.current += 1
      const newVersionId = versionIdRef.current
      
      const newEntry = createHistoryEntry(newContent, newVersionId, {
        ...options,
        transactionType
      })

      setHistoryStack(prev => {
        const newStack = prev.slice(0, currentIndex + 1)
        newStack.push(newEntry)
        return capHistory(newStack, maxHistorySize)
      })
      
      setCurrentIndex(prev => {
        const newIndex = Math.min(prev + 1, maxHistorySize - 1)
        return newIndex
      })
    }

    onChange?.(newContent)
  }, [content, historyStack, currentIndex, debounceMs, maxHistorySize, onChange])

  /** Undo */
  const undo = useCallback((): boolean => {
    if (!canUndo) {
      return false
    }

    const newIndex = currentIndex - 1
    setCurrentIndex(newIndex)
    
    const prevEntry = historyStack[newIndex]
    if (prevEntry) {
      onChange?.(prevEntry.content)
    }
    
    return true
  }, [canUndo, currentIndex, historyStack, onChange])

  /** Redo */
  const redo = useCallback((): boolean => {
    if (!canRedo) {
      return false
    }

    const newIndex = currentIndex + 1
    setCurrentIndex(newIndex)
    
    const nextEntry = historyStack[newIndex]
    if (nextEntry) {
      onChange?.(nextEntry.content)
    }
    
    return true
  }, [canRedo, currentIndex, historyStack, onChange])

  /** Mark current state as saved */
  const markSaved = useCallback(() => {
    setSavedVersionId(currentVersionId)
  }, [currentVersionId])

  /** Reset to specific content (clears history) */
  const resetTo = useCallback((newContent: string) => {
    versionIdRef.current = 1
    const newEntry = createHistoryEntry(newContent, 1)
    
    setHistoryStack([newEntry])
    setCurrentIndex(0)
    setSavedVersionId(1)
    
    onChange?.(newContent)
  }, [onChange])

  /** Set initial content (external load; resets save point) */
  const setInitialContent = useCallback((newContent: string) => {
    versionIdRef.current += 1
    const newVersionId = versionIdRef.current
    const newEntry = createHistoryEntry(newContent, newVersionId)
    
    setHistoryStack([newEntry])
    setCurrentIndex(0)
    setSavedVersionId(newVersionId)
    
    onChange?.(newContent)
  }, [onChange])

  return {
    content,
    selection,
    currentVersionId,
    savedVersionId,
    isDirty,
    pushChange,
    undo,
    redo,
    canUndo,
    canRedo,
    markSaved,
    resetTo,
    setInitialContent
  }
}

export default useEditorHistory
