import { useState, useCallback, useRef, useEffect } from 'react'
import { Copy, Check } from 'lucide-react'
import type { CameraState, LensState, LightConfig, CamBookmark, GlbOffset } from '../types'
import { DEFAULT_CAMERA, DEFAULT_LENS, DEFAULT_GLB_ROT, DEFAULT_GLB_OFFSET } from '../types'
import { DEFAULT_LIGHTS, AR_PRESETS, MODEL_PRESETS } from '../constants'
import { generatePrompt, shotType, focalToFov } from '../prompt-utils'
import { useViewport, type SceneRefs } from './Viewport'
import { ViewportOverlay } from './ViewportOverlay'
import { LightPanel, Slider } from './LightPanel'
import { CameraPanel, LensPanel, ModelPanel } from './CameraPanel'
import { Diagram } from './Diagram'
import styles from './NB2Editor.module.css'

interface NB2EditorProps {
  initialConfig?: string
  initialCapturedImage?: string | null
  initialGlbFile?: File | null
  onClose: () => void
  onUpdate: (prompt: string, config: string, captured: string | null) => void
  onGlbFile?: (f: File | null) => void
}

function parseConfig(json?: string) {
  if (!json) return null
  try { const c = JSON.parse(json); return c.version === '1.0' ? c : null } catch { return null }
}

export function NB2Editor({ initialConfig, initialCapturedImage, initialGlbFile, onClose, onUpdate, onGlbFile }: NB2EditorProps) {
  const [cfg] = useState(() => parseConfig(initialConfig))
  const [lights, setLights] = useState<LightConfig[]>(cfg?.lights ?? DEFAULT_LIGHTS)
  const [ambient, setAmbient] = useState(cfg?.ambient ?? 12)
  const [cam, setCam] = useState<CameraState>(cfg?.camera ?? { ...DEFAULT_CAMERA })
  const [lens, setLens] = useState<LensState>(cfg?.lens ?? { ...DEFAULT_LENS })
  const [model, setModel] = useState(cfg?.model?.type === 'custom' ? 'bust' : (cfg?.model?.type ?? 'bust'))
  const [glbName, setGlbName] = useState<string | null>(null)
  const [glbRot, setGlbRot] = useState(cfg?.model?.rotation ?? { ...DEFAULT_GLB_ROT })
  const [glbOffset, setGlbOffset] = useState<GlbOffset>(cfg?.model?.offset ?? { ...DEFAULT_GLB_OFFSET })
  const [clayMode, setClayMode] = useState(true)
  const [pinnedCam, setPinnedCam] = useState<CameraState | null>(cfg?.pin ?? null)
  const [useRef3D, setUseRef3D] = useState(cfg?.mode === '3d_ref')
  const [capturedImg, setCapturedImg] = useState<string | null>(initialCapturedImage ?? null)
  const [frameAR, setFrameAR] = useState<string | null>(cfg?.frameAR ?? null)
  const [camBookmarks, setCamBookmarks] = useState<CamBookmark[]>(cfg?.bookmarks ?? [])
  const [copied, setCopied] = useState(false)
  const [panels, setPanels] = useState({ model: true, key: true, fill: true, rim: true, ambient: true, camera: true, lens: true })
  const fileInputRef = useRef<HTMLInputElement>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()
  const sceneRef = useRef<SceneRefs>({
    renderer: null, scene: null, camera: null, pls: [], helpers: [], subjectGroup: null,
    glbInnerGroup: null, originalMats: new Map(), clayMat: null, basePos: null, baseScale: 1, centerModel: null,
  })

  const { mountRef, loadGLB } = useViewport({
    lights, ambient, cam, lens, model, glbRot, glbOffset, clayMode,
    onCamChange: setCam, sceneRef,
    onGlbLoaded: (name) => { setModel('custom'); setGlbName(name) },
  })

  // Auto-load GLB from previous editor session
  const glbRestoredRef = useRef(false)
  useEffect(() => {
    if (initialGlbFile && cfg?.model?.type === 'custom' && !glbRestoredRef.current) {
      glbRestoredRef.current = true
      loadGLB(initialGlbFile)
    }
  }, [initialGlbFile, cfg, loadGLB])

  const prompt = generatePrompt(lights, ambient, cam, lens, pinnedCam, useRef3D)
  const curShot = shotType(cam.dist, lens.focal)

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const config = JSON.stringify({ version: '1.0', mode: useRef3D ? '3d_ref' : 'text', lights, ambient, camera: cam, lens, pin: pinnedCam, bookmarks: camBookmarks, model: { type: model, glbRef: null, rotation: glbRot, offset: glbOffset }, frameAR })
      onUpdate(prompt, config, capturedImg)
    }, 150)
    return () => clearTimeout(debounceRef.current)
  }, [prompt, lights, ambient, cam, lens, pinnedCam, camBookmarks, model, glbRot, glbOffset, frameAR, useRef3D, capturedImg, onUpdate])

  const upd = useCallback((i: number, v: LightConfig) => setLights(p => p.map((l, j) => j === i ? v : l)), [])
  const togglePanel = useCallback((key: string) => setPanels(p => ({ ...p, [key]: !p[key as keyof typeof p] })), [])

  const setCamFromPanel = useCallback((newCam: CameraState) => {
    setCam({ ...newCam })
    const { camera } = sceneRef.current
    if (camera) {
      const { theta, phi, dist, tx = 0, ty = 0, tz = 0 } = newCam
      camera.position.set(tx + dist * Math.sin(phi) * Math.sin(theta), ty + dist * Math.cos(phi), tz + dist * Math.sin(phi) * Math.cos(theta))
      camera.lookAt(tx, ty, tz)
    }
  }, [])

  const resetCam = useCallback(() => {
    setCamFromPanel({ ...DEFAULT_CAMERA }); setLens({ ...DEFAULT_LENS })
    const { camera } = sceneRef.current
    if (camera) { camera.fov = focalToFov(50); camera.updateProjectionMatrix() }
  }, [setCamFromPanel])

  const captureViewport = useCallback(() => {
    const { renderer, scene, camera } = sceneRef.current
    if (!renderer || !scene || !camera) return
    renderer.render(scene, camera)
    setCapturedImg(renderer.domElement.toDataURL('image/png')); setUseRef3D(true)
  }, [])

  const copyPrompt = useCallback(() => {
    navigator.clipboard.writeText(prompt).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800) }).catch(() => {})
  }, [prompt])

  const loadBookmark = useCallback((bm: CamBookmark) => {
    setCamFromPanel({ ...bm.cam }); setLens({ ...bm.lens })
    const { camera } = sceneRef.current
    if (camera) { camera.fov = focalToFov(bm.lens.focal); camera.updateProjectionMatrix() }
  }, [setCamFromPanel])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'Escape') onClose()
      else if (e.key === ' ') { e.preventDefault(); setPinnedCam(p => p ? null : { ...cam }) }
      else if (e.key === 'c' || e.key === 'C') captureViewport()
      else if (e.key === 'r' || e.key === 'R') resetCam()
      else if (e.key === 'f' || e.key === 'F') setFrameAR(p => { const ids = [null, ...AR_PRESETS.map(a => a.id)]; return ids[(ids.indexOf(p) + 1) % ids.length] })
      else if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); setCamBookmarks(p => [...p, { name: `CAM ${p.length + 1}`, cam: { ...cam }, lens: { ...lens } }]) }
      else if (e.key >= '1' && e.key <= '9') { const i = +e.key - 1; if (i < camBookmarks.length) loadBookmark(camBookmarks[i]) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cam, lens, camBookmarks, onClose, captureViewport, resetCam, loadBookmark])

  return (
    <div className={styles.root}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <button onClick={onClose} className={styles.backBtn}>BACK TO GRAPH</button>
          <span className={styles.title}>NB2 LIGHT DIRECTOR</span>
        </div>
        <div className={styles.headerRight}>
          {MODEL_PRESETS.map(m => (
            <button
              key={m.id}
              title={m.name}
              onClick={() => setModel(m.id)}
              className={`${styles.modelBtn} ${model === m.id ? styles.modelBtnActive : ''}`}
            >{m.name}</button>
          ))}
          <button
            onClick={() => fileInputRef.current?.click()}
            className={`${styles.glbBtn} ${model === 'custom' ? styles.glbBtnActive : ''}`}
          >GLB</button>
          <input ref={fileInputRef} type="file" accept=".glb" className={styles.glbInput}
            onChange={e => { const f = e.target.files?.[0]; if (f) { loadGLB(f); onGlbFile?.(f) } e.target.value = '' }} />
          <button
            onClick={() => { setLights([...DEFAULT_LIGHTS]); setAmbient(12); setModel('bust'); setGlbName(null); setGlbRot({ ...DEFAULT_GLB_ROT }); setGlbOffset({ ...DEFAULT_GLB_OFFSET }); resetCam() }}
            className={styles.resetBtn}
          >RESET</button>
        </div>
      </div>

      <div className={styles.body}>
        {/* Viewport */}
        <div className={styles.viewport}>
          <div ref={mountRef} className={styles.viewportMount} />
          <ViewportOverlay cam={cam} lens={lens} pinnedCam={pinnedCam} useRef3D={useRef3D} frameAR={frameAR}
            camBookmarks={camBookmarks} model={model} glbRot={glbRot} clayMode={clayMode}
            onCapture={captureViewport} onSaveBookmark={() => setCamBookmarks(p => [...p, { name: `CAM ${p.length + 1}`, cam: { ...cam }, lens: { ...lens } }])}
            onLoadBookmark={loadBookmark} onDeleteBookmark={i => setCamBookmarks(p => p.filter((_, j) => j !== i))}
            onTogglePin={() => setPinnedCam(p => p ? null : { ...cam })} onSetFrameAR={setFrameAR}
            onSetClayMode={setClayMode} onSetGlbRot={setGlbRot} />
        </div>

        {/* Sidebar */}
        <div className={styles.sidebar}>
          <div className={styles.diagramWrap}><Diagram lights={lights} camTheta={cam.theta} /></div>
          <div className={styles.panels}>
            {model === 'custom' && <ModelPanel glbName={glbName} glbOffset={glbOffset} onOffsetChange={setGlbOffset} open={panels.model} onToggle={() => togglePanel('model')} />}
            {lights.map((l, i) => (
              <LightPanel key={i} light={l} index={i} onUpdate={upd} open={panels[l.name.toLowerCase() as keyof typeof panels] !== false} onToggle={() => togglePanel(l.name.toLowerCase())} />
            ))}
            <div className={styles.ambientCard}>
              <div
                onClick={() => togglePanel('ambient')}
                className={`${styles.ambientHeader} ${panels.ambient ? styles.ambientHeaderOpen : ''}`}
              >
                <span className={styles.ambientChevron}>{panels.ambient ? '\u25BE' : '\u25B8'}</span>
                <div className={styles.ambientDot} />
                <span className={styles.ambientTitle}>Ambient</span>
              </div>
              {panels.ambient && <Slider label="LEVEL" value={ambient} min={0} max={50} unit="%" onChange={setAmbient} color="#444" />}
            </div>
            <CameraPanel cam={cam} lens={lens} shot={curShot} onCamChange={setCamFromPanel} onResetCam={resetCam} open={panels.camera} onToggle={() => togglePanel('camera')} />
            <LensPanel lens={lens} onChange={setLens} open={panels.lens} onToggle={() => togglePanel('lens')} />
          </div>

          {/* Prompt output */}
          <div className={styles.promptBar}>
            <div className={styles.promptBarHeader}>
              <div className={styles.promptBarLeft}>
                <span className={styles.promptBarLabel}>NB2</span>
                <div className={styles.modeToggle}>
                  {(['TEXT', '3D REF'] as const).map(m => {
                    const active = m === 'TEXT' ? !useRef3D : useRef3D
                    const activeClass = active
                      ? (m === '3D REF' ? styles.modeBtnActive3D : styles.modeBtnActiveText)
                      : ''
                    const sideClass = m === 'TEXT' ? styles.modeBtnLeft : styles.modeBtnRight
                    return (
                      <button
                        key={m}
                        onClick={() => setUseRef3D(m === '3D REF')}
                        className={`${styles.modeBtn} ${sideClass} ${activeClass}`}
                      >{m}</button>
                    )
                  })}
                </div>
              </div>
              <button
                onClick={copyPrompt}
                className={`${styles.copyBtn} ${copied ? styles.copyBtnActive : ''}`}
              >{copied ? <><Check size={8} strokeWidth={2} /> COPIED</> : <><Copy size={8} strokeWidth={2} /> COPY</>}</button>
            </div>
            {useRef3D && capturedImg && (
              <div className={styles.dualHint}>
                <img src={capturedImg} className={styles.dualThumb} />
                <div>
                  <div className={styles.dualLabel}>DUAL INPUT MODE</div>
                  <div className={styles.dualDesc}>Input 1: subject photo / Input 2: 3D reference</div>
                </div>
              </div>
            )}
            <div className={styles.promptBox}>{prompt}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
