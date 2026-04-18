/**
 * Build MiniApp theme payload from main app ThemeConfig.
 * Maps to --openharness-* CSS variables for iframe theme sync.
 */
import type { ThemeConfig, ThemeType } from '@/infrastructure/theme/types';

export interface MiniAppThemePayload {
  type: ThemeType;
  id: string;
  vars: Record<string, string>;
}

export function buildMiniAppThemeVars(theme: ThemeConfig | null): MiniAppThemePayload | null {
  if (!theme) return null;

  const { colors, effects, typography } = theme;
  const vars: Record<string, string> = {};

  vars['--openharness-bg'] = colors.background.primary;
  vars['--openharness-bg-secondary'] = colors.background.secondary;
  vars['--openharness-bg-tertiary'] = colors.background.tertiary;
  vars['--openharness-bg-elevated'] = colors.background.elevated;

  vars['--openharness-text'] = colors.text.primary;
  vars['--openharness-text-secondary'] = colors.text.secondary;
  vars['--openharness-text-muted'] = colors.text.muted;

  vars['--openharness-accent'] = colors.accent[500];
  vars['--openharness-accent-hover'] = colors.accent[600];

  vars['--openharness-success'] = colors.semantic.success;
  vars['--openharness-warning'] = colors.semantic.warning;
  vars['--openharness-error'] = colors.semantic.error;
  vars['--openharness-info'] = colors.semantic.info;

  vars['--openharness-border'] = colors.border.base;
  vars['--openharness-border-subtle'] = colors.border.subtle;

  vars['--openharness-element-bg'] = colors.element.base;
  vars['--openharness-element-hover'] = colors.element.medium;

  if (effects?.radius) {
    vars['--openharness-radius'] = effects.radius.base;
    vars['--openharness-radius-lg'] = effects.radius.lg;
  }

  if (typography?.font) {
    vars['--openharness-font-sans'] = typography.font.sans;
    vars['--openharness-font-mono'] = typography.font.mono;
  }

  if (colors.scrollbar) {
    vars['--openharness-scrollbar-thumb'] = colors.scrollbar.thumb;
    vars['--openharness-scrollbar-thumb-hover'] = colors.scrollbar.thumbHover;
  } else {
    vars['--openharness-scrollbar-thumb'] =
      theme.type === 'dark' ? 'rgba(255, 255, 255, 0.12)' : 'rgba(0, 0, 0, 0.15)';
    vars['--openharness-scrollbar-thumb-hover'] =
      theme.type === 'dark' ? 'rgba(255, 255, 255, 0.22)' : 'rgba(0, 0, 0, 0.28)';
  }

  return {
    type: theme.type,
    id: theme.id,
    vars,
  };
}
