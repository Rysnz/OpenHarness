import { i18nService } from '@/infrastructure/i18n';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WINDOWS_ILLEGAL_PATH_CHARS = /[<>:"|?*]/;
const IPV4_PATTERN = /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
const BYTES_PER_MB = 1024 * 1024;
const PORT_MIN = 1;
const PORT_MAX = 65535;

export function isValidEmail(email: string): boolean {
  return EMAIL_PATTERN.test(email);
}

export function isValidUrl(url: string): boolean {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
}

export function isValidFilePath(path: string): boolean {
  return path.trim().length > 0 && !WINDOWS_ILLEGAL_PATH_CHARS.test(path);
}

export function hasValidExtension(filename: string, allowedExtensions: string[]): boolean {
  const extension = filename.split('.').pop()?.toLowerCase();
  return !!extension && allowedExtensions.includes(extension);
}

export function isValidJson(str: string): boolean {
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

export function isInRange(value: number, min: number, max: number): boolean {
  return value >= min && value <= max;
}

export function isValidLength(str: string, minLength = 0, maxLength = Infinity): boolean {
  return str.length >= minLength && str.length <= maxLength;
}

export function isRequired(value: unknown): boolean {
  if (value === null || value === undefined) {
    return false;
  }

  if (typeof value === 'string') {
    return value.trim().length > 0;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return true;
}

export function matchesPattern(value: string, pattern: RegExp): boolean {
  return pattern.test(value);
}

export function isValidFileSize(file: File, maxSizeInMB: number): boolean {
  return file.size <= maxSizeInMB * BYTES_PER_MB;
}

export function isValidPort(port: number): boolean {
  return Number.isInteger(port) && port >= PORT_MIN && port <= PORT_MAX;
}

export function isValidIPAddress(ip: string): boolean {
  return IPV4_PATTERN.test(ip);
}

export function validatePasswordStrength(password: string): {
  isValid: boolean;
  score: number;
  issues: string[];
} {
  const issues: string[] = [];
  let score = 0;

  if (password.length < 8) {
    issues.push(i18nService.t('common:validation.password.minLength', { min: 8 }));
  } else {
    score += 25;
  }

  if (!/[a-z]/.test(password)) {
    issues.push(i18nService.t('common:validation.password.lowercase'));
  } else {
    score += 25;
  }

  if (!/[A-Z]/.test(password)) {
    issues.push(i18nService.t('common:validation.password.uppercase'));
  } else {
    score += 25;
  }

  if (!/[0-9]/.test(password)) {
    issues.push(i18nService.t('common:validation.password.number'));
  } else {
    score += 25;
  }

  if (!/[^a-zA-Z0-9]/.test(password)) {
    issues.push(i18nService.t('common:validation.password.specialCharSuggested'));
  } else {
    score += 10;
  }

  return {
    isValid: issues.length === 0,
    score: Math.min(score, 100),
    issues
  };
}

