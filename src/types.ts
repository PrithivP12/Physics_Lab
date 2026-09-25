import type Matter from 'matter-js'

export type Point = { x: number; y: number }
export type VisionObject = { x: number; y: number; width: number; height: number; label: string; score: number; outline?: Point[] }
export type Power = 'normal' | 'ice' | 'bouncy' | 'trampoline' | 'magnet' | 'gravity' | 'spawner' | 'portalA' | 'portalB'
export type Action = 'none' | 'reverse' | 'left' | 'right' | 'up' | 'spawn' | 'clear' | 'bouncy' | 'slow' | 'fast' | 'teleport' | 'explosion'
export type Spawn = 'ball' | 'cube' | 'heavy' | 'bouncy' | 'burst'
export type Tool = 'select' | 'spawn' | 'draw' | 'manual' | 'edit' | 'target' | 'ruler' | 'angle' | 'calibrate' | 'launcher' | 'force' | 'move'
export type GraphPoint = { t: number; x: number; y: number; vx: number; vy: number; speed: number; ax: number; ay: number; kinetic: number; potential: number; springPotential: number; electricPotential: number; total: number }
export type Motion = GraphPoint & { mass: number; momentum: number; netForce: number; g: number; contact: boolean; normal: Point | null; friction: Point | null; applied: Point | null; springForce: Point | null; electricForce: Point | null; magneticForce: Point | null; charge: number }

export type CollisionRecord = {
  at: number
  ids: [number, number]
  masses: [number, number]
  before: [Point, Point]
  after: [Point, Point]
  totalBefore: Point
  totalAfter: Point
}

export type RotorState = { anchor: Point; mass: number; length: number; lever: number; force: number; theta: number; omega: number; alpha: number; active: boolean; inertia: number; torque: number }

export type Surface = {
  id: string
  a: Point
  b: Point
  body: Matter.Body
  power: Power
  strength: number
  action: Action
  mu: number
  bounce: number
  source: 'scan' | 'draw' | 'manual'
  detectedLabel?: string
  confidence?: number
  detectedEdge?: 'top' | 'right' | 'bottom' | 'left' | 'outline'
}

export type Snapshot = {
  selected: string | null
  surfaces: number
  balls: number
  gravity: string
  gravityValue: string
  paused: boolean
  slow: boolean
  colliders: boolean
  tool: Tool
  spawn: Spawn
  challenge: string
  won: boolean
  score: number
  time: number
  spawned: number
  resets: number
  status: string
  fps: number
  stopwatch: number
  lab: boolean
  bodyId: number | null
  motion: Motion | null
  data: GraphPoint[]
  recording: boolean
  calibrated: boolean
  pxPerUnit: number
  unit: string
  vectors: { velocity: boolean; acceleration: boolean; force: boolean; momentum: boolean }
  trail: boolean
  fbd: boolean
  graph: boolean
  measure: { kind: 'ruler' | 'angle'; a: Point; b: Point } | null
  launcher: { p: Point; angle: number; speed: number } | null
  spring: { anchor: Point; bodyId: number; k: number; mass: number; displacement: number; active: boolean } | null
  collision: CollisionRecord | null
  rotor: RotorState | null
  newton: { mass: number; force: number; duration: number }
  frictionTest: { mu: number; speed: number; startX: number; bodyId: number | null } | null
  momentumTest: { massA: number; massB: number; speedA: number; restitution: number; ids: [number, number] | null }
  fieldMode: 'off' | 'electric' | 'magnetic'
  showEField: boolean
  electricK: number
  magneticB: number
  experiment: string
  experimentResult: string
  experimentValue: number | null
  experimentRunning: boolean
}
