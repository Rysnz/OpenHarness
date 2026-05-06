import React from 'react';
import { useTranslation } from 'react-i18next';
import {
  CHAT_INPUT_DROP_ZONE_BOTTOM_PX,
  SCROLL_TO_LATEST_INPUT_CLEARANCE_PX,
} from '../utils/flowChatScrollLayout';
import './ScrollToLatestBar.scss';

interface ScrollToLatestBarProps {
  visible: boolean;
  onClick: () => void;
  isInputExpanded?: boolean;
  isInputActive?: boolean;
  inputHeight?: number;
  className?: string;
}

const GRADIENT_CLEARANCE_PX = 24;

const DownArrowIcon: React.FC = () => (
  <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path
      d="M8 3.5V12.5M8 12.5L4 8.5M8 12.5L12 8.5"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

function inputStateClass(isInputActive: boolean, isInputExpanded: boolean): string {
  if (!isInputActive) {
    return 'scroll-to-latest-bar--input-collapsed';
  }

  return isInputExpanded ? 'scroll-to-latest-bar--input-expanded' : '';
}

function layoutForInputHeight(inputHeight: number): {
  dynamicStyle: React.CSSProperties;
  contentStyle?: React.CSSProperties;
} {
  if (inputHeight <= 0) {
    return { dynamicStyle: {} };
  }

  const contentBottom =
    inputHeight + CHAT_INPUT_DROP_ZONE_BOTTOM_PX + SCROLL_TO_LATEST_INPUT_CLEARANCE_PX;

  return {
    dynamicStyle: { height: `${contentBottom + GRADIENT_CLEARANCE_PX}px` },
    contentStyle: { bottom: `${contentBottom}px` }
  };
}

export const ScrollToLatestBar: React.FC<ScrollToLatestBarProps> = ({
  visible,
  onClick,
  isInputExpanded = false,
  isInputActive = true,
  inputHeight = 0,
  className = ''
}) => {
  const { t } = useTranslation('flow-chat');

  if (!visible) {
    return null;
  }

  const { dynamicStyle, contentStyle } = layoutForInputHeight(inputHeight);
  const classes = [
    'scroll-to-latest-bar',
    inputStateClass(isInputActive, isInputExpanded),
    className
  ].filter(Boolean).join(' ');

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onClick();
    }
  };

  return (
    <div
      className={classes}
      style={dynamicStyle}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      aria-label={t('scroll.toLatest')}
    >
      <div className="scroll-to-latest-bar__gradient" />
      <div className="scroll-to-latest-bar__content" style={contentStyle}>
        <button className="scroll-to-latest-bar__btn" aria-hidden="true" tabIndex={-1}>
          <DownArrowIcon />
        </button>
      </div>
    </div>
  );
};

ScrollToLatestBar.displayName = 'ScrollToLatestBar';
