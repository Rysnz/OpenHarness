/**
 * Search input component
 */

import React, { useState, useRef, useEffect, useCallback, forwardRef } from 'react';
import { useI18n } from '@/infrastructure/i18n';
import './Search.scss';

function SearchGlyph() {
  return (
    <svg
      className="search__icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle
        cx="11"
        cy="11"
        r="7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M20 20L16.5 16.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function LoadingGlyph() {
  return (
    <svg
      className="search__loading-icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle
        className="search__loading-track"
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="3"
      />
      <path
        className="search__loading-arc"
        d="M12 3A9 9 0 0 1 21 12"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

export interface SearchProps {
  value?: string;
  defaultValue?: string;
  placeholder?: string;
  disabled?: boolean;
  onChange?: (value: string) => void;
  onSearch?: (value: string) => void;
  onClear?: () => void;
  /** Fired before built-in key handling; call `preventDefault` to skip Enter/Escape behavior. */
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  onFocus?: () => void;
  onBlur?: () => void;
  size?: 'small' | 'medium' | 'large';
  clearable?: boolean;
  loading?: boolean;
  error?: boolean;
  errorMessage?: string;
  autoFocus?: boolean;
  maxLength?: number;
  className?: string;
  expandOnFocus?: boolean;
  enterToSearch?: boolean;
  prefixIcon?: React.ReactNode;
  searchButtonText?: string;
  showSearchButton?: boolean;
  suffixContent?: React.ReactNode;
  /** Overrides default aria-label on the input. */
  inputAriaLabel?: string;
  ariaControls?: string;
  ariaExpanded?: boolean;
}

function mergeRefs<T>(...refs: Array<React.ForwardedRef<T> | React.MutableRefObject<T | null>>) {
  return (node: T | null) => {
    refs.forEach(ref => {
      if (!ref) {
        return;
      }
      if (typeof ref === 'function') {
        ref(node);
      } else {
        (ref as React.MutableRefObject<T | null>).current = node;
      }
    });
  };
}

function buildSearchClassNames(options: {
  size: NonNullable<SearchProps['size']>;
  isFocused: boolean;
  isHovered: boolean;
  disabled: boolean;
  error: boolean;
  loading: boolean;
  expandOnFocus: boolean;
  showSearchButton: boolean;
  className: string;
}): string {
  return [
    'search',
    `search--${options.size}`,
    options.isFocused && 'search--focused',
    options.isHovered && 'search--hovered',
    options.disabled && 'search--disabled',
    options.error && 'search--error',
    options.loading && 'search--loading',
    options.expandOnFocus && 'search--expandable',
    options.showSearchButton && 'search--with-button',
    options.className
  ]
    .filter(Boolean)
    .join(' ');
}

export const Search = forwardRef<HTMLInputElement, SearchProps>(({
  value,
  defaultValue = '',
  placeholder,
  disabled = false,
  onChange,
  onSearch,
  onClear,
  onKeyDown: onKeyDownProp,
  onFocus: onFocusProp,
  onBlur: onBlurProp,
  size = 'medium',
  clearable = true,
  loading = false,
  error = false,
  errorMessage,
  autoFocus = false,
  maxLength,
  className = '',
  expandOnFocus = false,
  enterToSearch = true,
  prefixIcon,
  searchButtonText,
  showSearchButton = false,
  suffixContent,
  inputAriaLabel,
  ariaControls,
  ariaExpanded,
}, ref) => {
  const { t } = useI18n('components');
  
  // Resolve i18n default values
  const resolvedPlaceholder = placeholder ?? t('search.placeholder');
  const resolvedSearchButtonText = searchButtonText ?? t('search.placeholder').replace('...', '');
  const [inputValue, setInputValue] = useState<string>(
    value !== undefined ? value : defaultValue
  );
  const [isFocused, setIsFocused] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  
  const inputRef = useRef<HTMLInputElement | null>(null);
  const setInputRefs = useCallback(mergeRefs(inputRef, ref), [ref]);

  useEffect(() => {
    if (value !== undefined) {
      setInputValue(value);
    }
  }, [value]);

  useEffect(() => {
    if (autoFocus && inputRef.current) {
      inputRef.current.focus();
    }
  }, [autoFocus]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    onChange?.(newValue);
  }, [onChange]);

  const handleSearch = useCallback(() => {
    if (!disabled && !loading) {
      onSearch?.(inputValue);
    }
  }, [inputValue, onSearch, disabled, loading]);

  const handleClear = useCallback((e?: React.SyntheticEvent) => {
    e?.stopPropagation();
    setInputValue('');
    onChange?.('');
    onClear?.();
    inputRef.current?.focus();
  }, [onChange, onClear]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    onKeyDownProp?.(e);
    if (e.defaultPrevented) {
      return;
    }
    if (e.key === 'Enter' && enterToSearch) {
      e.preventDefault();
      handleSearch();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      if (inputValue) {
        handleClear(e);
      } else {
        inputRef.current?.blur();
      }
    }
  }, [inputValue, enterToSearch, handleSearch, handleClear, onKeyDownProp]);

  const handleFocus = useCallback(() => {
    setIsFocused(true);
    onFocusProp?.();
  }, [onFocusProp]);

  const handleBlur = useCallback(() => {
    setIsFocused(false);
    onBlurProp?.();
  }, [onBlurProp]);

  const classNames = buildSearchClassNames({
    size,
    isFocused,
    isHovered,
    disabled,
    error,
    loading,
    expandOnFocus,
    showSearchButton,
    className
  });

  return (
    <div className={classNames}>
      <div 
        className="search__wrapper"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        <div className="search__prefix">
          {loading ? <LoadingGlyph /> : (prefixIcon || <SearchGlyph />)}
        </div>

        <input
          ref={setInputRefs}
          type="text"
          className="search__input"
          value={inputValue}
          placeholder={resolvedPlaceholder}
          disabled={disabled}
          maxLength={maxLength}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          onFocus={handleFocus}
          onBlur={handleBlur}
          aria-label={inputAriaLabel ?? t('search.placeholder')}
          aria-controls={ariaControls}
          aria-expanded={ariaExpanded}
        />

        {clearable && inputValue && !loading && !disabled && (
          <button
            type="button"
            className="search__clear"
            onClick={handleClear}
            aria-label={t('search.clear')}
            tabIndex={-1}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path
                d="M4 4L12 12M12 4L4 12"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        )}

        {suffixContent && (
          <div className="search__suffix-content">
            {suffixContent}
          </div>
        )}

        {showSearchButton && (
          <button
            type="button"
            className="search__button"
            onClick={handleSearch}
            disabled={disabled || loading}
            aria-label={t('search.placeholder')}
          >
            {resolvedSearchButtonText}
          </button>
        )}
      </div>

      {error && errorMessage && (
        <div className="search__error-message">{errorMessage}</div>
      )}
    </div>
  );
});

Search.displayName = 'Search';
