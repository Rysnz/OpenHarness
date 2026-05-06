export type FontSizeLevel = 'compact' | 'small' | 'default' | 'medium' | 'large' | 'custom';
export type PresetFontSizeLevel = Exclude<FontSizeLevel, 'custom'>;

export interface UiFontSizePreference {
  level: FontSizeLevel;
  customPx?: number;
}

export type FlowChatFontMode = 'sync' | 'lift' | 'independent';

export interface FlowChatFontSizePreference {
  mode: FlowChatFontMode;
  basePx?: number;
}

export interface FontPreference {
  uiSize: UiFontSizePreference;
  flowChat: FlowChatFontSizePreference;
}

export interface FontSizeTokens {
  xs: string;
  sm: string;
  base: string;
  lg: string;
  xl: string;
  '2xl': string;
  '3xl': string;
  '4xl': string;
  '5xl': string;
}

export type FontSizeLevelPresets = Record<PresetFontSizeLevel, FontSizeTokens>;

const DEFAULT_UI_BASE_PX = 14;
const MIN_FONT_BASE_PX = 12;
const MAX_FONT_BASE_PX = 20;
const FLOW_CHAT_LIFT_PX = 1;

export const PRESET_UI_BASE_PX: Record<PresetFontSizeLevel, number> = {
  compact: 12,
  small: 13,
  default: DEFAULT_UI_BASE_PX,
  medium: 15,
  large: 16,
};

export function deriveFontSizeTokens(basePx: number): FontSizeTokens {
  const b = clampFontBase(basePx);
  return {
    xs: `${b - 2}px`,
    sm: `${b - 1}px`,
    base: `${b}px`,
    lg: `${b + 1}px`,
    xl: `${b + 2}px`,
    '2xl': `${b + 4}px`,
    '3xl': `${b + 8}px`,
    '4xl': `${b + 12}px`,
    '5xl': `${b + 18}px`,
  };
}

export const UI_FONT_SIZE_PRESETS: FontSizeLevelPresets = {
  compact: deriveFontSizeTokens(PRESET_UI_BASE_PX.compact),
  small: deriveFontSizeTokens(PRESET_UI_BASE_PX.small),
  default: deriveFontSizeTokens(PRESET_UI_BASE_PX.default),
  medium: deriveFontSizeTokens(PRESET_UI_BASE_PX.medium),
  large: deriveFontSizeTokens(PRESET_UI_BASE_PX.large),
};

export function resolveFontSizeTokens(uiSize: UiFontSizePreference): FontSizeTokens {
  return uiSize.level === 'custom'
    ? deriveFontSizeTokens(uiSize.customPx ?? DEFAULT_UI_BASE_PX)
    : UI_FONT_SIZE_PRESETS[uiSize.level];
}

export function resolveFlowChatFontSizeTokens(pref: FontPreference): FontSizeTokens {
  const { flowChat, uiSize } = pref;

  if (flowChat.mode === 'independent') {
    return deriveFontSizeTokens(flowChat.basePx ?? DEFAULT_UI_BASE_PX);
  }

  if (flowChat.mode === 'lift') {
    return deriveFontSizeTokens(resolveLiftedBasePx(uiSize));
  }

  return resolveFontSizeTokens(uiSize);
}

export const DEFAULT_FONT_PREFERENCE: FontPreference = {
  uiSize: { level: 'default' },
  flowChat: { mode: 'lift' },
};

export type FontPreferenceEventType = 'font:before-change' | 'font:after-change';

export interface FontPreferenceEvent {
  type: FontPreferenceEventType;
  preference: FontPreference;
  previousPreference?: FontPreference;
  timestamp: number;
}

export type FontPreferenceEventListener = (event: FontPreferenceEvent) => void | Promise<void>;

function clampFontBase(basePx: number): number {
  return Math.max(MIN_FONT_BASE_PX, Math.min(MAX_FONT_BASE_PX, basePx));
}

function resolveLiftedBasePx(uiSize: UiFontSizePreference): number {
  const uiBase = parseInt(resolveFontSizeTokens(uiSize).base, 10);
  const safeBase = Number.isNaN(uiBase) ? DEFAULT_UI_BASE_PX : uiBase;
  return clampFontBase(safeBase + FLOW_CHAT_LIFT_PX);
}
