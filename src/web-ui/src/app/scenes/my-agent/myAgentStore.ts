import { create } from 'zustand';

interface MyAgentState {
  selectedPartnerWorkspaceId: string | null;
  setSelectedPartnerWorkspaceId: (workspaceId: string | null) => void;
}

export const useMyAgentStore = create<MyAgentState>((set) => ({
  selectedPartnerWorkspaceId: null,
  setSelectedPartnerWorkspaceId: (workspaceId) => set({ selectedPartnerWorkspaceId: workspaceId }),
}));
