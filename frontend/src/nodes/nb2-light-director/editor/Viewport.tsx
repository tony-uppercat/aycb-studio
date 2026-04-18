import { useEffect, useRef, useCallback } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import type { CameraState, LensState, LightConfig, GlbOffset } from '../types'
import { focalToFov, kelvinToRGB, hexToRGB, lightPos } from '../prompt-utils'
import { buildModel, disposeGroup, centerAndScaleGlb } from '../three-helpers'

export interface SceneRefs {
  renderer: THREE.WebGLRenderer | null
  scene: THREE.Scene | null
  camera: THREE.PerspectiveCamera | null
  pls: THREE.PointLight[]
  helpers: THREE.Mesh[]
  subjectGroup: THREE.Group | null
  glbInnerGroup: THREE.Group | null
  originalMats: Map<string, THREE.Material | THREE.Material[]>
  clayMat: THREE.MeshStandardMaterial | null
  basePos: THREE.Vector3 | null
  baseScale: number
  centerModel: ((rot: { x: number; y: number; z: number }) => void) | null
}

interface ViewportProps {
  lights: LightConfig[]
  ambient: number
  cam: CameraState
  lens: LensState
  model: string
  glbRot: { x: number; y: number; z: number }
  glbOffset: GlbOffset
  clayMode: boolean
  onCamChange: (c: CameraState) => void
  sceneRef: React.MutableRefObject<SceneRefs>
  onGlbLoaded: (name: string) => void
}

export function useViewport({
  lights, ambient, cam, lens, model, glbRot, glbOffset, clayMode,
  onCamChange, sceneRef, onGlbLoaded,
}: ViewportProps) {
  const mountRef = useRef<HTMLDivElement>(null)
  const camRef = useRef<CameraState>({ ...cam })
  const mouseRef = useRef({ down: false, x: 0, y: 0, button: 0 })
  const frameRef = useRef(0)
  const gltfLoader = useRef<GLTFLoader | null>(null)
  // Dirty flag — the RAF loop only calls renderer.render() when something
  // actually changed. Every mutator (mouse handlers, light / ambient /
  // focal / model / GLB-related useEffects, resize, loadGLB) flips this
  // to true; the loop clears it after rendering one frame. Before this
  // gate the loop rendered 60 fps unconditionally, burning ~50% CPU on
  // the editor modal even when the scene was perfectly static.
  const needsRenderRef = useRef(true)

  // Keep camRef in sync with external cam changes
  useEffect(() => { camRef.current = { ...cam }; needsRenderRef.current = true }, [cam])

  // ── Scene init ──
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x1a1a1d, 0.03)
    scene.background = new THREE.Color(0x1a1a1d)
    const camera = new THREE.PerspectiveCamera(focalToFov(50), mount.clientWidth / mount.clientHeight, 0.1, 100)
    const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
    renderer.setSize(mount.clientWidth, mount.clientHeight)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.PCFSoftShadowMap
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.3
    mount.appendChild(renderer.domElement)

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(30, 30), new THREE.MeshStandardMaterial({ color: 0x232326, roughness: 0.85, metalness: 0.1 }))
    ground.rotation.x = -Math.PI / 2; ground.position.y = -1.2; ground.receiveShadow = true; scene.add(ground)
    const grid = new THREE.GridHelper(20, 40, 0x2c2c2c, 0x1e1e1e); grid.position.y = -1.19; scene.add(grid)
    const subjectGroup = buildModel('bust'); scene.add(subjectGroup)
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.08); scene.add(ambientLight)

    const pls = [0, 1, 2].map(() => {
      const pl = new THREE.PointLight(0xffffff, 0, 20, 2)
      pl.castShadow = true; pl.shadow.mapSize.set(1024, 1024); pl.shadow.radius = 4; pl.shadow.bias = -0.002
      scene.add(pl); return pl
    })
    const helpers = pls.map(() => {
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 16), new THREE.MeshBasicMaterial())
      scene.add(h); return h
    })

    sceneRef.current = {
      renderer, scene, camera, pls, helpers, subjectGroup,
      glbInnerGroup: null, originalMats: new Map(), clayMat: null,
      basePos: null, baseScale: 1, centerModel: null,
    }

    gltfLoader.current = new GLTFLoader()

    const updCam = () => {
      const { theta, phi, dist, tx, ty, tz } = camRef.current
      camera.position.set(tx + dist * Math.sin(phi) * Math.sin(theta), ty + dist * Math.cos(phi), tz + dist * Math.sin(phi) * Math.cos(theta))
      camera.lookAt(tx, ty, tz)
      needsRenderRef.current = true
    }
    updCam()
    const sync = () => onCamChange({ ...camRef.current })

    const onCtx = (e: MouseEvent) => e.preventDefault()
    mount.addEventListener('contextmenu', onCtx)

    const onDown = (e: MouseEvent) => {
      if (e.target === renderer.domElement) mouseRef.current = { down: true, x: e.clientX, y: e.clientY, button: e.button }
    }
    const onMove = (e: MouseEvent) => {
      if (!mouseRef.current.down) return
      const dx = e.clientX - mouseRef.current.x, dy = e.clientY - mouseRef.current.y
      mouseRef.current.x = e.clientX; mouseRef.current.y = e.clientY
      if (mouseRef.current.button === 2 || mouseRef.current.button === 1 || e.shiftKey) {
        const ps = camRef.current.dist * 0.0018
        const rx = Math.cos(camRef.current.theta), rz = -Math.sin(camRef.current.theta)
        camRef.current.tx -= dx * ps * rx; camRef.current.tz -= dx * ps * rz; camRef.current.ty += dy * ps
      } else {
        camRef.current.theta += dx * 0.008
        camRef.current.phi = Math.max(0.05, Math.min(2.4, camRef.current.phi + dy * 0.005))
      }
      updCam()
    }
    const onUp = () => { mouseRef.current.down = false; sync() }
    const onWheel = (e: WheelEvent) => {
      camRef.current.dist = Math.max(2, Math.min(20, camRef.current.dist + e.deltaY * 0.01)); updCam(); sync()
    }

    mount.addEventListener('mousedown', onDown)
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    mount.addEventListener('wheel', onWheel, { passive: true })

    const animate = () => {
      frameRef.current = requestAnimationFrame(animate)
      if (needsRenderRef.current) {
        renderer.render(scene, camera)
        needsRenderRef.current = false
      }
    }
    animate()

    const onResize = () => {
      if (!mount) return
      camera.aspect = mount.clientWidth / mount.clientHeight; camera.updateProjectionMatrix()
      renderer.setSize(mount.clientWidth, mount.clientHeight)
      needsRenderRef.current = true
    }
    window.addEventListener('resize', onResize)

    return () => {
      cancelAnimationFrame(frameRef.current)
      mount.removeEventListener('contextmenu', onCtx)
      mount.removeEventListener('mousedown', onDown); window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp); mount.removeEventListener('wheel', onWheel)
      window.removeEventListener('resize', onResize)
      renderer.dispose(); if (mount.contains(renderer.domElement)) mount.removeChild(renderer.domElement)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ── Update lights ──
  useEffect(() => {
    const { pls: p, helpers: h } = sceneRef.current
    if (!p.length) return
    lights.forEach((l, i) => {
      const pl = p[i], hlp = h[i]
      if (l.on) {
        const [x, y, z] = lightPos(l.azimuth, l.elevation)
        pl.position.set(x, y, z)
        const rgb = l.useGel ? hexToRGB(l.gelColor) : kelvinToRGB(l.kelvin)
        pl.color.setRGB(rgb[0], rgb[1], rgb[2])
        pl.intensity = (l.intensity / 100) * 5.5
        pl.shadow.radius = 1 + (l.softness / 100) * 12
        hlp.position.copy(pl.position);
        (hlp.material as THREE.MeshBasicMaterial).color.setRGB(rgb[0], rgb[1], rgb[2])
        hlp.visible = true; pl.visible = true
      } else { pl.visible = false; hlp.visible = false }
    })
    needsRenderRef.current = true
  }, [lights, sceneRef])

  // ── Update ambient ──
  useEffect(() => {
    const { scene } = sceneRef.current
    if (!scene) return
    scene.children.forEach(c => { if ((c as THREE.AmbientLight).isLight && c.type === 'AmbientLight') (c as THREE.AmbientLight).intensity = (ambient / 100) * 0.4 })
    needsRenderRef.current = true
  }, [ambient, sceneRef])

  // ── Update focal length ──
  useEffect(() => {
    const { camera } = sceneRef.current
    if (camera) { camera.fov = focalToFov(lens.focal); camera.updateProjectionMatrix() }
    needsRenderRef.current = true
  }, [lens.focal, sceneRef])

  // ── Swap built-in model ──
  useEffect(() => {
    if (model === 'custom') return
    const { scene, subjectGroup } = sceneRef.current
    if (!scene || !subjectGroup) return
    scene.remove(subjectGroup); disposeGroup(subjectGroup)
    const newGroup = buildModel(model)
    scene.add(newGroup)
    sceneRef.current.subjectGroup = newGroup
    needsRenderRef.current = true
  }, [model, sceneRef])

  // ── GLB rotation ──
  useEffect(() => {
    if (model !== 'custom') return
    sceneRef.current.centerModel?.(glbRot)
    needsRenderRef.current = true
  }, [glbRot, model, sceneRef])

  // ── Clay/texture toggle ──
  useEffect(() => {
    if (model !== 'custom') return
    const { glbInnerGroup, originalMats, clayMat } = sceneRef.current
    if (!glbInnerGroup || !originalMats || !clayMat) return
    glbInnerGroup.traverse(child => {
      const m = child as THREE.Mesh
      if (m.isMesh && m.visible) m.material = clayMode ? clayMat : (originalMats.get(m.uuid) as THREE.Material) || clayMat
    })
    needsRenderRef.current = true
  }, [clayMode, model, sceneRef])

  // ── GLB offset ──
  useEffect(() => {
    if (model !== 'custom') return
    const { subjectGroup, basePos, baseScale } = sceneRef.current
    if (!subjectGroup || !basePos) return
    subjectGroup.position.set(basePos.x + glbOffset.x, basePos.y + glbOffset.y, basePos.z + glbOffset.z)
    subjectGroup.scale.setScalar((baseScale || 1) * glbOffset.s)
    needsRenderRef.current = true
  }, [glbOffset, model, sceneRef])

  // ── Public: load GLB file ──
  const loadGLB = useCallback((file: File) => {
    if (!gltfLoader.current) return
    const reader = new FileReader()
    reader.onload = (e) => {
      gltfLoader.current!.parse(e.target!.result as ArrayBuffer, '', (gltf) => {
        const group = gltf.scene
        group.updateMatrixWorld(true)
        // Remove cameras
        group.traverse(child => { if ((child as THREE.Camera).isCamera && child.parent) child.parent.remove(child) })
        // Visibility: hide bones/helpers, keep largest meshes
        const allMeshes: { mesh: THREE.Mesh; volume: number; isSkinned: boolean }[] = []
        group.traverse(child => {
          if (child.type === 'Bone' || child.type === 'SkeletonHelper' || child.type === 'LineSegments') child.visible = false
          const m = child as THREE.Mesh
          if (m.isMesh && m.geometry) {
            const bb = new THREE.Box3().setFromObject(m)
            const sz = bb.getSize(new THREE.Vector3())
            allMeshes.push({ mesh: m, volume: sz.x * sz.y * sz.z, isSkinned: !!(m as THREE.SkinnedMesh).isSkinnedMesh })
          }
        })
        if (allMeshes.length > 1) {
          allMeshes.sort((a, b) => b.volume - a.volume)
          const lv = allMeshes[0].volume
          allMeshes.forEach(({ mesh, volume, isSkinned }) => {
            const vc = mesh.geometry?.attributes?.position?.count || 0
            mesh.visible = isSkinned || (volume > lv * 0.2 && vc > 100)
          })
        }

        const pivot = new THREE.Group()
        pivot.add(group)
        const cFn = (rot: { x: number; y: number; z: number }) => {
          const res = centerAndScaleGlb(pivot, group, rot)
          sceneRef.current.basePos = res.basePos
          sceneRef.current.baseScale = res.baseScale
        }
        cFn({ x: 0, y: 0, z: 0 })

        const clayMat = new THREE.MeshStandardMaterial({ color: 0xc4b5a0, roughness: 0.42, metalness: 0.05, side: THREE.DoubleSide })
        const originalMats = new Map<string, THREE.Material | THREE.Material[]>()
        group.traverse(child => {
          const m = child as THREE.Mesh
          if (m.isMesh && m.visible) {
            m.castShadow = true; m.receiveShadow = true
            originalMats.set(m.uuid, m.material)
            if (m.material) {
              const mats = Array.isArray(m.material) ? m.material : [m.material]
              mats.forEach(mt => { (mt as THREE.MeshStandardMaterial).side = THREE.DoubleSide })
            }
            m.material = clayMat
          }
        })

        // Replace subject
        const { scene, subjectGroup } = sceneRef.current
        if (scene && subjectGroup) { scene.remove(subjectGroup); disposeGroup(subjectGroup) }
        scene?.add(pivot)
        sceneRef.current.subjectGroup = pivot
        sceneRef.current.centerModel = cFn
        sceneRef.current.glbInnerGroup = group
        sceneRef.current.originalMats = originalMats
        sceneRef.current.clayMat = clayMat

        needsRenderRef.current = true
        onGlbLoaded(file.name.replace(/\.glb$/i, ''))
      }, (err: unknown) => console.error('GLB parse error:', err))
    }
    reader.readAsArrayBuffer(file)
  }, [sceneRef, onGlbLoaded])

  return { mountRef, loadGLB }
}
