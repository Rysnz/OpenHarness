import React, { useId } from 'react';
import './OpenHarnessLogo.scss';

export type LogoStatus = 'loading' | 'resolved';
export type OpenHarnessLogoVariant = 'default' | 'compact';

export interface OpenHarnessLogoProps {
  size?: number | string;
  className?: string;
  animated?: boolean;
  variant?: OpenHarnessLogoVariant;
  status?: LogoStatus;
}

export const OpenHarnessLogo: React.FC<OpenHarnessLogoProps> = ({
  size = 100,
  className = '',
  animated = true,
  variant = 'default',
  status = 'loading',
}) => {
  const idPrefix = `oh-logo-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const compact = variant === 'compact' || (typeof size === 'number' && size < 56);
  const containerClasses = [
    'openharness-logo',
    'oh-logo-container',
    `oh-status-${status}`,
    animated ? '' : 'oh-no-animation',
    compact ? 'oh-variant-compact' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <div
      className={containerClasses}
      style={{ width: size, height: size }}
      role="img"
      aria-label="OpenHarness"
    >
      <svg
        className="oh-logo-svg"
        viewBox="0 0 120 120"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id={`${idPrefix}-ring-grad`} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
            <stop offset="35%" stopColor="currentColor" stopOpacity="0.34" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${idPrefix}-hub-left-grad`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="1" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
          <linearGradient id={`${idPrefix}-hub-right-grad`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="1" />
          </linearGradient>
          <linearGradient id={`${idPrefix}-hub-bridge-grad`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="currentColor" stopOpacity="0" />
            <stop offset="50%" stopColor="currentColor" stopOpacity="1" />
            <stop offset="100%" stopColor="currentColor" stopOpacity="0" />
          </linearGradient>
          <clipPath id={`${idPrefix}-hub-clip`}>
            <circle cx="60" cy="60" r="31.5" />
          </clipPath>
        </defs>

        <g className="oh-layer-base-mark">
          <circle className="oh-path-base" cx="60" cy="60" r="34" />
          <line className="oh-path-base" x1="42" y1="36.7" x2="42" y2="83.3" />
          <line className="oh-path-base" x1="78" y1="36.7" x2="78" y2="83.3" />
          <line className="oh-path-base" x1="42" y1="60" x2="78" y2="60" />
        </g>

        {!compact && (
          <g className="oh-layer-glow-waves">
            <circle className="oh-glow-wave oh-glow-wave--one" cx="60" cy="60" r="34" />
            <circle className="oh-glow-wave oh-glow-wave--two" cx="60" cy="60" r="34" />
          </g>
        )}

        <g className="oh-layer-active-hub" clipPath={`url(#${idPrefix}-hub-clip)`}>
          <line className="oh-node-left" x1="42" y1="20" x2="42" y2="100" stroke={`url(#${idPrefix}-hub-left-grad)`} />
          <line className="oh-node-right" x1="78" y1="20" x2="78" y2="100" stroke={`url(#${idPrefix}-hub-right-grad)`} />
          <line className="oh-node-bridge" x1="42" y1="60" x2="78" y2="60" stroke={`url(#${idPrefix}-hub-bridge-grad)`} />
        </g>

        <g className="oh-layer-outer-ring">
          <circle className="oh-ring-dynamic" cx="60" cy="60" r="34" stroke={`url(#${idPrefix}-ring-grad)`} />
        </g>

        <g className="oh-layer-solid-resolved">
          <circle className="oh-path-solid" cx="60" cy="60" r="34" />
          <line className="oh-path-solid" x1="42" y1="36.7" x2="42" y2="83.3" />
          <line className="oh-path-solid" x1="78" y1="36.7" x2="78" y2="83.3" />
          <line className="oh-path-solid" x1="42" y1="60" x2="78" y2="60" />
        </g>
      </svg>
    </div>
  );
};

OpenHarnessLogo.displayName = 'OpenHarnessLogo';

export default OpenHarnessLogo;
