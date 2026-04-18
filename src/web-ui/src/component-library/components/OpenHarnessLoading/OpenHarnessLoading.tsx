import React from 'react';
import { OpenHarnessLogo } from '../OpenHarnessLogo';
import './OpenHarnessLoading.scss';

export type OpenHarnessLoadingSize = 'small' | 'medium' | 'large';

export interface OpenHarnessLoadingProps {
  size?: OpenHarnessLoadingSize;
  text?: string;
  className?: string;
}

const sizeMap: Record<OpenHarnessLoadingSize, number> = {
  small: 22,
  medium: 38,
  large: 56,
};

export const OpenHarnessLoading: React.FC<OpenHarnessLoadingProps> = ({
  size = 'medium',
  text,
  className = '',
}) => {
  return (
    <div className={`openharness-loading openharness-loading--${size} ${className}`.trim()}>
      <OpenHarnessLogo size={sizeMap[size]} variant="compact" animated />
      {text && <div className="openharness-loading__text">{text}</div>}
    </div>
  );
};

OpenHarnessLoading.displayName = 'OpenHarnessLoading';

export default OpenHarnessLoading;
