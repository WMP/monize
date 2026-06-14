import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * WebMCP opt-in state. Exposing Monize's tools to an in-browser AI agent
 * (via the W3C `navigator.modelContext` API) is a sensitive capability -- any
 * agent running in the tab can call the registered tools using the user's
 * existing session. It is therefore strictly opt-in and defaults to OFF, and
 * the choice is per-device (persisted to localStorage, not the server account).
 */
interface WebMcpState {
  enabled: boolean;
  setEnabled: (value: boolean) => void;
}

export const useWebMcpStore = create<WebMcpState>()(
  persist(
    (set) => ({
      enabled: false,
      setEnabled: (value) => set({ enabled: value }),
    }),
    { name: 'monize-webmcp-enabled' },
  ),
);
