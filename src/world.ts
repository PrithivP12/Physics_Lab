import Matter from 'matter-js'
import type { Action, CollisionRecord, GraphPoint, Motion, Point, Power, RotorState, Snapshot, Spawn, Surface, Tool, VisionObject } from './types'

const { Bodies, Body, Composite, Engine, Events, Vector } = Matter
type Particle = { x: number; y: number; vx: number; vy: number; life: number; color: string }
type Dynamic = Matter.Body & { kind?: Spawn; tint?: string; charge?: number; lastPortal?: number; lastSwitch?: number; lastSpawn?: number; lastRule?: number }

const colors: Record<Power, string> = {
  normal: '#b9c0c2', ice: '#9cbec7', bouncy: '#d6c48e', trampoline: '#d4a475',
  magnet: '#b6a3bd', gravity: '#ce988d', spawner: '#afc3a0', portalA: '#86b8c2', portalB: '#cc9cae'
}
const gravities: Record<string, number> = { Earth: 9.81, Moon: 1.62, Mars: 3.71, Jupiter: 24.79, 'Zero-G': 0 }
const dirs = ['DOWN', 'LEFT', 'UP', 'RIGHT']
const STEP = 1 / 60
const toMatterForce = (force: number, pxPerUnit: number) => force * pxPerUnit / 1_000_000

function distToLine(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x, dy = b.y - a.y
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)))
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy)
}

export class RealityWorld {
  engine = Engine.create()
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  width = 1
  height = 1
  walls: Matter.Body[] = []
  surfaces: Surface[] = []
  balls: Dynamic[] = []
  particles: Particle[] = []
  selected: string | null = null
  selectedBody: number | null = null
  tool: Tool = 'spawn'
  spawnType: Spawn = 'ball'
  gravityName = 'Earth'
  direction = 'DOWN'
  paused = false
  slow = false
  colliders = true
  lab = false
  pxPerUnit = 100
  calibrated = false
  knownLength = 1
  data: GraphPoint[] = []
  recording = true
  vectors = { velocity: true, acceleration: false, force: false, momentum: false }
  trail = false
  fbd = false
  graph = false
  lastAx = 0
  lastAy = 0
  simTime = 0
  clockZero = 0
  lastSample = 0
  trailPts: Point[] = []
  measure: { kind: 'ruler' | 'angle'; a: Point; b: Point } | null = null
  launcher: { p: Point; angle: number; speed: number } | null = null
  spring: { anchor: Point; bodyId: number; k: number; mass: number; displacement: number; active: boolean; crossings: number[]; lastSign: number } | null = null
  collision: CollisionRecord | null = null
  pendingCollision: [number, number] | null = null
  preStepVelocity = new Map<number, Point>()
  rotor: RotorState | null = null
  newton = { mass: 1, force: 2, duration: .5 }
  controlledForce: { bodyId: number; force: number; until: number; startVx: number } | null = null
  frictionTest: { mu: number; speed: number; startX: number; bodyId: number | null } | null = null
  frictionTrack: Matter.Body | null = null
  momentumTest: { massA: number; massB: number; speedA: number; restitution: number; ids: [number, number] | null } = { massA: 1, massB: 1, speedA: 2, restitution: 1, ids: null }
  fieldMode: 'off' | 'electric' | 'magnetic' = 'off'
  showEField = true
  electricK = 2
  magneticB = 2
  experiment = ''
  experimentResult = ''
  experimentValue: number | null = null
  experimentRunning = false
  experimentAt = 0
  experimentBody: number | null = null
  experimentStart: Point | null = null
  fps = 0
  fpsCount = 0
  fpsAt = 0
  target: Point | null = null
  status = 'POINT YOUR CAMERA AT A DESK'
  challenge = ''
  won = false
  spawned = 0
  resets = 0
  startedAt = Date.now()
  portalUsed = false
  trampUsed = false
  drag: { start: Point; end: Point; handle?: 'a' | 'b'; id?: string; force?: boolean; moveBody?: number } | null = null
  nextId = 1
  raf = 0
  lastTime = 0
  accum = 0
  lastEmit = 0
  lastChaos = 0
  chaos = false
  scanFlash = 0
  gravityFlash = 0
  onChange: (snap: Snapshot) => void

  constructor(canvas: HTMLCanvasElement, onChange: (snap: Snapshot) => void) {
    this.canvas = canvas
    this.ctx = canvas.getContext('2d')!
    this.onChange = onChange
    Events.on(this.engine, 'collisionStart', event => {
      for (const pair of event.pairs) {
        if (this.lab) {
          const a = this.balls.find(b => b === pair.bodyA), b = this.balls.find(b => b === pair.bodyB)
          if (a && b && a.id !== b.id) this.pendingCollision = [a.id, b.id]
        }
        const surface = this.surfaces.find(s => s.body === pair.bodyA || s.body === pair.bodyB)
        if (!surface) continue
        const ball = this.balls.find(b => b === pair.bodyA || b === pair.bodyB)
        if (ball) this.hit(surface, ball)
      }
    })
    this.resize()
    this.updateGravity()
    this.raf = requestAnimationFrame(this.frame)
  }

  snapshot(): Snapshot {
    const elapsed = Math.floor((Date.now() - this.startedAt) / 1000)
    return {
      selected: this.selected, surfaces: this.surfaces.filter(s => s.source === 'scan').length,
      balls: this.balls.length, gravity: `${this.gravityName} / ${this.direction}`,
      gravityValue: gravities[this.gravityName].toFixed(2), paused: this.paused, slow: this.slow,
      colliders: this.colliders, tool: this.tool, spawn: this.spawnType,
      challenge: this.challenge, won: this.won, score: this.score(), time: elapsed,
      spawned: this.spawned, resets: this.resets, status: this.status,
      fps: this.fps, lab: this.lab, bodyId: this.selectedBody, motion: this.motion(), stopwatch: this.simTime - this.clockZero,
      data: [...this.data], recording: this.recording, calibrated: this.calibrated,
      pxPerUnit: this.pxPerUnit, unit: this.calibrated ? 'm' : 'su',
      vectors: { ...this.vectors }, trail: this.trail, fbd: this.fbd, graph: this.graph,
      measure: this.measure, launcher: this.launcher, spring: this.spring && { anchor: this.spring.anchor, bodyId: this.spring.bodyId, k: this.spring.k, mass: this.spring.mass, displacement: this.spring.displacement, active: this.spring.active }, experiment: this.experiment,
      experimentResult: this.experimentResult, experimentValue: this.experimentValue, experimentRunning: this.experimentRunning,
      collision: this.collision, rotor: this.rotor && { ...this.rotor, anchor: { ...this.rotor.anchor } }, newton: { ...this.newton },
      frictionTest: this.frictionTest && { ...this.frictionTest }, momentumTest: { ...this.momentumTest },
      fieldMode: this.fieldMode, showEField: this.showEField, electricK: this.electricK, magneticB: this.magneticB
    }
  }

  emit() { this.onChange(this.snapshot()) }
  setStatus(status: string) { this.status = status; this.emit() }
  getSelected() { return this.surfaces.find(s => s.id === this.selected) || null }
  getBody() { return this.balls.find(b => b.id === this.selectedBody) || null }
  score() { return Math.max(0, 1000 - Math.floor((Date.now() - this.startedAt) / 1000) * 5 - Math.max(0, this.spawned - 1) * 35 - this.resets * 75) }

  resize() {
    const rect = this.canvas.getBoundingClientRect()
    const oldW = this.width, oldH = this.height
    this.width = Math.max(1, rect.width); this.height = Math.max(1, rect.height)
    if (oldW > 10 && oldH > 10 && (Math.abs(oldW - this.width) > 2 || Math.abs(oldH - this.height) > 2)) {
      const hadScan = this.surfaces.some(surface => surface.source === 'scan')
      const sx = this.width / oldW, sy = this.height / oldH
      for (const s of [...this.surfaces]) {
        if (s.source === 'scan') this.removeSurface(s)
        else this.moveSurface(s, { x: s.a.x * sx, y: s.a.y * sy }, { x: s.b.x * sx, y: s.b.y * sy })
      }
      for (const b of this.balls) Body.setPosition(b, { x: b.position.x * sx, y: b.position.y * sy })
      if (this.target) this.target = { x: this.target.x * sx, y: this.target.y * sy }
      if (this.launcher) this.launcher.p = { x: this.launcher.p.x * sx, y: this.launcher.p.y * sy }
      if (this.spring) this.spring.anchor = { x: this.spring.anchor.x * sx, y: this.spring.anchor.y * sy }
      if (this.rotor) this.rotor.anchor = { x: this.rotor.anchor.x * sx, y: this.rotor.anchor.y * sy }
      if (this.frictionTrack) { this.clearApparatus(); this.experimentRunning = false; this.experiment = '' }
      if (this.measure) this.measure = { ...this.measure, a: { x: this.measure.a.x * sx, y: this.measure.a.y * sy }, b: { x: this.measure.b.x * sx, y: this.measure.b.y * sy } }
      this.trailPts = []; this.data = []
      this.calibrated = false; this.pxPerUnit = 100; this.updateGravity()
      if (hadScan) this.status = 'VIEWPORT RESIZED · RESCAN RECOGNIZED OBJECTS'
      this.emit()
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    this.canvas.width = Math.round(this.width * dpr); this.canvas.height = Math.round(this.height * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    Composite.remove(this.engine.world, this.walls)
    const w = this.width, h = this.height
    this.walls = [
      Bodies.rectangle(w / 2, h + 30, w + 100, 60, { isStatic: true }),
      Bodies.rectangle(w / 2, -30, w + 100, 60, { isStatic: true }),
      Bodies.rectangle(-30, h / 2, 60, h + 100, { isStatic: true }),
      Bodies.rectangle(w + 30, h / 2, 60, h + 100, { isStatic: true })
    ]
    Composite.add(this.engine.world, this.walls)
  }

  addSurface(a: Point, b: Point, source: Surface['source'], detected?: Pick<Surface, 'detectedLabel' | 'confidence' | 'detectedEdge'>) {
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    if (len < (source === 'scan' ? 5 : 18)) return null
    const body = Bodies.rectangle((a.x + b.x) / 2, (a.y + b.y) / 2, len, 12, {
      isStatic: true, angle: Math.atan2(b.y - a.y, b.x - a.x), friction: this.lab ? .35 : .55, restitution: .15
    })
    const surface: Surface = { id: String(this.nextId++), a, b, body, power: 'normal', strength: 5, action: 'none', mu: .35, bounce: .15, source, ...detected }
    this.surfaces.push(surface)
    Composite.add(this.engine.world, body)
    this.emit()
    return surface
  }

  moveSurface(surface: Surface, a: Point, b: Point) {
    if (Math.hypot(b.x - a.x, b.y - a.y) < 18) return
    Composite.remove(this.engine.world, surface.body)
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    surface.a = a; surface.b = b
    surface.body = Bodies.rectangle((a.x + b.x) / 2, (a.y + b.y) / 2, len, 12, {
      isStatic: true, angle: Math.atan2(b.y - a.y, b.x - a.x), friction: this.lab ? surface.mu : surface.power === 'ice' ? .005 : .55,
      restitution: this.lab ? surface.bounce : surface.power === 'bouncy' ? 1.2 : .15
    })
    Composite.add(this.engine.world, surface.body)
  }

  replaceScan(objects: VisionObject[]) {
    for (const surface of [...this.surfaces]) if (surface.source === 'scan') this.removeSurface(surface)
    for (const object of objects) {
      const { x, y, width, height, label, score } = object
      if (object.outline && object.outline.length >= 3) {
        object.outline.forEach((point, index) => this.addSurface(point, object.outline![(index + 1) % object.outline!.length], 'scan', {
          detectedLabel: label, confidence: score, detectedEdge: index === 0 ? 'top' : 'outline'
        }))
        continue
      }
      const corners = [
        { x, y }, { x: x + width, y }, { x: x + width, y: y + height }, { x, y: y + height }
      ]
      const edges = ['top', 'right', 'bottom', 'left'] as const
      corners.forEach((corner, index) => this.addSurface(corner, corners[(index + 1) % 4], 'scan', {
        detectedLabel: label, confidence: score, detectedEdge: edges[index]
      }))
    }
    this.scanFlash = 1
    this.status = objects.length ? `${objects.length} OBJECT${objects.length === 1 ? '' : 'S'} LOADED · ${objects.filter(object => object.outline).length} SILHOUETTE${objects.filter(object => object.outline).length === 1 ? '' : 'S'} TRACED` : 'NO RECOGNIZED OBJECTS · TRY ANOTHER PHOTO OR MANUAL SURFACE'
    this.emit()
  }

  removeSurface(surface: Surface) {
    Composite.remove(this.engine.world, surface.body)
    this.surfaces = this.surfaces.filter(s => s !== surface)
    if (this.selected === surface.id) this.selected = null
  }

  setPower(power: Power) {
    const s = this.getSelected(); if (!s) return
    if (power === 'portalA' || power === 'portalB') {
      for (const other of this.surfaces) if (other !== s && other.power === power) other.power = 'normal'
    }
    s.power = power
    if (!this.lab) { s.body.friction = power === 'ice' ? .005 : .55; s.body.restitution = power === 'bouncy' ? 1.2 : .15 }
    this.emit()
  }
  setMaterial(mu: number, bounce: number) {
    const s = this.getSelected(); if (!s) return
    s.mu = Math.max(0, Math.min(1, mu)); s.bounce = Math.max(0, Math.min(1, bounce))
    if (this.lab) { s.body.friction = s.mu; s.body.restitution = s.bounce }
    this.emit()
  }
  setLabMode(value: boolean) {
    this.lab = value; this.drag = null; this.tool = 'select'; this.selected = null
    if (!value) { this.spring = null; this.rotor = null; this.fieldMode = 'off'; this.experiment = ''; this.experimentRunning = false; this.clearApparatus() }
    if (value) { this.chaos = false; this.direction = 'DOWN'; this.gravityName = 'Earth'; this.updateGravity() }
    for (const s of this.surfaces) {
      s.body.friction = value ? s.mu : s.power === 'ice' ? .005 : .55
      s.body.restitution = value ? s.bounce : s.power === 'bouncy' ? 1.2 : .15
    }
    for (const b of this.balls) { b.friction = value ? .8 : .035; b.frictionAir = value ? 0 : .001; b.restitution = value ? .1 : b.kind === 'bouncy' ? 1.05 : .46 }
    this.status = value ? 'LAB MODE · MODEL PHYSICS ACTIVE' : 'SANDBOX MODE · OBJECT POWERS ACTIVE'
    this.emit()
  }
  selectBody(id: number | null) { this.selectedBody = id; this.selected = null; this.data = []; this.trailPts = []; this.lastAx = 0; this.lastAy = 0; this.lastSample = this.simTime; this.emit() }
  setMass(mass: number) { const b = this.getBody(); if (b && mass > 0) { const value = Math.min(100, Math.max(.1, mass)); Body.setMass(b, value); if (this.spring?.bodyId === b.id) this.spring.mass = value; this.emit() } }
  setCharge(charge: number) { const b = this.getBody(); if (b) { b.charge = Math.max(-5, Math.min(5, charge)); this.emit() } }
  clearApparatus() {
    if (this.frictionTrack) Composite.remove(this.engine.world, this.frictionTrack)
    this.frictionTrack = null; this.frictionTest = null; this.controlledForce = null; this.pendingCollision = null
  }
  setVector(name: keyof RealityWorld['vectors'], value: boolean) { this.vectors[name] = value; this.emit() }
  setTrail(value: boolean) { this.trail = value; this.emit() }
  setGraph(value: boolean) { this.graph = value; this.emit() }
  setFbd(value: boolean) { this.fbd = value; this.emit() }
  setRecording(value: boolean) { this.recording = value; this.emit() }
  resetStopwatch() { this.clockZero = this.simTime; this.emit() }
  clearData() { this.data = []; this.trailPts = []; this.lastSample = this.simTime; this.emit() }
  setKnownLength(value: number) { this.knownLength = value }
  setLauncher(angle: number, speed: number) {
    if (this.launcher) { this.launcher.angle = Math.max(-89, Math.min(89, angle)); this.launcher.speed = Math.max(.1, Math.min(30, speed)); this.emit() }
  }
  fireLauncher() {
    if (!this.launcher) return
    const { p, angle, speed } = this.launcher
    const b = this.spawnAt(p, 'ball')
    if (!b) return
    const rad = angle * Math.PI / 180
    Body.setVelocity(b, { x: Math.cos(rad) * speed * this.pxPerUnit / 60, y: -Math.sin(rad) * speed * this.pxPerUnit / 60 })
    this.selectBody(b.id); this.trail = true
    this.experimentBody = b.id; this.experimentStart = { ...p }; this.experimentAt = this.simTime
    if (this.experiment === 'projectile') { this.experimentRunning = true; this.paused = false }
    this.status = 'LAUNCHER FIRED'; this.emit()
  }
  prepareSpring(mass = 1, k = 8, displacement = 1.2) {
    this.setLabMode(true); this.clearApparatus(); this.clearBalls(); this.rotor = null; this.fieldMode = 'off'; this.setGravity('Zero-G')
    const anchor = { x: this.width * .42, y: this.height * .5 }
    const b = this.spawnAt({ x: anchor.x + displacement * this.pxPerUnit, y: anchor.y }, 'ball')
    if (!b) return
    Body.setMass(b, mass); b.frictionAir = 0
    this.spring = { anchor, bodyId: b.id, k, mass, displacement, active: false, crossings: [], lastSign: Math.sign(displacement) }
    this.selectBody(b.id); this.paused = true; this.graph = true; this.trail = true
    if (this.experiment !== 'spring') this.experiment = ''
    this.experimentResult = ''; this.experimentValue = null; this.experimentRunning = false
    this.status = 'SPRING READY · SET VALUES, THEN RELEASE'; this.emit()
  }
  setSpringSettings(mass: number, k: number, displacement: number) {
    const s = this.spring, b = s && this.balls.find(b => b.id === s.bodyId)
    if (!s || !b) return
    s.mass = Math.max(.1, Math.min(20, mass)); s.k = Math.max(.1, Math.min(50, k)); s.displacement = Math.max(-2, Math.min(2, displacement))
    Body.setMass(b, s.mass)
    if (!s.active) { Body.setPosition(b, { x: s.anchor.x + s.displacement * this.pxPerUnit, y: s.anchor.y }); Body.setVelocity(b, { x: 0, y: 0 }) }
    this.emit()
  }
  releaseSpring() {
    const s = this.spring, b = s && this.balls.find(b => b.id === s.bodyId)
    if (!s || !b) return
    Body.setPosition(b, { x: s.anchor.x + s.displacement * this.pxPerUnit, y: s.anchor.y })
    Body.setVelocity(b, { x: 0, y: 0 })
    s.active = true; s.crossings = []; s.lastSign = Math.sign(s.displacement) || 1
    this.clearData(); this.paused = false
    if (this.experiment === 'spring') { this.experimentRunning = true; this.experimentResult = ''; this.experimentValue = null; this.experimentAt = this.simTime; this.experimentBody = b.id }
    this.status = 'SPRING OSCILLATING'; this.emit()
  }
  prepareNewton() {
    this.setLabMode(true); this.clearApparatus(); this.clearBalls(); this.spring = null; this.rotor = null; this.fieldMode = 'off'; this.setGravity('Zero-G')
    const b = this.spawnAt({ x: this.width * .28, y: this.height * .35 }, 'ball')
    if (!b) return
    Body.setMass(b, this.newton.mass); Body.setVelocity(b, { x: 0, y: 0 })
    this.selectBody(b.id); this.paused = true; this.graph = true; this.trail = true
    this.experimentBody = b.id; this.status = 'NEWTON TEST READY · PREDICT ACCELERATION'; this.emit()
  }
  setNewtonSettings(mass: number, force: number) {
    this.newton.mass = Math.max(.1, Math.min(20, mass)); this.newton.force = Math.max(.1, Math.min(20, force))
    if (this.experiment === 'newton') { const b = this.balls.find(b => b.id === this.experimentBody); if (b) Body.setMass(b, this.newton.mass) }
    this.emit()
  }
  prepareFriction() {
    const mu = this.frictionTest?.mu ?? .25, speed = this.frictionTest?.speed ?? 3
    this.setLabMode(true); this.clearApparatus(); this.clearBalls(); this.spring = null; this.rotor = null; this.fieldMode = 'off'; this.setGravity('Earth')
    const y = this.height * .68
    this.frictionTrack = Bodies.rectangle(this.width * .5, y, this.width * .76, 12, { isStatic: true, friction: 0, restitution: 0 })
    Composite.add(this.engine.world, this.frictionTrack)
    const b = this.spawnAt({ x: this.width * .24, y: y - 22 }, 'cube')
    if (!b) return
    Body.setMass(b, 1); b.friction = 0; b.restitution = 0; b.frictionAir = 0
    this.frictionTest = { mu, speed, startX: b.position.x, bodyId: b.id }
    this.selectBody(b.id); this.paused = true; this.graph = true; this.trail = true
    this.experimentBody = b.id; this.status = 'FRICTION TRACK READY · PREDICT STOPPING DISTANCE'; this.emit()
  }
  setFrictionSettings(mu: number, speed: number) {
    if (!this.frictionTest) return
    this.frictionTest.mu = Math.max(.01, Math.min(.8, mu)); this.frictionTest.speed = Math.max(.2, Math.min(10, speed))
    this.emit()
  }
  prepareMomentum() {
    this.setLabMode(true); this.clearApparatus(); this.clearBalls(); this.spring = null; this.rotor = null; this.fieldMode = 'off'; this.setGravity('Zero-G')
    const y = this.height * .32
    const a = this.spawnAt({ x: this.width * .39, y }, 'ball'), b = this.spawnAt({ x: this.width * .61, y }, 'ball')
    if (!a || !b) return
    Body.setMass(a, this.momentumTest.massA); Body.setMass(b, this.momentumTest.massB)
    a.restitution = this.momentumTest.restitution; b.restitution = this.momentumTest.restitution
    a.friction = 0; b.friction = 0; a.frictionAir = 0; b.frictionAir = 0
    this.momentumTest.ids = [a.id, b.id]; this.collision = null
    this.selectBody(a.id); this.paused = true; this.graph = true; this.trail = true
    this.status = 'MOMENTUM TEST READY · PREDICT BALL B VELOCITY'; this.emit()
  }
  setMomentumSettings(massA: number, massB: number, speedA: number, restitution: number) {
    this.momentumTest.massA = Math.max(.1, Math.min(10, massA)); this.momentumTest.massB = Math.max(.1, Math.min(10, massB))
    this.momentumTest.speedA = Math.max(.1, Math.min(8, speedA)); this.momentumTest.restitution = restitution >= .5 ? 1 : 0
    const [idA, idB] = this.momentumTest.ids || []
    const a = this.balls.find(b => b.id === idA), b = this.balls.find(b => b.id === idB)
    if (a) { Body.setMass(a, this.momentumTest.massA); a.restitution = this.momentumTest.restitution }
    if (b) { Body.setMass(b, this.momentumTest.massB); b.restitution = this.momentumTest.restitution }
    this.emit()
  }
  prepareRotor() {
    this.setLabMode(true); this.clearApparatus(); this.clearBalls(); this.spring = null; this.fieldMode = 'off'; this.setGravity('Zero-G')
    const mass = this.rotor?.mass ?? 2, length = this.rotor?.length ?? 2.4, lever = this.rotor?.lever ?? .8, force = this.rotor?.force ?? 2
    this.rotor = { anchor: { x: this.width * .52, y: this.height * .47 }, mass, length, lever, force, theta: 0, omega: 0, alpha: 0, active: false, inertia: mass * length * length / 12, torque: lever * force }
    this.paused = true; this.status = 'PINNED BEAM READY · PREDICT ANGULAR ACCELERATION'; this.emit()
  }
  setRotorSettings(mass: number, length: number, lever: number, force: number) {
    if (!this.rotor) return
    const r = this.rotor
    r.mass = Math.max(.2, Math.min(20, mass)); r.length = Math.max(.8, Math.min(4, length))
    r.lever = Math.max(0, Math.min(r.length / 2, lever)); r.force = Math.max(-10, Math.min(10, force))
    r.inertia = r.mass * r.length * r.length / 12; r.torque = r.lever * r.force
    this.emit()
  }
  setRotorActive(active: boolean) { if (this.rotor) { this.rotor.active = active; if (active) this.paused = false; else this.rotor.alpha = 0; this.emit() } }
  resetRotor() { if (this.rotor) { this.rotor.theta = 0; this.rotor.omega = 0; this.rotor.alpha = 0; this.rotor.active = false; this.paused = true; this.emit() } }
  setFieldMode(mode: 'off' | 'electric' | 'magnetic') {
    this.setLabMode(true); this.clearApparatus(); this.spring = null; this.rotor = null
    this.fieldMode = mode; this.experiment = ''; this.experimentRunning = false; this.setGravity(mode === 'off' ? 'Earth' : 'Zero-G')
    this.tool = mode === 'off' ? 'select' : 'move'; this.status = mode === 'electric' ? 'ELECTRIC FIELD · MODEL CHARGES' : mode === 'magnetic' ? 'UNIFORM MAGNETIC FIELD · MODEL CHARGES' : 'MECHANICS LAB'
    this.emit()
  }
  setShowEField(value: boolean) { this.showEField = value; this.emit() }
  setElectricK(value: number) { this.electricK = Math.max(.1, Math.min(10, value)); this.emit() }
  setMagneticB(value: number) { this.magneticB = Math.max(-8, Math.min(8, value)); this.emit() }
  addCharge(charge: number) {
    if (this.fieldMode === 'off') this.setFieldMode('electric')
    const n = this.balls.filter(b => b.charge).length
    const p = { x: this.width * (n % 2 ? .63 : .38), y: this.height * (.38 + Math.floor(n / 2) * .12) }
    const b = this.spawnAt(p, 'ball')
    if (b) { Body.setMass(b, 1); b.charge = charge; this.selectBody(b.id); this.tool = 'move'; this.status = `MODEL CHARGE ${charge > 0 ? '+' : charge < 0 ? '−' : '0'} ADDED`; this.emit() }
  }
  prepareMagneticDemo() {
    this.setFieldMode('magnetic'); this.clearBalls(); this.magneticB = 2
    const b = this.spawnAt({ x: this.width * .48, y: this.height * .55 }, 'ball')
    if (!b) return
    Body.setMass(b, 1); b.charge = 1; b.frictionAir = 0
    Body.setVelocity(b, { x: 2 * this.pxPerUnit / 60, y: 0 })
    this.selectBody(b.id); this.trail = true; this.paused = false
    this.status = 'MAGNETIC ORBIT · F = q(v × B)'; this.emit()
  }
  electricForceOn(body: Dynamic): Point {
    if (this.fieldMode !== 'electric' || !body.charge) return { x: 0, y: 0 }
    let x = 0, y = 0
    for (const other of this.balls) if (other !== body && other.charge) {
      const dx = (body.position.x - other.position.x) / this.pxPerUnit, dy = (body.position.y - other.position.y) / this.pxPerUnit
      const softened = dx * dx + dy * dy + .3 * .3
      const scale = this.electricK * body.charge * other.charge / Math.pow(softened, 1.5)
      x += scale * dx; y += scale * dy
    }
    return { x, y }
  }
  electricFieldAt(p: Point): Point {
    let x = 0, y = 0
    for (const other of this.balls) if (other.charge) {
      const dx = (p.x - other.position.x) / this.pxPerUnit, dy = (p.y - other.position.y) / this.pxPerUnit
      const softened = dx * dx + dy * dy + .3 * .3
      const scale = this.electricK * other.charge / Math.pow(softened, 1.5)
      x += scale * dx; y += scale * dy
    }
    return { x, y }
  }
  electricPotentialOn(body: Dynamic): number {
    if (this.fieldMode !== 'electric' || !body.charge) return 0
    let energy = 0
    for (const other of this.balls) if (other !== body && other.charge) {
      const dx = (body.position.x - other.position.x) / this.pxPerUnit, dy = (body.position.y - other.position.y) / this.pxPerUnit
      energy += this.electricK * body.charge * other.charge / Math.sqrt(dx * dx + dy * dy + .3 * .3)
    }
    return energy
  }
  magneticForceOn(body: Dynamic): Point {
    if (this.fieldMode !== 'magnetic' || !body.charge) return { x: 0, y: 0 }
    const vx = body.velocity.x * 60 / this.pxPerUnit, vy = body.velocity.y * 60 / this.pxPerUnit
    return { x: -body.charge * vy * this.magneticB, y: body.charge * vx * this.magneticB }
  }
  recordCollision() {
    if (!this.pendingCollision) return
    const ids = this.pendingCollision, a = this.balls.find(b => b.id === ids[0]), b = this.balls.find(b => b.id === ids[1])
    this.pendingCollision = null
    if (!a || !b) return
    if (this.experiment === 'momentum' && this.experimentResult) return
    const beforeA = this.preStepVelocity.get(a.id), beforeB = this.preStepVelocity.get(b.id)
    if (!beforeA || !beforeB) return
    const afterA = { x: a.velocity.x * 60 / this.pxPerUnit, y: -a.velocity.y * 60 / this.pxPerUnit }
    const afterB = { x: b.velocity.x * 60 / this.pxPerUnit, y: -b.velocity.y * 60 / this.pxPerUnit }
    const masses: [number, number] = [a.mass, b.mass]
    this.collision = { at: this.simTime, ids, masses, before: [beforeA, beforeB], after: [afterA, afterB],
      totalBefore: { x: masses[0] * beforeA.x + masses[1] * beforeB.x, y: masses[0] * beforeA.y + masses[1] * beforeB.y },
      totalAfter: { x: masses[0] * afterA.x + masses[1] * afterB.x, y: masses[0] * afterA.y + masses[1] * afterB.y } }
    if (this.experiment === 'momentum' && this.experimentRunning && this.momentumTest.ids?.every(id => ids.includes(id))) {
      const bIndex = ids.indexOf(this.momentumTest.ids[1])
      this.experimentValue = this.collision.after[bIndex].x; this.experimentResult = 'BALL B VELOCITY AFTER COLLISION'; this.paused = true
    }
  }
  startExperiment(kind: string) {
    if (kind === 'spring') {
      this.clearApparatus(); this.rotor = null; this.fieldMode = 'off'
      this.prepareSpring()
      this.experiment = 'spring'; this.experimentResult = ''; this.experimentValue = null
      this.status = 'SPRING · PREDICT THE PERIOD'; this.emit(); return
    }
    if (['newton', 'friction', 'momentum', 'torque'].includes(kind)) {
      if (kind === 'newton') this.prepareNewton()
      if (kind === 'friction') this.prepareFriction()
      if (kind === 'momentum') this.prepareMomentum()
      if (kind === 'torque') this.prepareRotor()
      this.experiment = kind; this.experimentResult = ''; this.experimentValue = null; this.experimentRunning = false
      this.experimentAt = this.simTime; this.paused = true; this.emit(); return
    }
    this.setLabMode(true); this.clearApparatus(); this.clearBalls(); this.setGravity('Earth')
    this.spring = null; this.rotor = null; this.fieldMode = 'off'; this.collision = null
    this.experiment = kind; this.experimentResult = ''; this.experimentValue = null
    this.experimentRunning = false; this.paused = true
    this.experimentAt = this.simTime; this.experimentBody = null; this.experimentStart = null
    if (kind === 'projectile') {
      this.launcher = { p: { x: this.width * .17, y: this.height * .72 }, angle: 45, speed: 4 }
      this.status = 'PROJECTILE · SET LAUNCHER AND FIRE'
    } else {
      const p = { x: this.width * (kind === 'fall' ? .16 : .5), y: this.height * .18 }
      const b = this.spawnAt(p, 'ball')
      if (b) { this.selectBody(b.id); this.experimentBody = b.id; this.experimentStart = p; this.experimentAt = this.simTime }
      this.status = kind === 'fall' ? 'FREE FALL · PREDICT HEIGHT AFTER 0.5 S' : 'ENERGY · OBSERVE SPEED ALONG THE PATH'
    }
    this.graph = true; this.trail = true; this.emit()
  }
  runExperiment() {
    if (!this.experiment) return
    if (this.experiment === 'spring') { this.releaseSpring(); return }
    if (this.experiment === 'projectile') { this.fireLauncher(); return }
    if (this.experiment === 'newton') {
      const b = this.balls.find(b => b.id === this.experimentBody)
      if (!b) return
      Body.setVelocity(b, { x: 0, y: 0 }); this.controlledForce = { bodyId: b.id, force: this.newton.force, until: this.simTime + this.newton.duration, startVx: 0 }
    }
    if (this.experiment === 'friction') {
      const b = this.balls.find(b => b.id === this.frictionTest?.bodyId)
      if (!b || !this.frictionTest) return
      this.frictionTest.startX = b.position.x
      Body.setVelocity(b, { x: this.frictionTest.speed * this.pxPerUnit / 60, y: 0 })
    }
    if (this.experiment === 'momentum') {
      const a = this.balls.find(b => b.id === this.momentumTest.ids?.[0]), b = this.balls.find(b => b.id === this.momentumTest.ids?.[1])
      if (!a || !b) return
      this.collision = null; Body.setVelocity(a, { x: this.momentumTest.speedA * this.pxPerUnit / 60, y: 0 }); Body.setVelocity(b, { x: 0, y: 0 })
    }
    if (this.experiment === 'torque') {
      if (!this.rotor) return
      this.rotor.theta = 0; this.rotor.omega = 0; this.rotor.alpha = 0; this.rotor.active = true
    }
    this.experimentResult = ''; this.experimentValue = null
    this.experimentRunning = true; this.experimentAt = this.simTime; this.paused = false
    this.status = 'EXPERIMENT RUNNING'; this.emit()
  }
  captureExperiment() {
    if (!this.experiment || this.experiment === 'spring' || !this.experimentRunning) return
    if (this.experiment === 'torque' && this.rotor) { this.experimentValue = this.rotor.alpha; this.experimentResult = `MEASURED AT ${this.simTime.toFixed(1)} S`; this.emit(); return }
    const m = this.motion(); if (!m || !this.getBody()) return
    this.experimentValue = this.experiment === 'fall' ? m.y : this.experiment === 'projectile' ? Math.abs(m.x - (this.experimentStart?.x || 0) / this.pxPerUnit)
      : this.experiment === 'newton' ? m.ax : this.experiment === 'friction' && this.frictionTest ? (this.getBody()!.position.x - this.frictionTest.startX) / this.pxPerUnit
        : this.experiment === 'momentum' && this.momentumTest.ids ? (this.balls.find(b => b.id === this.momentumTest.ids?.[1])?.velocity.x || 0) * 60 / this.pxPerUnit : m.speed
    this.experimentResult = `MEASURED AT ${this.simTime.toFixed(1)} S`
    this.emit()
  }
  setStrength(n: number) { const s = this.getSelected(); if (s) { s.strength = n; this.emit() } }
  setAction(action: Action) { const s = this.getSelected(); if (s) { s.action = action; this.emit() } }
  setTool(tool: Tool) { this.tool = tool; this.drag = null; this.emit() }
  setSpawn(type: Spawn) { this.spawnType = type; this.tool = 'spawn'; this.emit() }
  setColliders(value: boolean) { this.colliders = value; this.emit() }
  setPaused(value: boolean) { this.paused = value; this.emit() }
  setSlow(value: boolean) { this.slow = value; this.emit() }

  setGravity(name: string) { this.gravityName = name; this.updateGravity(); this.emit() }
  setDirection(dir: string) { this.direction = dir; this.updateGravity(); this.gravityFlash = .7; this.emit() }
  updateGravity() {
    const power = (gravities[this.gravityName] || 0) * this.pxPerUnit / 1000
    const dir = this.direction
    this.engine.gravity.x = dir === 'LEFT' ? -power : dir === 'RIGHT' ? power : 0
    this.engine.gravity.y = dir === 'UP' ? -power : dir === 'DOWN' ? power : 0
  }
  cycleGravity() { this.setDirection(dirs[(dirs.indexOf(this.direction) + 1) % 4]) }

  spawnAt(p: Point, kind: Spawn = this.spawnType, count = true): Dynamic | null {
    if (kind === 'burst') {
      for (let i = 0; i < 10; i++) this.spawnAt({ x: p.x + (Math.random() - .5) * 65, y: p.y + (Math.random() - .5) * 45 }, 'ball', false)
      if (count) this.spawned++
      this.emit(); return null
    }
    if (this.balls.length >= 90) { this.setStatus('OBJECT LIMIT REACHED · CLEAR OBJECTS'); return null }
    const radius = kind === 'heavy' ? 22 : kind === 'bouncy' ? 17 : 15
    const options = { friction: this.lab ? .8 : .035, frictionAir: this.lab ? 0 : .001, restitution: this.lab ? .1 : kind === 'bouncy' ? 1.05 : .46, density: kind === 'heavy' ? .008 : .0015 }
    const body = (kind === 'cube' ? Bodies.rectangle(p.x, p.y, 32, 32, options) : Bodies.circle(p.x, p.y, radius, options)) as Dynamic
    body.kind = kind
    body.tint = kind === 'heavy' ? '#ff9579' : kind === 'bouncy' ? '#ddfb70' : kind === 'cube' ? '#8be4fe' : '#f5f8e8'
    this.balls.push(body); Composite.add(this.engine.world, body)
    if (count) this.spawned++
    this.emit()
    return body
  }

  clearBalls() { Composite.remove(this.engine.world, this.balls); this.balls = []; this.selectedBody = null; this.collision = null; this.momentumTest.ids = null; this.data = []; this.trailPts = []; this.emit() }
  clearDrawn() {
    for (const s of [...this.surfaces]) if (s.source !== 'scan') this.removeSurface(s)
    this.emit()
  }
  undoDrawn() {
    const s = [...this.surfaces].reverse().find(s => s.source !== 'scan')
    if (s) this.removeSurface(s)
    this.emit()
  }
  resetAll() {
    this.clearBalls()
    for (const s of [...this.surfaces]) this.removeSurface(s)
    this.target = null; this.challenge = ''; this.won = false; this.spawned = 0; this.resets = 0
    this.gravityName = 'Earth'; this.direction = 'DOWN'; this.updateGravity()
    this.chaos = false; this.slow = false; this.paused = false; this.tool = this.lab ? 'select' : 'spawn'; this.spawnType = 'ball'; this.colliders = true
    this.graph = false; this.fbd = false; this.trail = false; this.recording = true
    this.vectors = { velocity: true, acceleration: false, force: false, momentum: false }
    this.status = 'WORLD RESET · SCAN OR DRAW A SURFACE'
    this.measure = null; this.launcher = null; this.spring = null; this.experiment = ''; this.experimentResult = ''; this.experimentValue = null; this.experimentRunning = false
    this.clearApparatus(); this.rotor = null; this.fieldMode = 'off'; this.collision = null; this.momentumTest = { massA: 1, massB: 1, speedA: 2, restitution: 1, ids: null }
    this.newton = { mass: 1, force: 2, duration: .5 }; this.showEField = true; this.electricK = 2; this.magneticB = 2
    this.data = []; this.trailPts = []; this.simTime = 0; this.clockZero = 0; this.calibrated = false; this.pxPerUnit = 100; this.updateGravity()
    this.emit()
  }

  resetAttempt() {
    this.clearBalls(); this.won = false; this.spawned = 0; this.resets++; this.portalUsed = false; this.trampUsed = false
    this.startedAt = Date.now(); this.status = 'ATTEMPT RESET · SPAWN AN OBJECT'; this.emit()
  }
  newChallenge() {
    const choices = ['Get any object into the target', 'Reach the target using Moon gravity', 'Use a portal, then reach the target', 'Launch from a trampoline, then reach the target']
    const ready = choices.filter((_, i) => i < 2 || (i === 2 ? this.hasPortals() : this.surfaces.some(s => s.power === 'trampoline')))
    this.challenge = ready[Math.floor(Math.random() * ready.length)]
    if (!this.target) this.target = { x: this.width * .78, y: this.height * .72 }
    if (this.challenge.includes('Moon')) this.setGravity('Moon')
    this.won = false; this.spawned = 0; this.resets = 0; this.portalUsed = false; this.trampUsed = false
    this.startedAt = Date.now(); this.clearBalls(); this.status = 'CHALLENGE STARTED'; this.emit()
  }
  hasPortals() { return this.surfaces.some(s => s.power === 'portalA') && this.surfaces.some(s => s.power === 'portalB') }
  setPreset(name: string) {
    this.chaos = name === 'CHAOS'
    if (name === 'MOON ROOM') this.setGravity('Moon')
    else if (name === 'ZERO-G') this.setGravity('Zero-G')
    else this.setGravity('Earth')
    this.setDirection('DOWN')
    for (const s of this.surfaces) if (name === 'PINBALL' && s.power === 'normal') s.body.restitution = 1.1
    this.status = `${name} PRESET ACTIVE`; this.emit()
  }

  pointerDown(p: Point) {
    if (this.tool === 'spawn') { this.spawnAt(p); return }
    if (this.tool === 'move') {
      const b = [...this.balls].reverse().find(b => Math.hypot(p.x - b.position.x, p.y - b.position.y) < (b.circleRadius || 23) + 10)
      if (b) { this.selectBody(b.id); this.drag = { start: p, end: p, moveBody: b.id }; Body.setVelocity(b, { x: 0, y: 0 }); return }
    }
    if (this.tool === 'target') { this.target = p; this.tool = 'select'; this.setStatus('TARGET PLACED'); return }
    if (this.tool === 'launcher') {
      this.launcher = { p, angle: this.launcher?.angle || 45, speed: this.launcher?.speed || 4 }
      this.tool = 'select'; this.setStatus('LAUNCHER PLACED · SET ANGLE AND SPEED'); return
    }
    if (this.tool === 'draw' || this.tool === 'manual' || this.tool === 'ruler' || this.tool === 'angle' || this.tool === 'calibrate') { this.drag = { start: p, end: p }; return }
    if (this.tool === 'force') {
      const b = this.getBody()
      if (b) { this.drag = { start: { x: b.position.x, y: b.position.y }, end: p, force: true }; return }
    }
    if (this.tool === 'edit') {
      for (const s of this.surfaces) {
        if (Math.hypot(p.x - s.a.x, p.y - s.a.y) < 20) { this.selected = s.id; this.drag = { start: s.a, end: p, id: s.id, handle: 'a' }; this.emit(); return }
        if (Math.hypot(p.x - s.b.x, p.y - s.b.y) < 20) { this.selected = s.id; this.drag = { start: s.b, end: p, id: s.id, handle: 'b' }; this.emit(); return }
      }
    }
    const body = [...this.balls].reverse().find(b => Math.hypot(p.x - b.position.x, p.y - b.position.y) < (b.circleRadius || 23) + 7)
    if (body) { this.selectBody(body.id); return }
    const nearest = this.surfaces.map(s => ({ s, d: distToLine(p, s.a, s.b) })).sort((a, b) => a.d - b.d)[0]
    this.selected = nearest && nearest.d < 22 ? nearest.s.id : null
    if (this.selected) this.selectedBody = null
    this.emit()
  }
  pointerMove(p: Point) {
    if (!this.drag) return
    this.drag.end = p
    if (this.drag.moveBody) {
      const b = this.balls.find(b => b.id === this.drag!.moveBody)
      if (b) { Body.setPosition(b, p); Body.setVelocity(b, { x: 0, y: 0 }) }
      return
    }
    if (this.drag.handle && this.drag.id) {
      const s = this.surfaces.find(s => s.id === this.drag!.id)
      if (s) this.moveSurface(s, this.drag.handle === 'a' ? p : s.a, this.drag.handle === 'b' ? p : s.b)
    }
  }
  pointerUp(p: Point) {
    if (!this.drag) return
    if (this.drag.force || this.drag.moveBody) { this.drag = null; this.emit(); return }
    if (this.tool === 'ruler' || this.tool === 'angle' || this.tool === 'calibrate') {
      const length = Math.hypot(p.x - this.drag.start.x, p.y - this.drag.start.y)
      if (length > 12) {
        this.measure = { kind: this.tool === 'angle' ? 'angle' : 'ruler', a: this.drag.start, b: p }
        if (this.tool === 'calibrate' && this.knownLength > 0) {
          this.pxPerUnit = length / this.knownLength; this.calibrated = true; this.updateGravity()
          this.status = `SCALE CALIBRATED · ${this.pxPerUnit.toFixed(1)} PX/M`
        }
      }
      this.tool = 'select'
    } else if (!this.drag.handle) {
      const s = this.addSurface(this.drag.start, p, this.tool === 'manual' ? 'manual' : 'draw')
      if (s && this.tool === 'manual') { this.selected = s.id; this.tool = 'select'; this.setStatus('MANUAL SURFACE ADDED') }
    }
    this.drag = null; this.emit()
  }

  hit(s: Surface, b: Dynamic) {
    if (this.lab) return
    const now = Date.now()
    const center = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }
    if (s.power === 'trampoline') {
      const force = .012 * b.mass * (s.strength / 5)
      Body.applyForce(b, b.position, { x: 0, y: -force })
      Body.setVelocity(b, { x: b.velocity.x, y: -Math.max(11, 7 + s.strength * 1.6) })
      this.trampUsed = true; this.burst(center, colors.trampoline, 15); this.setStatus('TRAMPOLINE LAUNCH')
    }
    if (s.power === 'gravity' && now - (b.lastSwitch || 0) > 800) {
      this.cycleGravity(); b.lastSwitch = now; this.burst(center, colors.gravity, 18)
    }
    if (s.power === 'spawner' && now - (b.lastSpawn || 0) > 900) {
      b.lastSpawn = now
      for (let i = 0; i < 5; i++) this.spawnAt({ x: center.x + (Math.random() - .5) * 55, y: center.y - 45 - Math.random() * 20 }, 'ball', false)
      this.burst(center, colors.spawner, 16)
    }
    if ((s.power === 'portalA' || s.power === 'portalB') && now - (b.lastPortal || 0) > 850) {
      const other = this.surfaces.find(o => o.power === (s.power === 'portalA' ? 'portalB' : 'portalA'))
      if (other) this.teleport(b, other)
    }
    if (s.action !== 'none' && now - (b.lastRule || 0) > 950) {
      b.lastRule = now; this.runAction(s.action, s, b)
    }
  }

  teleport(b: Dynamic, to: Surface) {
    const x = (to.a.x + to.b.x) / 2, y = (to.a.y + to.b.y) / 2
    const dx = to.b.x - to.a.x, dy = to.b.y - to.a.y, len = Math.hypot(dx, dy) || 1
    const pos = { x: x - dy / len * 42, y: y + dx / len * 42 }
    Body.setPosition(b, pos); Body.setVelocity(b, Vector.mult(b.velocity, 1.05))
    b.lastPortal = Date.now(); this.portalUsed = true
    this.burst(pos, colors[to.power], 22)
    this.setStatus(`PORTAL ${to.power === 'portalA' ? 'B → A' : 'A → B'}`)
  }
  runAction(action: Action, s: Surface, b: Dynamic) {
    if (action === 'reverse') this.setDirection(dirs[(dirs.indexOf(this.direction) + 2) % 4])
    if (action === 'left') this.setDirection('LEFT')
    if (action === 'right') this.setDirection('RIGHT')
    if (action === 'up') this.setDirection('UP')
    if (action === 'spawn') for (let i = 0; i < 5; i++) this.spawnAt({ x: b.position.x + (Math.random() - .5) * 60, y: b.position.y - 50 }, 'ball', false)
    if (action === 'clear') this.clearBalls()
    if (action === 'bouncy') for (const ball of this.balls) ball.restitution = 1.1
    if (action === 'slow') this.setSlow(true)
    if (action === 'fast') this.setSlow(false)
    if (action === 'teleport') {
      const other = this.surfaces.find(o => o !== s && (o.power === 'portalA' || o.power === 'portalB'))
      if (other) this.teleport(b, other)
    }
    if (action === 'explosion') {
      const p = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }
      for (const ball of this.balls) {
        const dx = ball.position.x - p.x, dy = ball.position.y - p.y, d = Math.hypot(dx, dy) || 1
        if (d < 260) Body.applyForce(ball, ball.position, { x: dx / d * .018 * ball.mass * (1 - d / 300), y: dy / d * .018 * ball.mass * (1 - d / 300) })
      }
      this.burst(p, '#fff08a', 26)
    }
  }

  motion(): Motion | null {
    const b = this.getBody()
    if (!b) return null
    const x = b.position.x / this.pxPerUnit
    const y = (this.height - b.position.y) / this.pxPerUnit
    const vx = b.velocity.x * 60 / this.pxPerUnit
    const vy = -b.velocity.y * 60 / this.pxPerUnit
    const speed = Math.hypot(vx, vy)
    const mass = b.mass
    const g = gravities[this.gravityName]
    const kinetic = .5 * mass * speed * speed
    const spring = this.spring?.bodyId === b.id ? this.spring : null
    const springDx = spring ? (b.position.x - spring.anchor.x) / this.pxPerUnit : 0
    const springDy = spring ? (b.position.y - spring.anchor.y) / this.pxPerUnit : 0
    const springPotential = spring ? .5 * spring.k * (springDx * springDx + springDy * springDy) : 0
    const springForce = spring?.active ? { x: -spring.k * springDx, y: -spring.k * springDy } : null
    const electricPotential = this.electricPotentialOn(b)
    const potential = mass * g * Math.max(0, y) + springPotential + electricPotential
    const touching = (this.engine.pairs.list as Matter.Pair[]).find(pair => pair.isActive && (pair.bodyA === b || pair.bodyB === b) && this.surfaces.some(s => s.body === pair.bodyA || s.body === pair.bodyB))
    const s = touching && this.surfaces.find(s => s.body === touching.bodyA || s.body === touching.bodyB)
    const wallPair = !s && (this.engine.pairs.list as Matter.Pair[]).find(pair => pair.isActive && (pair.bodyA === b || pair.bodyB === b) && this.walls.some(w => w === pair.bodyA || w === pair.bodyB))
    const wall = wallPair && this.walls.find(w => w === wallPair.bodyA || w === wallPair.bodyB)
    const trackPair = this.frictionTrack && (this.engine.pairs.list as Matter.Pair[]).find(pair => pair.isActive && (pair.bodyA === b || pair.bodyB === b) && (pair.bodyA === this.frictionTrack || pair.bodyB === this.frictionTrack))
    let normal: Point | null = null, friction: Point | null = null
    if (s) {
      const dx = s.b.x - s.a.x, dy = s.b.y - s.a.y, len = Math.hypot(dx, dy) || 1
      const tx = dx / len, ty = dy / len
      normal = { x: -ty, y: tx }
      const mid = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }
      if ((b.position.x - mid.x) * normal.x + (b.position.y - mid.y) * normal.y < 0) normal = { x: -normal.x, y: -normal.y }
      const along = b.velocity.x * tx + b.velocity.y * ty
      if (Math.abs(along) > .05 && s.mu > 0) friction = { x: -Math.sign(along) * tx, y: -Math.sign(along) * ty }
    }
    if (wall) {
      const index = this.walls.indexOf(wall)
      normal = index === 0 ? { x: 0, y: -1 } : index === 1 ? { x: 0, y: 1 } : index === 2 ? { x: 1, y: 0 } : { x: -1, y: 0 }
      const along = index < 2 ? b.velocity.x : b.velocity.y
      if (Math.abs(along) > .05) friction = index < 2 ? { x: -Math.sign(along), y: 0 } : { x: 0, y: -Math.sign(along) }
    }
    if (trackPair) {
      normal = { x: 0, y: -1 }
      if (Math.abs(b.velocity.x) > .01 && this.frictionTest) friction = { x: -Math.sign(b.velocity.x), y: 0 }
    }
    const applied = this.drag?.force ? { x: this.drag.end.x - this.drag.start.x, y: this.drag.end.y - this.drag.start.y }
      : this.controlledForce?.bodyId === b.id ? { x: this.controlledForce.force, y: 0 } : null
    const electricForce = this.fieldMode === 'electric' && b.charge ? this.electricForceOn(b) : null
    const magneticForce = this.fieldMode === 'magnetic' && b.charge ? this.magneticForceOn(b) : null
    return { t: this.simTime, x, y, vx, vy, speed, ax: this.lastAx, ay: this.lastAy,
      mass, momentum: mass * speed, netForce: mass * Math.hypot(this.lastAx, this.lastAy),
      g, kinetic, potential, springPotential, electricPotential, total: kinetic + potential, contact: !!s || !!wall || !!trackPair,
      normal, friction, applied, springForce, electricForce, magneticForce, charge: b.charge || 0 }
  }

  burst(p: Point, color: string, count: number) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2, speed = 1 + Math.random() * 5
      this.particles.push({ x: p.x, y: p.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 1, color })
    }
    if (this.particles.length > 180) this.particles.splice(0, this.particles.length - 180)
  }

  frame = (time: number) => {
    const dt = Math.min(50, time - (this.lastTime || time)); this.lastTime = time
    if (!this.paused) {
      this.accum += dt * (this.slow ? .35 : 1)
      if (this.chaos && time - this.lastChaos > 2800) { this.lastChaos = time; this.setDirection(dirs[Math.floor(Math.random() * 4)]) }
      let steps = 0
      while (this.accum >= 1000 / 60 && steps < 3) {
        this.preStepVelocity.clear()
        for (const b of this.balls) this.preStepVelocity.set(b.id, { x: b.velocity.x * 60 / this.pxPerUnit, y: -b.velocity.y * 60 / this.pxPerUnit })
        for (const s of this.surfaces) if (!this.lab && s.power === 'magnet') {
          const x = (s.a.x + s.b.x) / 2, y = (s.a.y + s.b.y) / 2
          for (const b of this.balls) {
            const dx = x - b.position.x, dy = y - b.position.y, d = Math.hypot(dx, dy)
            if (d > 20 && d < 240) Body.applyForce(b, b.position, { x: dx / d * b.mass * .0008 * s.strength * (1 - d / 280), y: dy / d * b.mass * .0008 * s.strength * (1 - d / 280) })
          }
        }
        const selected = this.getBody()
        const before = selected ? { x: selected.velocity.x, y: selected.velocity.y } : null
        const beforePosition = selected ? { x: selected.position.x, y: selected.position.y } : null
        if (this.lab && this.drag?.force && selected) {
          const dx = this.drag.end.x - this.drag.start.x, dy = this.drag.end.y - this.drag.start.y
          const len = Math.min(160, Math.hypot(dx, dy))
          if (len > 5) Body.applyForce(selected, selected.position, { x: dx / Math.hypot(dx, dy) * len * .00012, y: dy / Math.hypot(dx, dy) * len * .00012 })
        }
        if (this.lab && this.spring?.active) {
          const springBody = this.balls.find(b => b.id === this.spring!.bodyId)
          if (springBody) Body.applyForce(springBody, springBody.position, {
            x: -this.spring.k * (springBody.position.x - this.spring.anchor.x) / 1_000_000,
            y: -this.spring.k * (springBody.position.y - this.spring.anchor.y) / 1_000_000
          })
        }
        if (this.lab && this.controlledForce && this.simTime < this.controlledForce.until) {
          const b = this.balls.find(b => b.id === this.controlledForce!.bodyId)
          if (b) Body.applyForce(b, b.position, { x: toMatterForce(this.controlledForce.force, this.pxPerUnit), y: 0 })
        }
        if (this.lab && this.experiment === 'friction' && this.experimentRunning && this.frictionTest) {
          const b = this.balls.find(b => b.id === this.frictionTest!.bodyId)
          if (b) {
            const vx = b.velocity.x * 60 / this.pxPerUnit, decel = this.frictionTest.mu * gravities.Earth
            if (vx > decel * STEP) Body.applyForce(b, b.position, { x: -toMatterForce(b.mass * decel, this.pxPerUnit), y: 0 })
            else Body.setVelocity(b, { x: 0, y: b.velocity.y })
          }
        }
        if (this.lab && this.fieldMode === 'electric') for (const b of this.balls) {
          const force = this.electricForceOn(b)
          if (force.x || force.y) Body.applyForce(b, b.position, { x: toMatterForce(force.x, this.pxPerUnit), y: toMatterForce(force.y, this.pxPerUnit) })
        }
        if (this.lab && this.fieldMode === 'magnetic') for (const b of this.balls) if (b.charge && this.magneticB) {
          const angle = b.charge * this.magneticB / b.mass * STEP, c = Math.cos(angle), s = Math.sin(angle)
          Body.setVelocity(b, { x: b.velocity.x * c - b.velocity.y * s, y: b.velocity.x * s + b.velocity.y * c })
        }
        if (this.lab && this.rotor) {
          const r = this.rotor
          r.torque = r.active ? r.lever * r.force : 0
          r.alpha = r.torque / r.inertia
          r.omega += r.alpha * STEP; r.theta += r.omega * STEP
        }
        Engine.update(this.engine, 1000 / 60)
        this.simTime += 1 / 60
        if (this.lab) this.recordCollision()
        if (this.experimentRunning && !this.experimentResult) {
          if (this.experiment === 'newton' && this.controlledForce && this.simTime >= this.controlledForce.until) {
            const b = this.balls.find(b => b.id === this.controlledForce!.bodyId)
            if (b) { this.experimentValue = (b.velocity.x * 60 / this.pxPerUnit - this.controlledForce.startVx) / this.newton.duration; this.experimentResult = `MEAN ACCELERATION OVER ${this.newton.duration.toFixed(1)} S` }
            this.controlledForce = null
          }
          if (this.experiment === 'friction' && this.frictionTest) {
            const b = this.balls.find(b => b.id === this.frictionTest!.bodyId)
            if (b && (Math.abs(b.velocity.x * 60 / this.pxPerUnit) < .04 || this.simTime - this.experimentAt > 5)) {
              this.experimentValue = (b.position.x - this.frictionTest.startX) / this.pxPerUnit
              this.experimentResult = Math.abs(b.velocity.x * 60 / this.pxPerUnit) < .04 ? 'STOPPING DISTANCE' : 'DISTANCE AT 5 S'
            }
          }
          if (this.experiment === 'torque' && this.rotor && this.simTime - this.experimentAt >= .5) {
            this.experimentValue = this.rotor.omega / (this.simTime - this.experimentAt)
            this.experimentResult = 'MEAN ANGULAR ACCELERATION OVER 0.5 S'
            this.rotor.active = false
          }
        }
        if (this.experimentRunning && !this.experimentResult && selected && beforePosition && selected.id === this.experimentBody) {
          if (this.experiment === 'fall' && this.simTime - this.experimentAt >= .5) {
            const end = this.experimentAt + .5
            const fraction = Math.max(0, Math.min(1, (end - (this.simTime - 1 / 60)) * 60))
            const pixelY = beforePosition.y + (selected.position.y - beforePosition.y) * fraction
            this.experimentValue = (this.height - pixelY) / this.pxPerUnit
            this.experimentResult = 'HEIGHT AFTER 0.5 S'
          }
          if (this.experiment === 'projectile' && this.experimentStart && this.simTime - this.experimentAt > .15 && beforePosition.y < this.experimentStart.y && selected.position.y >= this.experimentStart.y && selected.velocity.y > 0) {
            const fraction = (this.experimentStart.y - beforePosition.y) / (selected.position.y - beforePosition.y || 1)
            const pixelX = beforePosition.x + (selected.position.x - beforePosition.x) * fraction
            this.experimentValue = (pixelX - this.experimentStart.x) / this.pxPerUnit
            this.experimentResult = 'RANGE AT LAUNCH HEIGHT'
          }
        }
        if (this.spring?.active) {
          const springBody = this.balls.find(b => b.id === this.spring!.bodyId)
          if (springBody) {
            const sign = Math.sign(springBody.position.x - this.spring.anchor.x)
            if (sign && sign !== this.spring.lastSign && (this.spring.crossings.length === 0 || this.simTime - this.spring.crossings.at(-1)! > .2)) {
              this.spring.crossings.push(this.simTime)
              if (this.experiment === 'spring' && this.experimentRunning && this.spring.crossings.length >= 3 && !this.experimentResult) {
                this.experimentValue = this.spring.crossings.at(-1)! - this.spring.crossings.at(-3)!
                this.experimentResult = 'MEASURED PERIOD · TWO HALF CYCLES'
              }
            }
            if (sign) this.spring.lastSign = sign
          }
        }
        if (selected && before) {
          this.lastAx = (selected.velocity.x - before.x) * 3600 / this.pxPerUnit
          this.lastAy = -(selected.velocity.y - before.y) * 3600 / this.pxPerUnit
        }
        this.accum -= 1000 / 60
        steps++
      }
      if (steps === 3) this.accum = 0
      if (this.lab && this.selectedBody && this.simTime - this.lastSample >= .1) {
        this.lastSample = this.simTime
        const m = this.motion(), b = this.getBody()
        if (m && b) {
          if (this.recording) {
            this.data.push({ t: m.t, x: m.x, y: m.y, vx: m.vx, vy: m.vy, speed: m.speed, ax: m.ax, ay: m.ay, kinetic: m.kinetic, potential: m.potential, springPotential: m.springPotential, electricPotential: m.electricPotential, total: m.total })
            if (this.data.length > 360) this.data.shift()
          }
          if (this.trail) { this.trailPts.push({ x: b.position.x, y: b.position.y }); if (this.trailPts.length > 240) this.trailPts.shift() }
          if (this.experimentRunning && !this.experimentResult && b.id === this.experimentBody) {
            if (this.experiment === 'energy' && b.position.y >= this.height - 55) {
              this.experimentValue = m.speed; this.experimentResult = 'SPEED NEAR FLOOR'; this.emit()
            }
          }
        }
      }
      if (!this.lab && this.target && !this.won) for (const b of this.balls) {
        if (Math.hypot(b.position.x - this.target.x, b.position.y - this.target.y) < 28) {
          const okay = !this.challenge || this.challenge.startsWith('Get') ||
            (this.challenge.includes('Moon') && this.gravityName === 'Moon') ||
            (this.challenge.includes('portal') && this.portalUsed) ||
            (this.challenge.includes('trampoline') && this.trampUsed)
          if (okay) { this.won = true; this.setStatus('SUCCESS · TARGET REACHED'); this.burst(this.target, '#cbff83', 42); break }
        }
      }
    }
    for (const p of this.particles) { p.x += p.vx; p.y += p.vy; p.vy += .06; p.life -= dt / 700 }
    this.particles = this.particles.filter(p => p.life > 0)
    this.scanFlash = Math.max(0, this.scanFlash - dt / 850)
    this.gravityFlash = Math.max(0, this.gravityFlash - dt / 650)
    this.draw(time)
    this.fpsCount++
    if (!this.fpsAt) this.fpsAt = time
    if (time - this.fpsAt >= 1000) { this.fps = Math.round(this.fpsCount * 1000 / (time - this.fpsAt)); this.fpsCount = 0; this.fpsAt = time }
    if (time - this.lastEmit > (this.lab ? 100 : 300)) { this.lastEmit = time; if (this.lab || (this.challenge && !this.won)) this.emit() }
    this.raf = requestAnimationFrame(this.frame)
  }

  draw(time: number) {
    const ctx = this.ctx, w = this.width, h = this.height
    ctx.clearRect(0, 0, w, h)
    if (this.lab && this.fieldMode === 'electric' && this.showEField && this.balls.some(b => b.charge)) {
      ctx.save(); ctx.strokeStyle = '#7fa7a9'; ctx.fillStyle = '#7fa7a9'; ctx.globalAlpha = .56; ctx.lineWidth = 1
      for (let y = 45; y < h - 25; y += 66) for (let x = 45; x < w - 25; x += 66) {
        if (this.balls.some(b => b.charge && Math.hypot(x - b.position.x, y - b.position.y) < 30)) continue
        const e = this.electricFieldAt({ x, y }), mag = Math.hypot(e.x, e.y)
        if (mag < .02) continue
        const len = Math.min(18, 7 + 4 * Math.log1p(mag)), ex = x + e.x / mag * len, ey = y + e.y / mag * len
        const a = Math.atan2(ey - y, ex - x)
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(ex, ey); ctx.moveTo(ex, ey); ctx.lineTo(ex - Math.cos(a - .55) * 5, ey - Math.sin(a - .55) * 5); ctx.moveTo(ex, ey); ctx.lineTo(ex - Math.cos(a + .55) * 5, ey - Math.sin(a + .55) * 5); ctx.stroke()
      }
      ctx.restore()
    }
    if (this.lab && this.fieldMode === 'magnetic' && Math.abs(this.magneticB) > .01) {
      ctx.save(); ctx.fillStyle = '#78969a'; ctx.globalAlpha = .38; ctx.font = '17px monospace'
      for (let y = 65; y < h - 20; y += 80) for (let x = 65; x < w - 20; x += 80) ctx.fillText(this.magneticB > 0 ? '⊙' : '×', x, y)
      ctx.restore()
    }
    if (this.gravityFlash) { ctx.fillStyle = `rgba(229, 167, 89, ${this.gravityFlash * .09})`; ctx.fillRect(0, 0, w, h) }
    if (this.scanFlash) { ctx.strokeStyle = `rgba(255, 255, 255, ${this.scanFlash})`; ctx.lineWidth = 1; ctx.strokeRect(8, 8, w - 16, h - 16) }
    for (const s of this.surfaces) {
      const selected = s.id === this.selected
      const color = selected ? '#f4f4f1' : this.lab ? '#b6b9b8' : colors[s.power]
      ctx.save(); ctx.strokeStyle = color
      ctx.globalAlpha = selected ? 1 : this.colliders ? .86 : .3
      ctx.lineWidth = selected ? 5 : this.colliders ? 3 : 1.5
      ctx.beginPath(); ctx.moveTo(s.a.x, s.a.y); ctx.lineTo(s.b.x, s.b.y); ctx.stroke()
      if (!this.lab && (s.power === 'portalA' || s.power === 'portalB')) {
        const mid = { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2 }
        ctx.globalAlpha = .85; ctx.lineWidth = 1.5
        ctx.beginPath(); ctx.ellipse(mid.x, mid.y, 19 + Math.sin(time / 320) * 2, 11, time / 900, 0, Math.PI * 2); ctx.stroke()
      }
      if (selected || this.tool === 'edit') {
        for (const p of [s.a, s.b]) { ctx.fillStyle = '#171a1a'; ctx.strokeStyle = color; ctx.globalAlpha = 1; ctx.fillRect(p.x - 5, p.y - 5, 10, 10); ctx.strokeRect(p.x - 5, p.y - 5, 10, 10) }
      }
      ctx.restore()
    }
    if (this.lab && this.frictionTrack) {
      const t = this.frictionTrack
      ctx.save(); ctx.strokeStyle = '#b4b8b5'; ctx.lineWidth = 3
      ctx.beginPath(); ctx.moveTo(t.bounds.min.x, t.position.y - 6); ctx.lineTo(t.bounds.max.x, t.position.y - 6); ctx.stroke()
      ctx.fillStyle = '#f4f4f1'; ctx.font = '11px monospace'; ctx.fillText(`MODEL μ = ${(this.frictionTest?.mu || 0).toFixed(2)}`, t.bounds.min.x + 4, t.position.y + 24)
      ctx.restore()
    }
    if (this.lab && this.rotor) {
      const r = this.rotor, len = r.length * this.pxPerUnit, lever = r.lever * this.pxPerUnit
      ctx.save(); ctx.translate(r.anchor.x, r.anchor.y); ctx.rotate(r.theta)
      ctx.fillStyle = '#c6cbc5'; ctx.strokeStyle = '#242727'; ctx.lineWidth = 1
      ctx.fillRect(-len / 2, -8, len, 16); ctx.strokeRect(-len / 2, -8, len, 16)
      ctx.fillStyle = '#f4f4f1'; ctx.beginPath(); ctx.arc(lever, 0, 5, 0, Math.PI * 2); ctx.fill()
      ctx.restore()
      ctx.save(); ctx.fillStyle = '#f4f4f1'; ctx.beginPath(); ctx.arc(r.anchor.x, r.anchor.y, 6, 0, Math.PI * 2); ctx.fill()
      ctx.font = '11px monospace'; ctx.fillText(`θ ${(r.theta * 180 / Math.PI).toFixed(1)}°  ω ${r.omega.toFixed(2)} rad/s`, r.anchor.x - len / 2, r.anchor.y - len / 2 - 28)
      ctx.restore()
      if (r.active) this.arrow({ x: r.anchor.x + Math.cos(r.theta) * lever, y: r.anchor.y + Math.sin(r.theta) * lever }, { x: -Math.sin(r.theta) * r.force, y: Math.cos(r.theta) * r.force }, 44, `F ${Math.abs(r.force).toFixed(1)}`, '#cf9582')
    }
    if (this.trail && this.lab && this.trailPts.length > 1) {
      ctx.save(); ctx.strokeStyle = '#dededb'; ctx.globalAlpha = .5; ctx.lineWidth = 1; ctx.beginPath()
      this.trailPts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke(); ctx.restore()
    }
    if (this.drag && !this.drag.handle && !this.drag.force && !this.drag.moveBody) {
      ctx.save(); ctx.strokeStyle = '#dededb'; ctx.lineWidth = 2; ctx.setLineDash([6, 5])
      ctx.beginPath(); ctx.moveTo(this.drag.start.x, this.drag.start.y); ctx.lineTo(this.drag.end.x, this.drag.end.y); ctx.stroke(); ctx.restore()
    }
    const measure = this.drag && ['ruler', 'angle', 'calibrate'].includes(this.tool) ? { kind: this.tool === 'angle' ? 'angle' as const : 'ruler' as const, a: this.drag.start, b: this.drag.end } : this.measure
    if (measure) {
      const { a, b } = measure, distance = Math.hypot(b.x - a.x, b.y - a.y) / this.pxPerUnit
      const angle = Math.atan2(a.y - b.y, b.x - a.x) * 180 / Math.PI
      ctx.save(); ctx.strokeStyle = '#f4f4f1'; ctx.fillStyle = '#f4f4f1'; ctx.lineWidth = 1
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      for (const p of [a, b]) { ctx.beginPath(); ctx.moveTo(p.x - 5, p.y - 5); ctx.lineTo(p.x + 5, p.y + 5); ctx.moveTo(p.x + 5, p.y - 5); ctx.lineTo(p.x - 5, p.y + 5); ctx.stroke() }
      ctx.font = '11px monospace'; ctx.fillText(measure.kind === 'angle' ? `${angle.toFixed(1)}°` : `${distance.toFixed(2)} ${this.calibrated ? 'm' : 'su'}`, (a.x + b.x) / 2 + 8, (a.y + b.y) / 2 - 9)
      ctx.restore()
    }
    if (this.launcher && this.lab) {
      const { p, angle } = this.launcher, rad = angle * Math.PI / 180
      ctx.save(); ctx.strokeStyle = '#f4f4f1'; ctx.fillStyle = '#f4f4f1'; ctx.lineWidth = 4
      ctx.strokeRect(p.x - 9, p.y - 9, 18, 18)
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x + Math.cos(rad) * 45, p.y - Math.sin(rad) * 45); ctx.stroke()
      ctx.font = '11px monospace'; ctx.fillText(`${angle}°`, p.x + 16, p.y + 20); ctx.restore()
    }
    if (this.spring && this.lab) {
      const b = this.balls.find(ball => ball.id === this.spring!.bodyId)
      if (b) {
        const { x, y } = this.spring.anchor, dx = b.position.x - x, dy = b.position.y - y
        const length = Math.hypot(dx, dy), nx = length ? -dy / length : 0, ny = length ? dx / length : 1
        ctx.save(); ctx.strokeStyle = '#f4f4f1'; ctx.fillStyle = '#f4f4f1'; ctx.lineWidth = 2
        ctx.fillRect(x - 6, y - 11, 6, 22)
        ctx.beginPath(); ctx.moveTo(x, y)
        for (let i = 1; i < 12; i++) {
          const t = i / 12, zig = i % 2 ? 7 : -7
          ctx.lineTo(x + dx * t + nx * zig, y + dy * t + ny * zig)
        }
        ctx.lineTo(b.position.x, b.position.y); ctx.stroke()
        ctx.font = '11px monospace'; ctx.fillText(`k ${this.spring.k.toFixed(1)} kg/s²`, x - 10, y - 20)
        ctx.restore()
      }
    }
    if (this.target) {
      ctx.save(); ctx.translate(this.target.x, this.target.y); ctx.strokeStyle = '#f4f4f1'; ctx.lineWidth = 2
      ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.stroke()
      ctx.beginPath(); ctx.moveTo(-36, 0); ctx.lineTo(36, 0); ctx.moveTo(0, -36); ctx.lineTo(0, 36); ctx.stroke()
      ctx.restore()
    }
    for (const b of this.balls) {
      ctx.save(); ctx.translate(b.position.x, b.position.y); ctx.rotate(b.angle)
      ctx.fillStyle = this.lab ? '#e5e5dc' : b.tint || '#e5e5dc'; ctx.strokeStyle = b.id === this.selectedBody ? '#f4f4f1' : '#303232'; ctx.lineWidth = b.id === this.selectedBody ? 3 : 1
      if (b.kind === 'cube') { ctx.fillRect(-16, -16, 32, 32); ctx.strokeRect(-16, -16, 32, 32) }
      else { const r = b.circleRadius || 15; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.strokeStyle = '#555958'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(r * .75, 0); ctx.stroke() }
      ctx.restore()
      if (this.lab && this.fieldMode !== 'off' && b.charge) {
        ctx.save(); ctx.fillStyle = b.charge > 0 ? '#a85738' : '#3d7781'; ctx.font = 'bold 18px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(b.charge > 0 ? '+' : '−', b.position.x, b.position.y + 1); ctx.restore()
      }
    }
    if (this.lab) {
      const b = this.getBody(), m = this.motion()
      if (b && m) {
        const origin = { x: b.position.x, y: b.position.y }, unit = this.calibrated ? 'm' : 'su'
        if (this.vectors.velocity) this.arrow(origin, { x: m.vx, y: -m.vy }, Math.min(100, m.speed * 12), `v ${m.speed.toFixed(2)} ${unit}/s`, '#f4f4f1')
        if (this.vectors.acceleration) this.arrow(origin, { x: m.ax, y: -m.ay }, Math.min(90, Math.hypot(m.ax, m.ay) * 5), `a ${Math.hypot(m.ax, m.ay).toFixed(2)} ${unit}/s²`, '#b6c5c8')
        if (this.vectors.force) this.arrow(origin, { x: m.ax, y: -m.ay }, Math.min(75, m.netForce * 4), `F ${m.netForce.toFixed(2)}`, '#cf9582')
        if (this.vectors.momentum) this.arrow(origin, { x: m.vx, y: -m.vy }, Math.min(80, m.momentum * 8), `p ${m.momentum.toFixed(2)}`, '#cec7aa')
        if (m.electricForce) this.arrow(origin, m.electricForce, Math.min(80, Math.hypot(m.electricForce.x, m.electricForce.y) * 16), `Fe ${Math.hypot(m.electricForce.x, m.electricForce.y).toFixed(2)}`, '#81bec3')
        if (m.magneticForce) this.arrow(origin, m.magneticForce, Math.min(80, Math.hypot(m.magneticForce.x, m.magneticForce.y) * 16), `FB ${Math.hypot(m.magneticForce.x, m.magneticForce.y).toFixed(2)}`, '#81bec3')
      }
      if (this.drag?.force) this.arrow(this.drag.start, { x: this.drag.end.x - this.drag.start.x, y: this.drag.end.y - this.drag.start.y }, Math.min(140, Math.hypot(this.drag.end.x - this.drag.start.x, this.drag.end.y - this.drag.start.y)), 'APPLIED FORCE', '#cf9582')
    }
    for (const p of this.particles) { ctx.globalAlpha = p.life; ctx.fillStyle = p.color; ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, p.life * 3), 0, Math.PI * 2); ctx.fill() }
    ctx.globalAlpha = 1
  }

  arrow(from: Point, vec: Point, length: number, label: string, color: string) {
    const mag = Math.hypot(vec.x, vec.y)
    if (mag < .01 || length < 5) return
    const x = from.x + vec.x / mag * Math.max(22, length), y = from.y + vec.y / mag * Math.max(22, length)
    const angle = Math.atan2(y - from.y, x - from.x), ctx = this.ctx
    ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2
    ctx.beginPath(); ctx.moveTo(from.x, from.y); ctx.lineTo(x, y); ctx.stroke()
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(angle - .5) * 10, y - Math.sin(angle - .5) * 10)
    ctx.moveTo(x, y); ctx.lineTo(x - Math.cos(angle + .5) * 10, y - Math.sin(angle + .5) * 10); ctx.stroke()
    ctx.font = '10px monospace'; ctx.fillText(label, x + 6, y - 8); ctx.restore()
  }

  destroy() { cancelAnimationFrame(this.raf); Events.off(this.engine, 'collisionStart'); Composite.clear(this.engine.world, false); Engine.clear(this.engine) }
}
