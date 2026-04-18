/**
 * Input component
 */

import React, { forwardRef } from 'react';
import './Input.scss';

export interface InputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size' | 'prefix'> {
  variant?: 'default' | 'filled' | 'outlined';
  inputSize?: 'small' | 'medium' | 'large';
  size?: 'small' | 'medium' | 'large';
  error?: boolean;
  errorMessage?: string;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
  label?: string;
  hint?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({
  variant = 'default',
  inputSize = 'medium',
  size,
  error = false,
  errorMessage,
  prefix,
  suffix,
  label,
  hint,
  className = '',
  disabled,
  ...props
}, ref) => {
  const resolvedInputSize = size ?? inputSize;
  const classNames = [
    'openharness-input-wrapper',
    `openharness-input-wrapper--${variant}`,
    `openharness-input-wrapper--${resolvedInputSize}`,
    error && 'openharness-input-wrapper--error',
    disabled && 'openharness-input-wrapper--disabled',
    className
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div className={classNames}>
      {label && <label className="openharness-input-label">{label}</label>}
      <div className="openharness-input-container">
        {prefix && <span className="openharness-input-prefix">{prefix}</span>}
        <input
          ref={ref}
          className="openharness-input"
          disabled={disabled}
          {...props}
        />
        {suffix && <span className="openharness-input-suffix">{suffix}</span>}
      </div>
      {!error && hint && (
        <span className="openharness-input-error-message">{hint}</span>
      )}
      {error && errorMessage && (
        <span className="openharness-input-error-message">{errorMessage}</span>
      )}
    </div>
  );
});

Input.displayName = 'Input';
