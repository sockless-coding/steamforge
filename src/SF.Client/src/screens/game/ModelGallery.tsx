import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { useLoadedContent } from '../../api/content'
import { setBuildingEnvironment } from '../../game/render/materials'
import { buildingModel } from '../../game/render/models'

/**
 * Dev-only model review: /dev/models?id=<building> shows one building model on a plinth with the game's lights,
 * materials and bloom, slowly turning; without an id, every model in a grid. Gears spin and pistons stroke.
 */
export function ModelGallery() {
  const content = useLoadedContent()
  const [params] = useSearchParams()
  const host = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const parent = host.current!
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.shadowMap.enabled = true
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    renderer.setSize(parent.clientWidth, parent.clientHeight)
    parent.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color('#9ec4dc')
    const pmrem = new THREE.PMREMGenerator(renderer)
    const environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
    setBuildingEnvironment(environment)
    pmrem.dispose()
    scene.add(new THREE.HemisphereLight('#d4e6f2', '#4f5a30', 1.1))
    const sun = new THREE.DirectionalLight('#fff0d0', 3)
    sun.position.set(-30, 40, 20)
    sun.castShadow = true
    sun.shadow.mapSize.set(2048, 2048)
    Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 120 })
    scene.add(sun)
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#5c7a38', roughness: 1 }))
    ground.receiveShadow = true
    scene.add(ground)

    const id = params.get('id')
    const defs = content.bundle.buildings.filter((b) => b.model.parts.length > 0 && (!id || b.id === id))
    const cols = Math.ceil(Math.sqrt(defs.length))
    const spacing = 6.5
    const models = defs.map((def, i) => {
      const m = buildingModel(def.id, def.model)
      const x = id ? 0 : ((i % cols) - (cols - 1) / 2) * spacing
      const z = id ? 0 : (Math.floor(i / cols) - (Math.ceil(defs.length / cols) - 1) / 2) * spacing
      m.group.position.set(x, 0, z)
      scene.add(m.group)
      return m
    })

    const camera = new THREE.PerspectiveCamera(id ? 35 : 40, parent.clientWidth / parent.clientHeight, 0.1, 400)
    const span = id ? Math.max(4, Math.max(...defs[0].size) * 2.2) : cols * spacing * 1.05
    const composer = new EffectComposer(renderer)
    composer.addPass(new RenderPass(scene, camera))
    composer.addPass(new UnrealBloomPass(new THREE.Vector2(256, 256), 0.32, 0.5, 0.88))
    composer.addPass(new OutputPass())

    const yaw0 = Number(params.get('yaw') ?? 0.6)
    const spin = params.get('still') ? 0 : 0.25
    let raf = 0
    let last = performance.now()
    let t = 0
    const frame = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000)
      last = now
      t += dt
      const yaw = yaw0 + t * spin
      camera.position.set(Math.sin(yaw) * span, span * 0.62, Math.cos(yaw) * span)
      camera.lookAt(0, id ? 0.9 : 0, 0)
      for (const m of models) {
        for (const g of m.gears) {
          const s = (g.userData.spin as number) * dt
          if (g.userData.axis === 'x') g.rotation.x += s
          else if (g.userData.axis === 'y') g.rotation.y += s
          else g.rotation.z += s
        }
        for (const b of m.bobs) b.position.y = (b.userData.baseY as number) + (b.userData.bob as number) * (0.5 + 0.5 * Math.sin(t * (b.userData.rate as number)))
      }
      composer.render(dt)
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      composer.dispose()
      setBuildingEnvironment(null)
      environment.dispose()
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [content, params])

  return <div ref={host} style={{ position: 'fixed', inset: 0 }} />
}
