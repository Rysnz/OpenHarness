import { create } from 'zustand';

export type NurseryPage = 'gallery' | 'template' | 'partner';

interface NurseryStoreState {
  page: NurseryPage;
  activeWorkspaceId: string | null;
  openGallery: () => void;
  openTemplate: () => void;
  openPartner: (workspaceId: string) => void;
}

export const useNurseryStore = create<NurseryStoreState>((set) => ({
  page: 'gallery',
  activeWorkspaceId: null,
  openGallery: () => set({ page: 'gallery', activeWorkspaceId: null }),
  openTemplate: () => set({ page: 'template', activeWorkspaceId: null }),
  openPartner: (workspaceId) => set({ page: 'partner', activeWorkspaceId: workspaceId }),
}));
