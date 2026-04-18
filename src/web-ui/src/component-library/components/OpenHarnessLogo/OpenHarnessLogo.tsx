import React from 'react';
import './OpenHarnessLogo.scss';

export type OpenHarnessLogoVariant = 'default' | 'compact';

export interface OpenHarnessLogoProps {
  size?: number;
  className?: string;
  animated?: boolean;
  variant?: OpenHarnessLogoVariant;
}

export const OpenHarnessLogo: React.FC<OpenHarnessLogoProps> = ({
  size = 100,
  className = '',
  animated = true,
  variant = 'default',
}) => {
  const compact = variant === 'compact' || size < 56;

  return (
    <svg
      className={`openharness-logo ${animated ? 'openharness-logo--animated' : ''} ${compact ? 'openharness-logo--compact' : ''} ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label="OpenHarness"
    >
      <rect className="openharness-logo__backplate" x="12" y="12" width="96" height="96" rx="24" />
      <path
        className="openharness-logo__loop openharness-logo__loop--base"
        d="M76 24c18 6 30 23 30 42 0 25-20 44-45 44S16 90 16 65s20-45 45-45c5 0 10 1 15 4"
      />
      <path
        className="openharness-logo__loop openharness-logo__loop--flow"
        d="M76 24c18 6 30 23 30 42 0 25-20 44-45 44S16 90 16 65s20-45 45-45c5 0 10 1 15 4"
      />
      <path
        className="openharness-logo__loop openharness-logo__loop--sheen"
        d="M76 24c18 6 30 23 30 42 0 25-20 44-45 44S16 90 16 65s20-45 45-45c5 0 10 1 15 4"
      />
      <path className="openharness-logo__bridge" d="M42 45v31M78 45v31M42 60h36" />
      <circle className="openharness-logo__anchor openharness-logo__anchor--left" cx="42" cy="60" r="5" />
      <circle className="openharness-logo__anchor openharness-logo__anchor--center" cx="60" cy="60" r="6" />
      <circle className="openharness-logo__anchor openharness-logo__anchor--right" cx="78" cy="60" r="5" />
      <path className="openharness-logo__opening" d="M79 22l15-8 1 17" />
    </svg>
  );
};

OpenHarnessLogo.displayName = 'OpenHarnessLogo';

export default OpenHarnessLogo;
