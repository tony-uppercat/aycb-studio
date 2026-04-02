import { createContext, useContext, useState, useEffect } from 'react'
import { STORAGE_KEYS } from '../storage/keys'

interface Settings {
  apiKey: string
  hfApiKey: string
  bflApiKey: string
  muApiKey: string
  localServerUrl: string
  ollamaUrl: string
  model: string
  doEmbed: boolean
}

interface SettingsCtx extends Settings {
  setApiKey: (k: string) => void
  setHfApiKey: (k: string) => void
  setBflApiKey: (k: string) => void
  setMuApiKey: (k: string) => void
  setLocalServerUrl: (k: string) => void
  setOllamaUrl: (k: string) => void
  setModel: (m: string) => void
  setDoEmbed: (v: boolean) => void
}

const LS_KEY = STORAGE_KEYS.SETTINGS
const DEFAULTS: Settings = { apiKey: '', hfApiKey: '', bflApiKey: '', muApiKey: '', localServerUrl: '', ollamaUrl: 'http://localhost:11434', model: 'Gemini 3.1 Pro', doEmbed: false }

function load(): Settings {
  try {
    const s = localStorage.getItem(LS_KEY)
    if (s) return { ...DEFAULTS, ...JSON.parse(s) }
  } catch { /* ignore */ }
  return DEFAULTS
}

const Ctx = createContext<SettingsCtx>({
  ...DEFAULTS,
  setApiKey: () => {},
  setHfApiKey: () => {},
  setBflApiKey: () => {},
  setMuApiKey: () => {},
  setLocalServerUrl: () => {},
  setOllamaUrl: () => {},
  setModel: () => {},
  setDoEmbed: () => {},
})

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<Settings>(load)

  useEffect(() => {
    try { localStorage.setItem(LS_KEY, JSON.stringify(settings)) } catch { /* ignore */ }
  }, [settings])

  const ctx: SettingsCtx = {
    ...settings,
    setApiKey: (k) => setSettings(s => ({ ...s, apiKey: k })),
    setHfApiKey: (k) => setSettings(s => ({ ...s, hfApiKey: k })),
    setBflApiKey: (k) => setSettings(s => ({ ...s, bflApiKey: k })),
    setMuApiKey: (k) => setSettings(s => ({ ...s, muApiKey: k })),
    setLocalServerUrl: (k) => setSettings(s => ({ ...s, localServerUrl: k })),
    setOllamaUrl: (k) => setSettings(s => ({ ...s, ollamaUrl: k })),
    setModel: (m) => setSettings(s => ({ ...s, model: m })),
    setDoEmbed: (v) => setSettings(s => ({ ...s, doEmbed: v })),
  }

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useSettings() { return useContext(Ctx) }
