 

export { openharnessDarkTheme } from './dark-theme';
export { openharnessLightTheme } from './light-theme';
export { openharnessMidnightTheme } from './midnight-theme';
export { openharnessChinaStyleTheme } from './china-style-theme';
export { openharnessChinaNightTheme } from './china-night-theme';
export { openharnessCyberTheme } from './cyber-theme';
export { openharnessSlateTheme } from './slate-theme';

import { openharnessDarkTheme } from './dark-theme';
import { openharnessLightTheme } from './light-theme';
import { openharnessMidnightTheme } from './midnight-theme';
import { openharnessChinaStyleTheme } from './china-style-theme';
import { openharnessChinaNightTheme } from './china-night-theme';
import { openharnessCyberTheme } from './cyber-theme';
import { openharnessSlateTheme } from './slate-theme';
import { ThemeConfig, ThemeId } from '../types';

/** Default light / dark builtin themes used when following system appearance. */
export const DEFAULT_LIGHT_THEME_ID: ThemeId = 'openharness-light';
export const DEFAULT_DARK_THEME_ID: ThemeId = 'openharness-dark';

/**
 * Picks openharness-dark vs openharness-light from `prefers-color-scheme`.
 * Used when the user has no saved theme preference.
 */
export function getSystemPreferredDefaultThemeId(): ThemeId {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return DEFAULT_LIGHT_THEME_ID;
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? DEFAULT_DARK_THEME_ID
    : DEFAULT_LIGHT_THEME_ID;
}

/** Static fallback when system preference is unavailable (e.g. SSR). */
export const DEFAULT_THEME_ID: ThemeId = DEFAULT_LIGHT_THEME_ID;

 
export const builtinThemes: ThemeConfig[] = [
  openharnessLightTheme,
  openharnessSlateTheme,
  openharnessDarkTheme,
  openharnessMidnightTheme,
  openharnessChinaStyleTheme,
  openharnessChinaNightTheme,
  openharnessCyberTheme,
];

 



