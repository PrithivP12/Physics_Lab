import type { Point } from './types'

type Box = { originX: number; originY: number; width: number; height: number }

function simplify(points: Point[], tolerance: number): Point[] {
  if (points.length < 3) return points
  const first = points[0], last = points[points.length - 1]
  const dx = last.x - first.x, dy = last.y - first.y
  const lengthSquared = dx * dx + dy * dy
  let farthest = 0, maxDistance = 0
  for (let i = 1; i < points.length - 1; i++) {
    const point = points[i]
    const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - first.x) * dx + (point.y - first.y) * dy) / lengthSquared)) : 0
    const distance = Math.hypot(point.x - first.x - t * dx, point.y - first.y - t * dy)
    if (distance > maxDistance) { maxDistance = distance; farthest = i }
  }
  if (maxDistance <= tolerance) return [first, last]
  return [...simplify(points.slice(0, farthest + 1), tolerance).slice(0, -1), ...simplify(points.slice(farthest), tolerance)]
}

/** Make a simple collision outline from the part of the mask around an object. */
export function outlineFromMask(
  data: Float32Array | Uint8Array, maskWidth: number, maskHeight: number, box: Box,
  imageWidth: number, imageHeight: number, mapX: (x: number) => number, mapY: (y: number) => number
): Point[] | undefined {
  const gridWidth = Math.min(192, maskWidth)
  const gridHeight = Math.max(1, Math.round(maskHeight * gridWidth / maskWidth))
  const grid = new Uint8Array(gridWidth * gridHeight)
  for (let y = 0; y < gridHeight; y++) for (let x = 0; x < gridWidth; x++) {
    const mx = Math.min(maskWidth - 1, Math.floor((x + .5) * maskWidth / gridWidth))
    const my = Math.min(maskHeight - 1, Math.floor((y + .5) * maskHeight / gridHeight))
    grid[y * gridWidth + x] = data[my * maskWidth + mx] > (data instanceof Float32Array ? .5 : 127) ? 1 : 0
  }

  const centerX = (box.originX + box.width / 2) / imageWidth * gridWidth
  const centerY = (box.originY + box.height / 2) / imageHeight * gridHeight
  const minX = Math.max(0, Math.floor(box.originX / imageWidth * gridWidth))
  const maxX = Math.min(gridWidth - 1, Math.ceil((box.originX + box.width) / imageWidth * gridWidth))
  const minY = Math.max(0, Math.floor(box.originY / imageHeight * gridHeight))
  const maxY = Math.min(gridHeight - 1, Math.ceil((box.originY + box.height) / imageHeight * gridHeight))
  // Pick a filled pixel near the middle of the detected box to start from.
  let seed = -1, nearest = Infinity
  for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
    const id = y * gridWidth + x
    if (!grid[id]) continue
    const distance = (x - centerX) ** 2 + (y - centerY) ** 2
    if (distance < nearest) { nearest = distance; seed = id }
  }
  if (seed < 0) return undefined

  const component = new Uint8Array(grid.length)
  const queue = new Int32Array(grid.length)
  let head = 0, tail = 1
  queue[0] = seed; component[seed] = 1
  while (head < tail) {
    const id = queue[head++], x = id % gridWidth, y = Math.floor(id / gridWidth)
    for (const next of [x > 0 ? id - 1 : -1, x < gridWidth - 1 ? id + 1 : -1, y > 0 ? id - gridWidth : -1, y < gridHeight - 1 ? id + gridWidth : -1]) {
      if (next >= 0 && grid[next] && !component[next]) { component[next] = 1; queue[tail++] = next }
    }
  }
  const boxArea = Math.max(1, (maxX - minX + 1) * (maxY - minY + 1))
  if (tail < 12 || tail > grid.length * .68 || tail > boxArea * 2.1) return undefined

  type Edge = { x: number; y: number; nextX: number; nextY: number }
  const edges: Edge[] = []
  const add = (x: number, y: number, nextX: number, nextY: number) => edges.push({ x, y, nextX, nextY })
  for (let id = 0; id < component.length; id++) {
    if (!component[id]) continue
    const x = id % gridWidth, y = Math.floor(id / gridWidth)
    if (y === 0 || !component[id - gridWidth]) add(x, y, x + 1, y)
    if (x === gridWidth - 1 || !component[id + 1]) add(x + 1, y, x + 1, y + 1)
    if (y === gridHeight - 1 || !component[id + gridWidth]) add(x + 1, y + 1, x, y + 1)
    if (x === 0 || !component[id - 1]) add(x, y + 1, x, y)
  }
  if (edges.length < 8) return undefined
  // Join the border pieces into loops, then use the largest one.
  const byStart = new Map<string, number[]>()
  edges.forEach((edge, index) => {
    const key = `${edge.x},${edge.y}`
    const options = byStart.get(key) || []
    options.push(index); byStart.set(key, options)
  })
  const used = new Uint8Array(edges.length)
  const loops: Point[][] = []
  for (let start = 0; start < edges.length; start++) {
    if (used[start]) continue
    const path: Point[] = []
    let current = start
    for (let step = 0; step < edges.length; step++) {
      if (used[current]) break
      used[current] = 1
      const edge = edges[current]
      path.push({ x: edge.x, y: edge.y })
      const next = (byStart.get(`${edge.nextX},${edge.nextY}`) || []).find(index => !used[index])
      if (next === undefined) break
      current = next
    }
    if (path.length >= 8) loops.push(path)
  }
  if (!loops.length) return undefined
  const area = (path: Point[]) => Math.abs(path.reduce((sum, point, index) => {
    const next = path[(index + 1) % path.length]
    return sum + point.x * next.y - next.x * point.y
  }, 0))
  const path = loops.sort((a, b) => area(b) - area(a))[0]
  const display = path.map(point => ({
    x: mapX(point.x / gridWidth * imageWidth),
    y: mapY(point.y / gridHeight * imageHeight)
  }))
  display.push(display[0])
  let farthest = 1, maxDistance = 0
  for (let i = 1; i < display.length - 1; i++) {
    const distance = Math.hypot(display[i].x - display[0].x, display[i].y - display[0].y)
    if (distance > maxDistance) { maxDistance = distance; farthest = i }
  }
  let tolerance = 3
  let reduced: Point[] = []
  do {
    reduced = [...simplify(display.slice(0, farthest + 1), tolerance).slice(0, -1), ...simplify(display.slice(farthest), tolerance)]
    tolerance *= 1.4
  } while (reduced.length > 41 && tolerance < 40)
  reduced.pop()
  return reduced.length >= 3 ? reduced : undefined
}
