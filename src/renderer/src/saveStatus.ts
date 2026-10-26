import { create } from 'zustand'

interface SaveState {
  phase: 'saved' | 'saving' | 'failed'
  error: string | null
  lastSavedAt: number | null
  setPhase: (phase: SaveState['phase'], error?: string | null, at?: number) => void
}

export const useSaveStatus = create<SaveState>((set) => ({
  phase: 'saved',
  error: null,
  lastSavedAt: null,
  setPhase: (phase, error = null, at) =>
    set((state) => ({
      phase,
      error,
      lastSavedAt: phase === 'saved' ? (at ?? Date.now()) : state.lastSavedAt
    }))
}))

if (typeof window !== 'undefined' && window.api) {
  window.api.on('save:state', (payload) => {
    useSaveStatus.getState().setPhase(payload.phase, payload.error, payload.at)
  })
}
