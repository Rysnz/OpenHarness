 

import { invoke } from '@tauri-apps/api/core';

export type MemoryType = 
  | 'tech_preference' 
  | 'project_context' 
  | 'user_habit' 
  | 'code_pattern' 
  | 'decision' 
  | 'other';

export interface AIMemory {
  id: string;
  title: string;
  content: string;
  type: MemoryType;
  tags: string[];
  source: string;
  created_at: string;
  updated_at: string;
  importance: number; // 1-5
  enabled: boolean;
}

export interface CreateMemoryRequest {
  title: string;
  content: string;
  type: MemoryType;
  importance: number;
  tags?: string[];
}

export interface UpdateMemoryRequest {
  id: string;
  title: string;
  content: string;
  type: MemoryType;
  importance: number;
  tags: string[];
  enabled: boolean;
}

 
/**
 * Fetch all AI memories.
 * @param workspacePath - Optional workspace scope (null = user-level, path = project-level)
 */
export async function getAllMemories(workspacePath?: string): Promise<AIMemory[]> {
  return await invoke<AIMemory[]>('get_all_memories', { workspacePath: workspacePath ?? null });
}

 
/**
 * Add a new AI memory.
 * @param request - Memory data
 * @param workspacePath - Optional workspace scope (null = user-level, path = project-level)
 */
export async function addMemory(request: CreateMemoryRequest, workspacePath?: string): Promise<AIMemory> {
  return await invoke<AIMemory>('add_memory', { request, workspacePath: workspacePath ?? null });
}

/**
 * Update an existing AI memory.
 * @param request - Memory update data
 * @param workspacePath - Optional workspace scope
 */
export async function updateMemory(request: UpdateMemoryRequest, workspacePath?: string): Promise<boolean> {
  return await invoke<boolean>('update_memory', { request, workspacePath: workspacePath ?? null });
}

/**
 * Delete an AI memory.
 * @param id - Memory ID
 * @param workspacePath - Optional workspace scope
 */
export async function deleteMemory(id: string, workspacePath?: string): Promise<boolean> {
  return await invoke<boolean>('delete_memory', { id, workspacePath: workspacePath ?? null });
}

/**
 * Toggle an AI memory's enabled state.
 * @param id - Memory ID
 * @param workspacePath - Optional workspace scope
 */
export async function toggleMemory(id: string, workspacePath?: string): Promise<boolean> {
  return await invoke<boolean>('toggle_memory', { id, workspacePath: workspacePath ?? null });
}



