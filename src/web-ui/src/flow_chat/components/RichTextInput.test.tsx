import React, { act, createRef, forwardRef, useImperativeHandle, useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import RichTextInput from './RichTextInput';
import type { ContextItem } from '../../shared/types/context';

type HarnessHandle = {
  setValue: (value: string) => void;
};

const emptyContexts: ContextItem[] = [];

let JSDOMCtor: (new (
  html?: string,
  options?: { pretendToBeVisual?: boolean }
) => { window: Window & typeof globalThis }) | null = null;

try {
  const jsdom = await import('jsdom');
  JSDOMCtor = jsdom.JSDOM as typeof JSDOMCtor;
} catch {
  JSDOMCtor = null;
}

const ControlledHarness = forwardRef<HarnessHandle>(function ControlledHarness(_, ref) {
  const [value, setValue] = useState('hello');

  useImperativeHandle(ref, () => ({
    setValue,
  }), []);

  return (
    <RichTextInput
      value={value}
      onChange={(nextValue) => setValue(nextValue)}
      contexts={emptyContexts}
      onRemoveContext={() => {}}
    />
  );
});

const describeWithJsdom = JSDOMCtor ? describe : describe.skip;

const WINDOW_GLOBALS = [
  'document',
  'navigator',
  'Node',
  'Text',
  'Element',
  'HTMLElement',
  'HTMLDivElement',
  'HTMLSpanElement',
  'DocumentFragment',
  'Range',
  'Selection',
  'NodeFilter',
  'Event',
  'InputEvent',
] as const;

function installDomGlobals(window: Window & typeof globalThis) {
  vi.stubGlobal('window', window);
  for (const key of WINDOW_GLOBALS) {
    vi.stubGlobal(key, window[key]);
  }
  vi.stubGlobal('getSelection', window.getSelection.bind(window));
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
}

function installAnimationFrameStubs(window: Window & typeof globalThis) {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
  window.requestAnimationFrame = globalThis.requestAnimationFrame;
  window.cancelAnimationFrame = globalThis.cancelAnimationFrame;
}

describeWithJsdom('RichTextInput external sync', () => {
  let dom: { window: Window & typeof globalThis };
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    dom = new JSDOMCtor!('<!doctype html><html><body></body></html>', {
      pretendToBeVisual: true,
    });

    const { window } = dom;
    installDomGlobals(window);
    installAnimationFrameStubs(window);

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    dom.window.close();
    vi.unstubAllGlobals();
  });

  async function renderHarness(ref: React.RefObject<HarnessHandle>) {
    await act(async () => {
      root.render(<ControlledHarness ref={ref} />);
    });

    const editor = container.querySelector('.rich-text-input');
    expect(editor).toBeInstanceOf(HTMLDivElement);
    return editor as HTMLDivElement;
  }

  it('keeps the existing DOM node when parent echoes local input', async () => {
    const harnessRef = createRef<HarnessHandle>();
    const editor = await renderHarness(harnessRef);

    expect(editor.textContent).toBe('hello');
    const originalTextNode = editor.firstChild;
    expect(originalTextNode).toBeInstanceOf(Text);

    await act(async () => {
      (originalTextNode as Text).textContent = 'hello!';
      editor.dispatchEvent(new window.Event('input', { bubbles: true }));
    });

    expect(editor.textContent).toBe('hello!');
    expect(editor.firstChild).toBe(originalTextNode);
  });

  it('replaces the DOM node when value changes externally', async () => {
    const harnessRef = createRef<HarnessHandle>();
    const editor = await renderHarness(harnessRef);

    const originalTextNode = editor.firstChild;
    expect(originalTextNode).toBeInstanceOf(Text);

    await act(async () => {
      harnessRef.current?.setValue('server rewrite');
    });

    expect(editor.textContent).toBe('server rewrite');
    expect(editor.firstChild).not.toBe(originalTextNode);
  });
});
