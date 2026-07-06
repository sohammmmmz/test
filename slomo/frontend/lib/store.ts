import { create } from "zustand";

export type AvatarState = "idle" | "listening" | "thinking" | "speaking" | "working";

interface SloMoStore {
  avatar: AvatarState;
  setAvatar: (s: AvatarState) => void;
  voiceReply: boolean;
  toggleVoiceReply: () => void;
}

export const useSloMoStore = create<SloMoStore>((set) => ({
  avatar: "idle",
  setAvatar: (avatar) => set({ avatar }),
  voiceReply: true,
  toggleVoiceReply: () => set((s) => ({ voiceReply: !s.voiceReply })),
}));
