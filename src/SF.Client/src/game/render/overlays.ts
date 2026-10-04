import * as THREE from 'three'
import type { BuildingDef } from '../../api/types'
import { ghostMaterial } from './materials'
import { buildingModel, entranceArrowGeometry } from './models'
import type { TerrainLayer } from './terrain'

export interface TileMark {
  x: number
  y: number
  ok: boolean
  /** Pressure (0-1): shades the mark from red through amber to green instead of using ok. */
  head?: number
}

const OK = new THREE.Color('#8ae07a')
const BAD = new THREE.Color('#ff5a40')
const INFO = new THREE.Color('#f6d98a')
const AMBER = new THREE.Color('#f0a040')
const shade = new THREE.Color()

/** A building's reach drawn on the ground: centre and radius in tiles. Faint rings show other buildings' cover. */
export interface AreaRing {
  x: number
  y: number
  radius: number
  color: string
  faint?: boolean
}

/** A tile inside a selected building's reach, tinted like its ring. */
export interface AreaTile {
  x: number
  y: number
  color: string
}

const RING_SEGMENTS = 160
const RING_WIDTH = 0.16
const MAX_RINGS = 64

/** Rings that follow the ground, drawn as flat ribbons on a fixed pool of meshes. */
class RingSet {
  readonly group = new THREE.Group()
  private readonly terrain: TerrainLayer
  private readonly meshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = []

  constructor(terrain: TerrainLayer) {
    this.terrain = terrain
  }

  set(rings: AreaRing[]): void {
    const n = Math.min(rings.length, MAX_RINGS)
    for (let i = 0; i < n; i++) {
      const mesh = this.meshes[i] ?? this.add()
      const r = rings[i]
      this.shape(mesh.geometry, r)
      mesh.material.color.set(r.color)
      mesh.material.opacity = r.faint ? 0.35 : 0.9
      mesh.visible = true
    }
    for (let i = n; i < this.meshes.length; i++) this.meshes[i].visible = false
  }

  private add(): THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array((RING_SEGMENTS + 1) * 2 * 3), 3))
    const index: number[] = []
    for (let s = 0; s < RING_SEGMENTS; s++) {
      const a = s * 2
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    geometry.setIndex(index)
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }))
    mesh.frustumCulled = false
    mesh.renderOrder = 5
    this.meshes.push(mesh)
    this.group.add(mesh)
    return mesh
  }

  private shape(geometry: THREE.BufferGeometry, r: AreaRing): void {
    const pos = geometry.getAttribute('position') as THREE.BufferAttribute
    const inner = Math.max(0, r.radius - RING_WIDTH)
    for (let s = 0; s <= RING_SEGMENTS; s++) {
      const a = (s / RING_SEGMENTS) * Math.PI * 2
      const cos = Math.cos(a)
      const sin = Math.sin(a)
      const ox = r.x + cos * r.radius
      const oy = r.y + sin * r.radius
      const ix = r.x + cos * inner
      const iy = r.y + sin * inner
      pos.setXYZ(s * 2, ox, this.terrain.heightAt(ox, oy) + 0.1, oy)
      pos.setXYZ(s * 2 + 1, ix, this.terrain.heightAt(ix, iy) + 0.1, iy)
    }
    pos.needsUpdate = true
  }

  dispose(): void {
    for (const m of this.meshes) {
      m.geometry.dispose()
      m.material.dispose()
    }
  }
}

/** Red at no pressure, amber at half, green at full. */
function headColor(head: number): THREE.Color {
  const h = Math.max(0, Math.min(1, head))
  return h < 0.5 ? shade.copy(BAD).lerp(AMBER, h * 2) : shade.copy(AMBER).lerp(OK, (h - 0.5) * 2)
}

/**
 * Tool feedback drawn over the world: build ghost, tile highlights (footprints, roads, areas) and reach rings. The
 * selected building's reach (ring plus a faint fill) stays up until the selection changes; the rest is redrawn as the
 * pointer moves.
 */
export class OverlayLayer {
  readonly group = new THREE.Group()
  private readonly terrain: TerrainLayer
  private ghost: THREE.Group | null = null
  private ghostDef = ''
  private ghostValid = true
  private readonly tiles: THREE.InstancedMesh
  private readonly rings: RingSet
  private readonly areaRings: RingSet
  private readonly areaTiles: THREE.InstancedMesh
  private readonly door: THREE.Mesh
  private readonly m = new THREE.Matrix4()

  constructor(terrain: TerrainLayer) {
    this.terrain = terrain
    const quad = new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2)
    this.tiles = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false }), 4096)
    this.tiles.count = 0
    this.tiles.frustumCulled = false
    this.tiles.renderOrder = 4
    this.rings = new RingSet(terrain)
    this.areaRings = new RingSet(terrain)
    this.areaTiles = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.13, depthWrite: false }), 8192)
    this.areaTiles.count = 0
    this.areaTiles.frustumCulled = false
    this.areaTiles.renderOrder = 3
    this.door = new THREE.Mesh(
      entranceArrowGeometry().scale(1.3, 1, 1.3),
      new THREE.MeshBasicMaterial({ color: '#f6d98a', transparent: true, opacity: 0.95, depthWrite: false, depthTest: false, side: THREE.DoubleSide }),
    )
    this.door.visible = false
    this.door.renderOrder = 6
    this.group.add(this.tiles, this.rings.group, this.areaRings.group, this.areaTiles, this.door)
  }

  /** Shows the building ghost at a footprint, tinted by validity. */
  setGhost(def: BuildingDef | null, x: number, y: number, w: number, h: number, rot: number, valid: boolean): void {
    if (!def || def.placement?.variableSize) {
      if (this.ghost) this.ghost.visible = false
      return
    }
    if (this.ghostDef !== def.id) {
      if (this.ghost) this.group.remove(this.ghost)
      this.ghost = buildingModel(def.id, def.model).group
      this.ghost.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.castShadow = false
          o.material = ghostMaterial(valid)
        }
      })
      this.ghostDef = def.id
      this.ghostValid = valid
      this.group.add(this.ghost)
    }
    if (this.ghostValid !== valid) {
      this.ghost!.traverse((o) => {
        if (o instanceof THREE.Mesh) o.material = ghostMaterial(valid)
      })
      this.ghostValid = valid
    }
    const ghost = this.ghost!
    ghost.visible = true
    let sum = 0
    for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) sum += this.terrain.heightAt(tx + 0.5, ty + 0.5)
    ghost.position.set(x + w / 2, sum / (w * h) + 0.02, y + h / 2)
    ghost.rotation.y = (rot * Math.PI) / 2
  }

  setTiles(marks: TileMark[], info = false): void {
    const n = Math.min(marks.length, this.tiles.instanceMatrix.count)
    for (let i = 0; i < n; i++) {
      const t = marks[i]
      this.m.makeTranslation(t.x + 0.5, this.terrain.heightAt(t.x + 0.5, t.y + 0.5) + 0.06, t.y + 0.5)
      this.tiles.setMatrixAt(i, this.m)
      this.tiles.setColorAt(i, t.head !== undefined ? headColor(t.head) : info ? INFO : t.ok ? OK : BAD)
    }
    this.tiles.count = n
    this.tiles.instanceMatrix.needsUpdate = true
    if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true
  }

  /** Arrow on the entrance tile (tile coordinates) pointing into the footprint centred at (cx, cy). */
  setDoor(tileX: number, tileY: number, cx: number, cy: number): void {
    const x = tileX + 0.5
    const y = tileY + 0.5
    this.door.visible = true
    this.door.position.set(x, this.terrain.heightAt(x, y) + 0.1, y)
    this.door.rotation.y = Math.atan2(cx - x, cy - y)
  }

  /** Reach rings for the tool preview (cleared with the rest of the preview). */
  setRings(rings: AreaRing[]): void {
    this.rings.set(rings)
  }

  /** The selected building's reach: rings and the tiles inside them. Empty arrays hide it. */
  setArea(rings: AreaRing[], tiles: AreaTile[]): void {
    this.areaRings.set(rings)
    const n = Math.min(tiles.length, this.areaTiles.instanceMatrix.count)
    for (let i = 0; i < n; i++) {
      const t = tiles[i]
      this.m.makeTranslation(t.x + 0.5, this.terrain.heightAt(t.x + 0.5, t.y + 0.5) + 0.05, t.y + 0.5)
      this.areaTiles.setMatrixAt(i, this.m)
      this.areaTiles.setColorAt(i, shade.set(t.color))
    }
    this.areaTiles.count = n
    this.areaTiles.instanceMatrix.needsUpdate = true
    if (this.areaTiles.instanceColor) this.areaTiles.instanceColor.needsUpdate = true
  }

  clear(): void {
    if (this.ghost) this.ghost.visible = false
    this.tiles.count = 0
    this.rings.set([])
    this.door.visible = false
  }

  dispose(): void {
    this.door.geometry.dispose()
    this.tiles.dispose()
    this.areaTiles.dispose()
    this.rings.dispose()
    this.areaRings.dispose()
  }
}
