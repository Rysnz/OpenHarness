import { STORAGE_KEYS } from '@/shared/constants/app';
import { createLogger } from '@/shared/utils/logger';

const logger = createLogger('ManualTerminalProfileService');
const MANUAL_PROFILE_STATE_VERSION = 1 as const;
const MANUAL_PROFILE_ID_PREFIX = 'manual_profile';

export interface ManualTerminalProfile {
  id: string;
  sessionId: string;
  name: string;
  workingDirectory?: string;
  startupCommand?: string;
  shellType?: string;
}

export interface ManualTerminalProfilesState {
  version: typeof MANUAL_PROFILE_STATE_VERSION;
  profiles: ManualTerminalProfile[];
}

export interface ManualTerminalProfileInput {
  id?: string;
  sessionId: string;
  name: string;
  workingDirectory?: string;
  startupCommand?: string;
  shellType?: string;
}

const EMPTY_STATE: ManualTerminalProfilesState = {
  version: MANUAL_PROFILE_STATE_VERSION,
  profiles: [],
};

function getStorageKey(workspacePath: string): string {
  return `${STORAGE_KEYS.MANUAL_TERMINAL_PROFILES}:${workspacePath}`;
}

export function generateManualTerminalProfileId(): string {
  const randomSuffix = Math.random().toString(36).slice(2, 10);
  return `${MANUAL_PROFILE_ID_PREFIX}_${Date.now()}_${randomSuffix}`;
}

function cleanOptionalText(value: string | undefined): string | undefined {
  return value?.trim() || undefined;
}

function normalizeProfile(profile: Partial<ManualTerminalProfileInput>): ManualTerminalProfile | null {
  const name = profile.name?.trim();

  if (!profile.id || !profile.sessionId || !name) {
    return null;
  }

  return {
    id: profile.id,
    sessionId: profile.sessionId,
    name,
    workingDirectory: cleanOptionalText(profile.workingDirectory),
    startupCommand: cleanOptionalText(profile.startupCommand),
    shellType: cleanOptionalText(profile.shellType),
  };
}

function normalizeProfiles(rawProfiles: unknown): ManualTerminalProfile[] {
  if (!Array.isArray(rawProfiles)) {
    return [];
  }

  return rawProfiles
    .map((item) => normalizeProfile(item as Partial<ManualTerminalProfileInput>))
    .filter((item): item is ManualTerminalProfile => item !== null);
}

function normalizeState(raw: unknown): ManualTerminalProfilesState {
  if (!raw || typeof raw !== 'object') {
    return EMPTY_STATE;
  }

  const profiles = normalizeProfiles((raw as { profiles?: unknown }).profiles);

  return {
    version: MANUAL_PROFILE_STATE_VERSION,
    profiles,
  };
}

function loadStoredState(workspacePath: string): ManualTerminalProfilesState {
  const raw = localStorage.getItem(getStorageKey(workspacePath));
  return raw ? normalizeState(JSON.parse(raw)) : EMPTY_STATE;
}

function findProfileToReplace(
  profiles: ManualTerminalProfile[],
  input: ManualTerminalProfileInput,
): ManualTerminalProfile | undefined {
  return profiles.find((profile) => profile.id === input.id || profile.sessionId === input.sessionId);
}

export function loadManualTerminalProfiles(workspacePath: string): ManualTerminalProfilesState {
  try {
    return loadStoredState(workspacePath);
  } catch (error) {
    logger.error('Failed to load manual terminal profiles', { workspacePath, error });
  }

  return EMPTY_STATE;
}

export function saveManualTerminalProfiles(
  workspacePath: string,
  state: ManualTerminalProfilesState,
): void {
  try {
    localStorage.setItem(getStorageKey(workspacePath), JSON.stringify(normalizeState(state)));
  } catch (error) {
    logger.error('Failed to save manual terminal profiles', { workspacePath, error });
  }
}

export function listManualTerminalProfiles(workspacePath: string): ManualTerminalProfile[] {
  return loadManualTerminalProfiles(workspacePath).profiles;
}

export function getManualTerminalProfileById(
  workspacePath: string,
  profileId: string,
): ManualTerminalProfile | undefined {
  return listManualTerminalProfiles(workspacePath).find((profile) => profile.id === profileId);
}

export function getManualTerminalProfileBySessionId(
  workspacePath: string,
  sessionId: string,
): ManualTerminalProfile | undefined {
  return listManualTerminalProfiles(workspacePath).find((profile) => profile.sessionId === sessionId);
}

export function upsertManualTerminalProfile(
  workspacePath: string,
  input: ManualTerminalProfileInput,
): ManualTerminalProfile {
  const currentState = loadManualTerminalProfiles(workspacePath);
  const existingProfile = findProfileToReplace(currentState.profiles, input);
  const normalizedProfile = normalizeProfile({
    id: existingProfile?.id ?? input.id ?? generateManualTerminalProfileId(),
    sessionId: input.sessionId,
    name: input.name,
    workingDirectory: input.workingDirectory,
    startupCommand: input.startupCommand,
    shellType: input.shellType,
  });

  if (!normalizedProfile) {
    throw new Error('Invalid manual terminal profile');
  }

  const existingIndex = currentState.profiles.findIndex((profile) => profile.id === normalizedProfile.id);
  const nextProfiles = [...currentState.profiles];

  if (existingIndex >= 0) {
    nextProfiles[existingIndex] = normalizedProfile;
  } else {
    nextProfiles.push(normalizedProfile);
  }

  saveManualTerminalProfiles(workspacePath, {
    version: MANUAL_PROFILE_STATE_VERSION,
    profiles: nextProfiles,
  });

  return normalizedProfile;
}

export function deleteManualTerminalProfile(workspacePath: string, profileId: string): void {
  const currentState = loadManualTerminalProfiles(workspacePath);
  saveManualTerminalProfiles(workspacePath, {
    version: MANUAL_PROFILE_STATE_VERSION,
    profiles: currentState.profiles.filter((profile) => profile.id !== profileId),
  });
}
