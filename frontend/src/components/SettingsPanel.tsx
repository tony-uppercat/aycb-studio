import { useCallback, useEffect, useState } from 'react'
import { useSettings } from './SettingsContext'
import { useCanvasStore } from '../stores/canvasStore'
import { MODELS } from '../presets'
import styles from './SettingsPanel.module.css'

type Tab = 'api' | 'local' | 'defaults' | 'paths' | 'backend'

const TABS: { id: Tab; label: string }[] = [
  { id: 'api', label: 'API Keys' },
  { id: 'local', label: 'Local' },
  { id: 'defaults', label: 'Defaults' },
  { id: 'paths', label: 'Paths' },
  { id: 'backend', label: 'Backend' },
]

interface Props {
  open: boolean
  onClose: () => void
}

interface GpuInfo {
  available: boolean
  name?: string
  vram_total?: string
  vram_used?: string
}

interface OllamaStatus {
  ok: boolean
  models?: string[]
}

export function SettingsPanel({ open, onClose }: Props) {
  const {
    apiKey, setApiKey,
    bflApiKey, setBflApiKey,
    muApiKey, setMuApiKey,
    localServerUrl, setLocalServerUrl,
    ollamaUrl, setOllamaUrl,
    model, setModel,
    doEmbed, setDoEmbed,
  } = useSettings()

  const [activeTab, setActiveTab] = useState<Tab>('api')
  const [restarting, setRestarting] = useState(false)
  const [sharedPath, setSharedPath] = useState('')
  const [sharedPathExists, setSharedPathExists] = useState(false)
  const [pathSaving, setPathSaving] = useState(false)
  const [gpuInfo, setGpuInfo] = useState<GpuInfo | null>(null)
  const [gpuLoading, setGpuLoading] = useState(false)
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null)
  const [ollamaLoading, setOllamaLoading] = useState(false)
  const [localIp, setLocalIp] = useState('')
  const backendStatus = useCanvasStore(s => s.backendStatus)

  const hardRestart = useCallback(async () => {
    setRestarting(true)
    try {
      await fetch('/api/restart', { method: 'POST' })
    } catch { /* backend will die, that's expected */ }
    useCanvasStore.setState({ backendStatus: 'offline' })
    const t0 = Date.now()
    const poll = setInterval(async () => {
      if (Date.now() - t0 > 30_000) { clearInterval(poll); setRestarting(false); return }
      try {
        const r = await fetch('/api/health', { signal: AbortSignal.timeout(2000) })
        if (r.ok) {
          clearInterval(poll)
          useCanvasStore.setState({ backendStatus: 'online' })
          setRestarting(false)
        }
      } catch { /* still down */ }
    }, 1500)
  }, [])

  const fetchGpuInfo = useCallback(async () => {
    setGpuLoading(true)
    try {
      const r = await fetch('/api/local/gpu', { signal: AbortSignal.timeout(3000) })
      if (r.ok) {
        setGpuInfo(await r.json())
      } else {
        setGpuInfo({ available: false })
      }
    } catch {
      setGpuInfo({ available: false })
    } finally {
      setGpuLoading(false)
    }
  }, [])

  const checkOllama = useCallback(async () => {
    if (!ollamaUrl) { setOllamaStatus(null); return }
    setOllamaLoading(true)
    try {
      const r = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(3000) })
      if (r.ok) {
        const data = await r.json()
        const models = (data.models ?? []).map((m: { name: string }) => m.name)
        setOllamaStatus({ ok: true, models })
      } else {
        setOllamaStatus({ ok: false })
      }
    } catch {
      setOllamaStatus({ ok: false })
    } finally {
      setOllamaLoading(false)
    }
  }, [ollamaUrl])

  const fetchPaths = useCallback(async () => {
    try {
      const r = await fetch('/api/settings/paths', { signal: AbortSignal.timeout(3000) })
      if (r.ok) {
        const d = await r.json()
        setSharedPath(d.shared_root ?? '')
        setSharedPathExists(d.exists ?? false)
      }
    } catch { /* offline */ }
  }, [])

  const savePath = useCallback(async () => {
    if (!sharedPath.trim()) return
    setPathSaving(true)
    try {
      const r = await fetch('/api/settings/paths', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ shared_root: sharedPath }),
        signal: AbortSignal.timeout(3000),
      })
      if (r.ok) {
        const d = await r.json()
        setSharedPathExists(d.exists ?? false)
      }
    } catch { /* offline */ }
    finally { setPathSaving(false) }
  }, [sharedPath])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Fetch GPU + Ollama + LAN IP info when Local tab is shown
  useEffect(() => {
    if (!open || activeTab !== 'local') return
    fetchGpuInfo()
    checkOllama()
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 3000)
    fetch('/api/health', { signal: controller.signal })
      .then(r => r.json())
      .then(d => setLocalIp(d.local_ip ?? ''))
      .catch(err => { if (err.name !== 'AbortError') console.warn('[Settings] health fetch failed:', err) })
      .finally(() => clearTimeout(timeout))
    return () => { clearTimeout(timeout); controller.abort() }
  }, [open, activeTab, fetchGpuInfo, checkOllama])

  // Fetch paths when Paths tab is shown
  useEffect(() => {
    if (open && activeTab === 'paths') fetchPaths()
  }, [open, activeTab, fetchPaths])

  if (!open) return null

  return (
    <>
      <div className={styles.overlay} onClick={onClose} />
      <div className={styles.panel}>
        <div className={styles.header}>
          <span className={styles.title}>Settings</span>
          <button className={styles.closeBtn} onClick={onClose}>&times;</button>
        </div>

        {/* Tabs */}
        <div className={styles.tabs}>
          {TABS.map(t => (
            <button
              key={t.id}
              className={`${styles.tab} ${activeTab === t.id ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className={styles.body}>
          {/* ===== API Keys Tab ===== */}
          {activeTab === 'api' && (
            <>
              <ApiKeyField
                label="Google Gemini API Key"
                value={apiKey}
                onChange={setApiKey}
                placeholder="Enter your Gemini API key"
                statusOk="Key configured"
                statusEmpty="No key set"
                hint="Your API key is stored locally and never sent to our servers."
                linkUrl="https://aistudio.google.com/apikey"
                linkText="Get your API key from Google AI Studio"
              />
              <ApiKeyField
                label="BFL API Key"
                value={bflApiKey}
                onChange={setBflApiKey}
                placeholder="Enter your BFL key (for Flux models)"
                statusOk="Key configured"
                statusEmpty="No key (Flux models disabled)"
                hint="For Flux 2 Klein image generation via Black Forest Labs."
                linkUrl="https://api.bfl.ai/"
                linkText="Get your key from BFL"
              />
              <ApiKeyField
                label="MuAPI Key"
                value={muApiKey}
                onChange={setMuApiKey}
                placeholder="Enter your MuAPI key (for Seedance video)"
                statusOk="Key configured"
                statusEmpty="No key (Seedance video disabled)"
                hint="For Seedance 2.0 video generation (text-to-video, image-to-video)."
                linkUrl="https://muapi.ai/"
                linkText="Get your key from MuAPI"
              />
            </>
          )}

          {/* ===== Local Tab ===== */}
          {activeTab === 'local' && (
            <>
              {localIp && (
                <div className={styles.field}>
                  <label className={styles.label}>LAN Access</label>
                  <div className={styles.infoCard}>
                    <code style={{ fontSize: 13, userSelect: 'all' }}>
                      http://{localIp}:5100
                    </code>
                    <p className={styles.hint} style={{ marginTop: 4 }}>
                      Open this URL on iPad or other LAN devices. Review Hub at /review.
                    </p>
                  </div>
                </div>
              )}

              <div className={styles.field}>
                <label className={styles.label}>Local Server URL</label>
                <input
                  className={styles.input}
                  type="text"
                  placeholder="http://localhost:8188"
                  value={localServerUrl}
                  onChange={e => setLocalServerUrl(e.target.value)}
                />
                <div className={styles.status}>
                  <span className={`${styles.dot} ${localServerUrl ? styles.dotOk : styles.dotEmpty}`} />
                  {localServerUrl ? 'URL configured' : 'No URL (local models disabled)'}
                </div>
                <p className={styles.hint}>
                  ComfyUI or local model server. Supports ngrok tunnels.
                </p>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>GPU Status</label>
                {gpuLoading ? (
                  <p className={styles.hint}>Checking GPU...</p>
                ) : gpuInfo ? (
                  <div className={styles.infoCard}>
                    <div className={styles.status}>
                      <span className={`${styles.dot} ${gpuInfo.available ? styles.dotOk : styles.dotEmpty}`} />
                      {gpuInfo.available ? (gpuInfo.name ?? 'GPU available') : 'No GPU detected'}
                    </div>
                    {gpuInfo.available && gpuInfo.vram_total && (
                      <p className={styles.hint}>
                        VRAM: {gpuInfo.vram_used ?? '?'} / {gpuInfo.vram_total}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className={styles.hint}>Unable to check GPU status</p>
                )}
                <button className={styles.refreshBtn} onClick={fetchGpuInfo} disabled={gpuLoading}>
                  Refresh
                </button>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Ollama URL</label>
                <input
                  className={styles.input}
                  type="text"
                  placeholder="http://localhost:11434"
                  value={ollamaUrl}
                  onChange={e => setOllamaUrl(e.target.value)}
                />
                <div className={styles.status}>
                  <span className={`${styles.dot} ${ollamaStatus?.ok ? styles.dotOk : ollamaUrl ? styles.dotEmpty : styles.dotEmpty}`} />
                  {ollamaLoading ? 'Checking...' : ollamaStatus?.ok ? `Connected (${ollamaStatus.models?.length ?? 0} models)` : ollamaUrl ? 'Not reachable' : 'No URL configured'}
                </div>
                <p className={styles.hint}>
                  Local Ollama server for running Llama, Mistral, and other open models.
                  <br />
                  <a href="https://ollama.com/" target="_blank" rel="noopener noreferrer" className={styles.link}>
                    Download Ollama &rarr;
                  </a>
                </p>
                <button className={styles.refreshBtn} onClick={checkOllama} disabled={ollamaLoading}>
                  Check Connection
                </button>
              </div>
            </>
          )}

          {/* ===== Defaults Tab ===== */}
          {activeTab === 'defaults' && (
            <>
              <div className={styles.field}>
                <label className={styles.label}>Default Model</label>
                <select
                  className={styles.select}
                  value={model}
                  onChange={e => setModel(e.target.value)}
                >
                  {MODELS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <p className={styles.hint}>
                  Used by all analysis and generation nodes.
                </p>
              </div>

              <div className={styles.field}>
                <label className={styles.label}>Embedding</label>
                <div className={styles.checkRow}>
                  <input
                    type="checkbox"
                    id="embed-check"
                    checked={doEmbed}
                    onChange={e => setDoEmbed(e.target.checked)}
                  />
                  <label htmlFor="embed-check" className={styles.checkLabel}>
                    Include embeddings in analysis
                  </label>
                </div>
              </div>
            </>
          )}

          {/* ===== Paths Tab ===== */}
          {activeTab === 'paths' && (
            <>
              <div className={styles.field}>
                <label className={styles.label}>Shared Root</label>
                <input
                  className={styles.input}
                  type="text"
                  placeholder="C:\path\to\shared"
                  value={sharedPath}
                  onChange={e => setSharedPath(e.target.value)}
                />
                <div className={styles.status}>
                  <span className={`${styles.dot} ${sharedPathExists ? styles.dotOk : styles.dotEmpty}`} />
                  {sharedPathExists ? 'Directory exists' : 'Directory not found'}
                </div>
                <p className={styles.hint}>
                  Root shared directory. Contains Media/, References/, and data/. Saved to .env.
                </p>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button
                    className={styles.refreshBtn}
                    onClick={savePath}
                    disabled={pathSaving || !sharedPath.trim()}
                  >
                    {pathSaving ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    className={styles.refreshBtn}
                    onClick={() => fetch('/api/settings/open-folder', { method: 'POST' })}
                    disabled={!sharedPathExists}
                  >
                    Open in Explorer
                  </button>
                </div>
              </div>
            </>
          )}

          {/* ===== Backend Tab ===== */}
          {activeTab === 'backend' && (
            <>
              <div className={styles.field}>
                <label className={styles.label}>Status</label>
                <div className={styles.status}>
                  <span className={`${styles.dot} ${backendStatus === 'online' ? styles.dotOk : backendStatus === 'cloud' ? styles.dotCloud : styles.dotEmpty}`} />
                  <span>
                    {backendStatus === 'online' && 'Connected'}
                    {backendStatus === 'offline' && 'Disconnected'}
                    {backendStatus === 'cloud' && 'Cloud mode'}
                    {backendStatus === 'unknown' && 'Checking...'}
                  </span>
                </div>
                <p className={styles.hint}>
                  Backend server on port 5101.
                </p>
              </div>

              {backendStatus !== 'cloud' && (
                <div className={styles.field}>
                  <label className={styles.label}>Hard Restart</label>
                  <button
                    className={styles.restartBtn}
                    onClick={hardRestart}
                    disabled={restarting}
                  >
                    {restarting ? 'Restarting...' : 'Hard Restart Backend'}
                  </button>
                  <p className={styles.hint}>
                    Kill and respawn the Python backend process on port 5101.
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  )
}

/* --- Extracted sub-component for API key fields --- */

interface ApiKeyFieldProps {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  statusOk: string
  statusEmpty: string
  hint: string
  linkUrl: string
  linkText: string
}

function ApiKeyField({ label, value, onChange, placeholder, statusOk, statusEmpty, hint, linkUrl, linkText }: ApiKeyFieldProps) {
  return (
    <div className={styles.field}>
      <label className={styles.label}>{label}</label>
      <input
        className={styles.input}
        type="password"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      <div className={styles.status}>
        <span className={`${styles.dot} ${value ? styles.dotOk : styles.dotEmpty}`} />
        {value ? statusOk : statusEmpty}
      </div>
      <p className={styles.hint}>
        {hint}
        <br />
        <a href={linkUrl} target="_blank" rel="noopener noreferrer" className={styles.link}>
          {linkText} &rarr;
        </a>
      </p>
    </div>
  )
}
