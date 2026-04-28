import React, { useCallback, useEffect, useImperativeHandle, forwardRef, useMemo, useRef } from 'react'
import { createLogger } from '@/shared/utils/logger'
import { activeEditTargetService } from '@/tools/editor/services/ActiveEditTargetService'
import { useEditor } from '../hooks/useEditor'
import { EditArea } from './EditArea'
import { TiptapEditor, TiptapEditorHandle } from './TiptapEditor'
import { Preview } from './Preview'
import type { EditorMode, EditorOptions, EditorInstance } from '../types'
import { useI18n } from '@/infrastructure/i18n'
import { analyzeMarkdownEditability } from '../utils/tiptapMarkdown'
import './MEditor.scss'

void createLogger('MEditor')
let markdownTextareaTargetCounter = 0

export type MEditorProps = EditorOptions;
type TextareaAction = 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'

interface TextareaTargetBindingOptions {
  targetId: string
  containerRef: React.RefObject<HTMLDivElement>
  textareaRef: React.RefObject<HTMLTextAreaElement>
}

function executeTextareaAction(
  textarea: HTMLTextAreaElement | null,
  action: TextareaAction,
): boolean {
  if (!textarea || textarea.disabled) {
    return false
  }

  textarea.focus()

  if (textarea.readOnly && action !== 'copy' && action !== 'selectAll') {
    return false
  }

  if (action === 'selectAll') {
    textarea.select()
    return true
  }

  return document.execCommand(action)
}

function isTextareaMode(mode: EditorMode): boolean {
  return mode === 'edit' || mode === 'split'
}

function resolveEffectiveMode(
  mode: EditorMode,
  containsRenderOnlyBlocks: boolean,
  readonly: boolean,
): EditorMode {
  if (mode !== 'ir' || !containsRenderOnlyBlocks) {
    return mode
  }

  return readonly ? 'preview' : 'split'
}

function toCssSize(value: string | number): string | number {
  return typeof value === 'number' ? `${value}px` : value
}

function buildContainerStyle(
  style: React.CSSProperties,
  height: string | number,
  width: string | number,
): React.CSSProperties {
  return {
    ...style,
    height: toCssSize(height),
    width: toCssSize(width)
  }
}

function buildEditorClassName(theme: 'light' | 'dark', mode: EditorMode, className: string): string {
  const themeClass = theme === 'dark' ? 'm-editor-dark' : 'm-editor-light'
  return `m-editor ${themeClass} m-editor-mode-${mode} ${className}`
}

function isSaveShortcut(e: React.KeyboardEvent<HTMLDivElement>): boolean {
  return (e.ctrlKey || e.metaKey) && e.key === 's'
}

function bindTextareaEditTarget({
  targetId,
  containerRef,
  textareaRef
}: TextareaTargetBindingOptions) {
  return activeEditTargetService.bindTarget({
    id: targetId,
    kind: 'markdown-textarea',
    focus: () => {
      textareaRef.current?.focus()
    },
    hasTextFocus: () => {
      const textarea = textareaRef.current
      const activeElement = typeof document !== 'undefined' ? document.activeElement : null
      return !!textarea && activeElement === textarea
    },
    undo: () => executeTextareaAction(textareaRef.current, 'undo'),
    redo: () => executeTextareaAction(textareaRef.current, 'redo'),
    cut: () => executeTextareaAction(textareaRef.current, 'cut'),
    copy: () => executeTextareaAction(textareaRef.current, 'copy'),
    paste: () => executeTextareaAction(textareaRef.current, 'paste'),
    selectAll: () => executeTextareaAction(textareaRef.current, 'selectAll'),
    containsElement: (element) => {
      const root = containerRef.current
      return !!root && !!element && root.contains(element)
    }
  })
}

function clearTextareaTargetAfterBlur(
  targetId: string,
  containerRef: React.RefObject<HTMLDivElement>,
) {
  window.setTimeout(() => {
    const root = containerRef.current
    const activeElement = typeof document !== 'undefined' ? document.activeElement : null
    if (root && activeElement && root.contains(activeElement)) {
      return
    }

    activeEditTargetService.clearActiveTarget(targetId)
  }, 0)
}

export const MEditor = forwardRef<EditorInstance, MEditorProps>((props, ref) => {
  const {
    value: controlledValue,
    defaultValue = '',
    height = '500px',
    width = '100%',
    mode: initialMode = 'ir',
    theme: initialTheme = 'dark',
    toolbar = false,
    placeholder: placeholderProp,
    readonly = false,
    autofocus = false,
    onChange,
    onSave,
    onFocus,
    onBlur,
    onDirtyChange,
    className = '',
    style = {},
    filePath,
    basePath
  } = props

  const { t } = useI18n('tools')
  const placeholder = placeholderProp ?? t('editor.meditor.placeholder')
  const containerRef = useRef<HTMLDivElement>(null)
  const textareaTargetIdRef = useRef(`markdown-textarea-${++markdownTextareaTargetCounter}`)
  const initialEditorValue = controlledValue ?? defaultValue
  const savedValueRef = useRef(initialEditorValue)
  const currentValueRef = useRef(initialEditorValue)

  const {
    value,
    setValue,
    mode,
    setMode,
    theme,
    setTheme,
    textareaRef,
    editorInstance
  } = useEditor(controlledValue ?? defaultValue, onChange)

  const tiptapEditorRef = useRef<TiptapEditorHandle>(null)
  const editability = useMemo(() => analyzeMarkdownEditability(value), [value])
  const effectiveMode = resolveEffectiveMode(mode, editability.containsRenderOnlyBlocks, readonly)

  useEffect(() => {
    currentValueRef.current = value
  }, [value])

  useEffect(() => {
    if (!isTextareaMode(effectiveMode)) {
      return
    }

    return bindTextareaEditTarget({
      targetId: textareaTargetIdRef.current,
      containerRef,
      textareaRef
    })
  }, [effectiveMode, textareaRef])

  useEffect(() => {
    if (controlledValue !== undefined && controlledValue !== value) {
      currentValueRef.current = controlledValue
      editorInstance.setValue(controlledValue)
      onDirtyChange?.(controlledValue !== savedValueRef.current)
    }
  }, [controlledValue, editorInstance, onDirtyChange, value])

  useEffect(() => {
    if (initialMode) {
      setMode(initialMode)
    }
  }, [initialMode, setMode])

  useEffect(() => {
    if (initialTheme) {
      setTheme(initialTheme)
    }
  }, [initialTheme, setTheme])

  const handleEditorChange = useCallback((nextValue: string) => {
    currentValueRef.current = nextValue
    setValue(nextValue)
    onDirtyChange?.(nextValue !== savedValueRef.current)
  }, [onDirtyChange, setValue])

  useImperativeHandle(ref, () => ({
    ...editorInstance,
    scrollToLine: (line: number, highlight?: boolean) => {
      if (effectiveMode === 'ir' && tiptapEditorRef.current) {
        tiptapEditorRef.current.scrollToLine(line, highlight)
      }
    },
    undo: () => {
      if (effectiveMode === 'ir' && tiptapEditorRef.current) {
        return tiptapEditorRef.current.undo()
      }
      if (isTextareaMode(effectiveMode)) {
        return executeTextareaAction(textareaRef.current, 'undo')
      }
      return false
    },
    redo: () => {
      if (effectiveMode === 'ir' && tiptapEditorRef.current) {
        return tiptapEditorRef.current.redo()
      }
      if (isTextareaMode(effectiveMode)) {
        return executeTextareaAction(textareaRef.current, 'redo')
      }
      return false
    },
    get canUndo() {
      if (effectiveMode === 'ir' && tiptapEditorRef.current) {
        return tiptapEditorRef.current.canUndo
      }
      return false
    },
    get canRedo() {
      if (effectiveMode === 'ir' && tiptapEditorRef.current) {
        return tiptapEditorRef.current.canRedo
      }
      return false
    },
    markSaved: () => {
      if (effectiveMode === 'ir' && tiptapEditorRef.current) {
        tiptapEditorRef.current.markSaved()
      }
      savedValueRef.current = currentValueRef.current
      onDirtyChange?.(false)
    },
    setInitialContent: (content: string) => {
      if (effectiveMode === 'ir' && tiptapEditorRef.current) {
        tiptapEditorRef.current.setInitialContent(content)
        currentValueRef.current = content
        savedValueRef.current = content
        onDirtyChange?.(false)
        return
      }
      currentValueRef.current = content
      savedValueRef.current = content
      editorInstance.setValue(content)
      onDirtyChange?.(false)
    },
    get isDirty() {
      if (effectiveMode === 'ir' && tiptapEditorRef.current) {
        return tiptapEditorRef.current.isDirty
      }
      return currentValueRef.current !== savedValueRef.current
    }
  }), [editorInstance, effectiveMode, onDirtyChange, textareaRef])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (isSaveShortcut(e)) {
      e.preventDefault()
      e.stopPropagation()  // Prevent event bubbling; avoids other listeners handling it.
      onSave?.(value)
    }
  }, [value, onSave])

  const handleFocusCapture = useCallback(() => {
    if (!isTextareaMode(effectiveMode)) {
      return
    }

    activeEditTargetService.setActiveTarget(textareaTargetIdRef.current)
  }, [effectiveMode])

  const handleBlurCapture = useCallback(() => {
    if (!isTextareaMode(effectiveMode)) {
      return
    }

    clearTextareaTargetAfterBlur(textareaTargetIdRef.current, containerRef)
  }, [effectiveMode])

  const containerStyle = buildContainerStyle(style, height, width)
  const editorClassName = buildEditorClassName(theme, effectiveMode, className)

  return (
    <div
      ref={containerRef}
      className={editorClassName}
      style={containerStyle}
      onKeyDown={handleKeyDown}
      onFocusCapture={handleFocusCapture}
      onBlurCapture={handleBlurCapture}
      tabIndex={-1}
    >
      {toolbar && <div className="m-editor-toolbar">{t('editor.meditor.toolbarPlaceholder')}</div>}
      
      <div className="m-editor-content">
        {effectiveMode === 'preview' && (
          <Preview value={value} basePath={basePath} />
        )}

        {effectiveMode === 'edit' && (
          <div className="m-editor-edit-panel">
            <EditArea
              ref={textareaRef}
              value={value}
              onChange={handleEditorChange}
              onFocus={onFocus}
              onBlur={onBlur}
              placeholder={placeholder}
              readonly={readonly}
              autofocus={autofocus}
            />
          </div>
        )}

        {effectiveMode === 'split' && (
          <>
            <div className="m-editor-edit-panel">
              <EditArea
                ref={textareaRef}
                value={value}
                onChange={handleEditorChange}
                onFocus={onFocus}
                onBlur={onBlur}
                placeholder={placeholder}
                readonly={readonly}
                autofocus={autofocus}
              />
            </div>
            <div className="m-editor-preview-panel">
              <Preview value={value} basePath={basePath} />
            </div>
          </>
        )}

        {effectiveMode === 'ir' && (
          <div className="m-editor-ir-panel">
            <TiptapEditor
              ref={tiptapEditorRef}
              value={value}
              onChange={handleEditorChange}
              onFocus={onFocus}
              onBlur={onBlur}
              onDirtyChange={onDirtyChange}
              placeholder={placeholder}
              readonly={readonly}
              autofocus={autofocus}
              filePath={filePath}
              basePath={basePath}
            />
          </div>
        )}
      </div>
    </div>
  )
})

MEditor.displayName = 'MEditor'
