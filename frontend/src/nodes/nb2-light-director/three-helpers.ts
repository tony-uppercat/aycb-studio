import * as THREE from 'three'

export function buildModel(type: string): THREE.Group {
  const g = new THREE.Group()
  const skin = new THREE.MeshStandardMaterial({ color: 0xc4b5a0, roughness: 0.42, metalness: 0.05 })
  const dark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.7, metalness: 0.3 })
  const paint = new THREE.MeshStandardMaterial({ color: 0x333340, roughness: 0.3, metalness: 0.6 })

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, y: number, opts: Record<string, number> = {}) => {
    const m = new THREE.Mesh(geo, mat)
    m.position.set(opts.x || 0, y, opts.z || 0)
    if (opts.rx) m.rotation.x = opts.rx
    if (opts.ry) m.rotation.y = opts.ry
    if (opts.rz) m.rotation.z = opts.rz
    if (opts.sy) m.scale.y = opts.sy
    if (opts.sx) m.scale.x = opts.sx
    if (opts.sz) m.scale.z = opts.sz
    m.castShadow = true
    m.receiveShadow = true
    g.add(m)
    return m
  }

  switch (type) {
    case 'bust':
      add(new THREE.SphereGeometry(0.55, 64, 64), skin, 0.85)
      add(new THREE.CylinderGeometry(0.2, 0.25, 0.35, 32), skin, 0.22)
      add(new THREE.CylinderGeometry(0.6, 0.55, 1.0, 32), skin, -0.35)
      add(new THREE.CylinderGeometry(0.7, 0.75, 0.35, 32), dark, -1.02)
      break
    case 'head':
      add(new THREE.SphereGeometry(0.85, 64, 64), skin, 0.35)
      add(new THREE.SphereGeometry(0.15, 32, 32), skin, 0.25, { z: 0.78 })
      add(new THREE.SphereGeometry(0.28, 32, 32), skin, -0.1, { z: 0.5 })
      add(new THREE.CylinderGeometry(0.35, 0.4, 0.35, 32), skin, -0.55)
      add(new THREE.CylinderGeometry(0.5, 0.55, 0.2, 32), dark, -0.9)
      break
    case 'figure':
      add(new THREE.SphereGeometry(0.3, 48, 48), skin, 1.75)
      add(new THREE.CylinderGeometry(0.1, 0.13, 0.2, 24), skin, 1.38)
      add(new THREE.CylinderGeometry(0.38, 0.3, 0.85, 32), skin, 0.88)
      add(new THREE.CylinderGeometry(0.3, 0.28, 0.3, 32), skin, 0.28)
      add(new THREE.CylinderGeometry(0.13, 0.11, 1.0, 24), skin, -0.42, { x: -0.13 })
      add(new THREE.CylinderGeometry(0.13, 0.11, 1.0, 24), skin, -0.42, { x: 0.13 })
      add(new THREE.CylinderGeometry(0.08, 0.07, 0.75, 24), skin, 0.7, { x: -0.48, rz: 0.15 })
      add(new THREE.CylinderGeometry(0.08, 0.07, 0.75, 24), skin, 0.7, { x: 0.48, rz: -0.15 })
      add(new THREE.CylinderGeometry(0.45, 0.5, 0.12, 32), dark, -1.14)
      break
    case 'car': {
      add(new THREE.CylinderGeometry(0.8, 0.9, 0.4, 32), paint, -0.65, { sy: 0.5, sz: 2.2 })
      const glassMat = new THREE.MeshStandardMaterial({ color: 0x1a1a28, roughness: 0.08, metalness: 0.95 })
      add(new THREE.SphereGeometry(0.55, 32, 16), glassMat, -0.35, { sy: 0.45, sz: 0.9 })
      const wg = new THREE.CylinderGeometry(0.2, 0.2, 0.08, 24)
      const wheels: [number, number][] = [[-0.65, -0.9], [0.65, -0.9], [-0.65, 0.6], [0.65, 0.6]]
      wheels.forEach(([x, z]) => add(wg, dark, -1.0, { x, z, rz: Math.PI / 2 }))
      add(new THREE.CylinderGeometry(1.2, 1.3, 0.05, 32), dark, -1.15)
      break
    }
    case 'product': {
      const boxMat = new THREE.MeshStandardMaterial({ color: 0xe8e0d4, roughness: 0.3, metalness: 0.02 })
      add(new THREE.BoxGeometry(1.1, 1.5, 0.7), boxMat, -0.15, { ry: 0.2 })
      const labelMat = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.5 })
      add(new THREE.BoxGeometry(0.7, 0.4, 0.01), labelMat, 0, { z: 0.36, ry: 0.2 })
      add(new THREE.CylinderGeometry(0.8, 0.85, 0.08, 32), dark, -1.08)
      break
    }
    case 'sphere':
    default:
      add(new THREE.SphereGeometry(1.0, 128, 128), skin, 0)
      add(new THREE.CylinderGeometry(0.55, 0.6, 0.12, 32), dark, -1.08)
      break
  }
  return g
}

export function disposeGroup(group: THREE.Group) {
  group.traverse(child => {
    if ((child as THREE.Mesh).geometry) (child as THREE.Mesh).geometry.dispose()
    const mat = (child as THREE.Mesh).material
    if (mat) {
      if (Array.isArray(mat)) mat.forEach(m => m.dispose())
      else mat.dispose()
    }
  })
}

export function centerAndScaleGlb(
  pivot: THREE.Group,
  innerGroup: THREE.Group,
  rot: { x: number; y: number; z: number },
): { basePos: THREE.Vector3; baseScale: number } {
  pivot.scale.setScalar(1)
  pivot.position.set(0, 0, 0)
  pivot.updateMatrixWorld(true)
  innerGroup.rotation.set(rot.x * Math.PI / 180, rot.y * Math.PI / 180, rot.z * Math.PI / 180)
  innerGroup.updateMatrixWorld(true)
  const b = new THREE.Box3()
  innerGroup.traverse(child => {
    if ((child as THREE.Mesh).isMesh && child.visible) b.union(new THREE.Box3().setFromObject(child))
  })
  if (b.isEmpty()) b.setFromObject(innerGroup)
  const c = b.getCenter(new THREE.Vector3())
  const s = b.getSize(new THREE.Vector3())
  const maxD = Math.max(s.x, s.y, s.z) || 1
  const sc = 2.0 / maxD
  pivot.scale.setScalar(sc)
  pivot.position.set(-c.x * sc, -b.min.y * sc - 1.2, -c.z * sc)
  pivot.updateMatrixWorld(true)
  return { basePos: pivot.position.clone(), baseScale: sc }
}
