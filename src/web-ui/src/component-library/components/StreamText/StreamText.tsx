/**
 * Streaming text output component
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import './StreamText.scss';

export type StreamEffect = 
  | 'smooth'
  | 'typewriter'
  | 'wave'
  | 'fade'
  | 'glitch'
  | 'neon'
  | 'matrix'
  | 'gradient'
  | 'pulse'
  | 'blur'
  | 'bounce'
  | 'shimmer';

export interface StreamTextProps {
  text: string;
  effect?: StreamEffect;
  speed?: number;
  delay?: number;
  showCursor?: boolean;
  cursorStyle?: 'block' | 'line' | 'underline' | 'glow' | 'rainbow';
  onComplete?: () => void;
  onProgress?: (progress: number) => void;
  className?: string;
  autoStart?: boolean;
  paused?: boolean;
  charAnimation?: boolean;
  colorTheme?: 'blue' | 'purple' | 'green' | 'rainbow' | 'fire' | 'ocean' | 'sunset';
}

function nextCharacterDelay(effect: StreamEffect, speed: number, index: number): number {
  if (effect === 'glitch' && Math.random() > 0.7) {
    return speed * (Math.random() * 2 + 0.5);
  }

  if (effect === 'wave') {
    return speed + Math.sin(index * 0.5) * 20;
  }

  return speed;
}

function clearTimer(timerRef: React.MutableRefObject<NodeJS.Timeout | null>): void {
  if (timerRef.current) {
    clearTimeout(timerRef.current);
    timerRef.current = null;
  }
}

function containerClassName(
  effect: StreamEffect,
  colorTheme: NonNullable<StreamTextProps['colorTheme']>,
  isStreaming: boolean,
  isComplete: boolean,
  className: string
): string {
  return [
    'stream-text',
    `stream-text--${effect}`,
    `stream-text--theme-${colorTheme}`,
    isStreaming && 'stream-text--streaming',
    isComplete && 'stream-text--complete',
    className,
  ].filter(Boolean).join(' ');
}

function renderAnimatedCharacters(
  displayedText: string,
  effect: StreamEffect,
  isStreaming: boolean
): React.ReactNode {
  return displayedText.split('').map((char, index) => {
    const isNewChar = index === displayedText.length - 1 && isStreaming;

    return (
      <span
        key={`char-${index}`}
        className={`stream-text__char stream-text__char--${effect} ${isNewChar ? 'stream-text__char--new' : ''}`}
        style={{
          animationDelay: `${index * 0.05}s`,
          '--char-index': index,
        } as React.CSSProperties}
      >
        {char}
      </span>
    );
  });
}

const StreamTextComponent: React.FC<StreamTextProps> = ({
  text,
  effect = 'smooth',
  speed = 30,
  delay = 0,
  showCursor = true,
  cursorStyle = 'line',
  onComplete,
  onProgress,
  className = '',
  autoStart = true,
  paused = false,
  charAnimation = false,
  colorTheme = 'blue',
}) => {
  const [displayedText, setDisplayedText] = useState('');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pausedIndexRef = useRef<number>(0);
  const hasStartedRef = useRef(false);
  const prevTextRef = useRef(text);

  const streamCharacter = useCallback((index: number) => {
    if (index < text.length) {
      setDisplayedText(prev => prev + text[index]);
      setCurrentIndex(index + 1);
      
      const progress = ((index + 1) / text.length) * 100;
      onProgress?.(progress);

      const nextSpeed = nextCharacterDelay(effect, speed, index);

      timeoutRef.current = setTimeout(() => {
        streamCharacter(index + 1);
      }, Math.max(10, nextSpeed));
    } else {
      setIsComplete(true);
      setIsStreaming(false);
      onComplete?.();
    }
  }, [effect, onComplete, onProgress, speed, text]);

  const startStreaming = useCallback(() => {
    setDisplayedText('');
    setCurrentIndex(0);
    setIsComplete(false);
    setIsStreaming(true);

    timeoutRef.current = setTimeout(() => {
      streamCharacter(0);
    }, delay);
  }, [delay, streamCharacter]);

  useEffect(() => {
    const isTextChanged = prevTextRef.current !== text;
    let skipAutoStart = false;
    if (isTextChanged) {
      prevTextRef.current = text;
      pausedIndexRef.current = 0;
      clearTimer(timeoutRef);

      if (isComplete) {
        setDisplayedText(text);
        setCurrentIndex(text.length);
        setIsComplete(true);
        setIsStreaming(false);
        hasStartedRef.current = true;
        skipAutoStart = true;
      } else {
        hasStartedRef.current = false;
        setDisplayedText('');
        setCurrentIndex(0);
        setIsComplete(false);
        setIsStreaming(false);
      }
    }

    if (autoStart && !paused && !hasStartedRef.current && !skipAutoStart) {
      hasStartedRef.current = true;
      startStreaming();
    }

    return () => clearTimer(timeoutRef);
  }, [text, autoStart, paused, isComplete, startStreaming]);

  useEffect(() => {
    if (paused && isStreaming) {
      pausedIndexRef.current = currentIndex;
      clearTimer(timeoutRef);
      setIsStreaming(false);
    } else if (!paused && pausedIndexRef.current > 0) {
      streamCharacter(pausedIndexRef.current);
    }
  }, [paused, currentIndex, isStreaming, streamCharacter]);

  const renderText = () => {
    if (!charAnimation) {
      return <span className={`stream-text__content stream-text__content--${effect}`}>{displayedText}</span>;
    }

    return renderAnimatedCharacters(displayedText, effect, isStreaming);
  };

  return (
    <span className={containerClassName(effect, colorTheme, isStreaming, isComplete, className)}>
      {renderText()}
      {showCursor && !isComplete && (
        <span className={`stream-cursor stream-cursor--${cursorStyle} ${isStreaming ? 'stream-cursor--active' : ''}`} />
      )}
    </span>
  );
};

export const StreamText = React.memo(StreamTextComponent, (prevProps, nextProps) => {
  return (
    prevProps.text === nextProps.text &&
    prevProps.effect === nextProps.effect &&
    prevProps.speed === nextProps.speed &&
    prevProps.showCursor === nextProps.showCursor &&
    prevProps.className === nextProps.className
  );
});
