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

/** Red at no pressure, amber at half, green at full. */
function headColor(head: number): THREE.Color {
  const h = Math.max(0, Math.min(1, head))
  return h < 0.5 ? shade.copy(BAD).lerp(AMBER, h * 2) : shade.copy(AMBER).lerp(OK, (h - 0.5) * 2)
}

/** Tool feedback drawn over the world: build ghost, tile highlights (footprints, roads, areas) and radius ring. */
export class OverlayLayer {
  readonly group = new THREE.Group()
  private readonly terrain: TerrainLayer
  private ghost: THREE.Group | null = null
  private ghostDef = ''
  private ghostValid = true
  private readonly tiles: THREE.InstancedMesh
  private readonly ring: THREE.Mesh
  private readonly door: THREE.Mesh
  private readonly m = new THREE.Matrix4()

  constructor(terrain: TerrainLayer) {
    this.terrain = terrain
    const quad = new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2)
    this.tiles = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.4, depthWrite: false }), 4096)
    this.tiles.count = 0
    this.tiles.frustumCulled = false
    this.tiles.renderOrder = 4
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.97, 1, 96).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: '#f6d98a', transparent: true, opacity: 0.55, depthWrite: false }),
    )
    this.ring.visible = false
    this.ring.renderOrder = 4
    this.door = new THREE.Mesh(
      entranceArrowGeometry().scale(1.3, 1, 1.3),
      new THREE.MeshBasicMaterial({ color: '#f6d98a', transparent: true, opacity: 0.95, depthWrite: false, depthTest: false, side: THREE.DoubleSide }),
    )
    this.door.visible = false
    this.door.renderOrder = 6
    this.group.add(this.tiles, this.ring, this.door)
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

  setRing(x: number, y: number, radius: number): void {
    this.ring.visible = radius > 0
    if (radius <= 0) return
    this.ring.scale.set(radius, 1, radius)
    this.ring.position.set(x, this.terrain.heightAt(x, y) + 0.12, y)
  }

  clear(): void {
    if (this.ghost) this.ghost.visible = false
    this.tiles.count = 0
    this.ring.visible = false
    this.door.visible = false
  }

  dispose(): void {
    this.door.geometry.dispose()
    this.tiles.dispose()
    this.ring.geometry.dispose()
  }
}
