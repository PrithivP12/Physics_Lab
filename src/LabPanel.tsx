import { useState } from 'react'
import type { GraphPoint, Motion, Point, Snapshot } from './types'
import type { RealityWorld } from './world'

type Metric = 'position' | 'velocity' | 'acceleration' | 'energy'
const fmt = (n: number) => Number.isFinite(n) ? n.toFixed(2) : '—'
const signed = (n: number) => `${n >= 0 ? '+' : ''}${fmt(n)}`

function FbdArrow({ vec, label, color, length = 48 }: { vec: Point; label: string; color: string; length?: number }) {
  const mag = Math.hypot(vec.x, vec.y)
  if (!mag) return null
  const x = 100 + vec.x / mag * length, y = 72 + vec.y / mag * length
  const a = Math.atan2(y - 72, x - 100)
  const p1 = `${x},${y}`
  const p2 = `${x - Math.cos(a - .45) * 8},${y - Math.sin(a - .45) * 8}`
  const p3 = `${x - Math.cos(a + .45) * 8},${y - Math.sin(a + .45) * 8}`
  return <g stroke={color} fill={color}><line x1="100" y1="72" x2={x} y2={y} strokeWidth="1.5" /><polygon points={`${p1} ${p2} ${p3}`} /><text x={x + (vec.x >= 0 ? 7 : -30)} y={y + (vec.y >= 0 ? 12 : -5)} fontSize="10" fontFamily="monospace" stroke="none">{label}</text></g>
}

function Fbd({ m, unit }: { m: Motion; unit: string }) {
  return <div className="fbd-box"><div className="plot-title">FREE BODY DIAGRAM <span>MODEL FORCES</span></div>
    <svg viewBox="0 0 200 150" role="img" aria-label="Free body diagram for selected object">
      <line x1="12" y1="132" x2="188" y2="132" stroke="#606564" strokeWidth="1" />
      <circle cx="100" cy="72" r="8" fill="#e6e4db" stroke="#292b2a" strokeWidth="2" />
      {m.g > 0 && <FbdArrow vec={{ x: 0, y: 1 }} label={`mg ${fmt(m.mass * m.g)}`} color="#f1f1ee" />}
      {m.normal && <FbdArrow vec={m.normal} label="N" color="#c5c8c6" />}
      {m.friction && <FbdArrow vec={m.friction} label="f" color="#9caeaf" length={35} />}
      {m.applied && <FbdArrow vec={m.applied} label="F" color="#c98673" />}
      {m.springForce && <FbdArrow vec={{ x: m.springForce.x, y: -m.springForce.y }} label="Fs" color="#d7a768" />}
      {m.electricForce && <FbdArrow vec={m.electricForce} label="Fe" color="#81bec3" />}
      {m.magneticForce && <FbdArrow vec={m.magneticForce} label="FB" color="#81bec3" />}
    </svg>
    <p>Gravity is scaled by the model mass. Contact and friction arrows show direction only; the collision solver does not provide reliable force magnitudes for them. {unit === 'su' ? 'Lengths are simulated units.' : 'Length scale is calibrated.'}</p>
  </div>
}

function GraphPlot({ data, metric, unit, component }: { data: GraphPoint[]; metric: Metric; unit: string; component: 'x' | 'y' }) {
  const [cursor, setCursor] = useState<number | null>(null)
  const series = metric === 'energy' ? [
    { key: 'kinetic' as const, label: 'K', color: '#f1f1ee' },
    { key: 'potential' as const, label: 'U', color: '#9eadae' },
    { key: 'total' as const, label: 'K+U', color: '#e5e5dc' }
  ] : metric === 'position' ? [{ key: component, label: component, color: '#f1f1ee' }]
    : metric === 'velocity' ? [{ key: component === 'x' ? 'vx' as const : 'vy' as const, label: `v${component}`, color: '#f1f1ee' }]
      : [{ key: component === 'x' ? 'ax' as const : 'ay' as const, label: `a${component}`, color: '#f1f1ee' }]
  const t0 = data[0]?.t || 0, t1 = data.at(-1)?.t || t0 + 1
  const minT = t0, maxT = Math.max(t0 + .5, t1)
  const values = data.flatMap(d => series.map(s => d[s.key]))
  let minY = Math.min(0, ...values), maxY = Math.max(0, ...values)
  if (maxY - minY < .01) { minY -= 1; maxY += 1 }
  const left = 39, top = 15, plotW = 250, plotH = 108
  const px = (t: number) => left + (t - minT) / (maxT - minT) * plotW
  const py = (v: number) => top + plotH - (v - minY) / (maxY - minY) * plotH
  const label = metric === 'energy' ? `E (${unit === 'm' ? 'model J' : 'model energy'})` : metric === 'position' ? `${component} (${unit})` : metric === 'velocity' ? `v${component} (${unit}/s)` : `a${component} (${unit}/s²)`
  const hover = cursor == null ? null : data[Math.max(0, Math.min(data.length - 1, cursor))]
  return <div className="graph-box"><div className="plot-title">{label} <span>vs TIME</span></div>
    <svg viewBox="0 0 310 169" role="img" aria-label={`${label} versus time graph`} onMouseMove={e => {
      const rect = e.currentTarget.getBoundingClientRect()
      const x = (e.clientX - rect.left) * 310 / rect.width
      const t = minT + Math.max(0, Math.min(1, (x - left) / plotW)) * (maxT - minT)
      let nearest = 0
      for (let i = 1; i < data.length; i++) if (Math.abs(data[i].t - t) < Math.abs(data[nearest].t - t)) nearest = i
      setCursor(data.length ? nearest : null)
    }} onMouseLeave={() => setCursor(null)}>
      {[0, 1, 2, 3].map(i => <g key={i}><line x1={left} x2={left + plotW} y1={top + i * plotH / 3} y2={top + i * plotH / 3} stroke="#454a49" strokeWidth=".7" /><text x="3" y={top + i * plotH / 3 + 3} fill="#9da4a1" fontSize="9" fontFamily="monospace">{fmt(maxY - i * (maxY - minY) / 3)}</text></g>)}
      <line x1={left} x2={left} y1={top} y2={top + plotH} stroke="#a8aeaa" strokeWidth="1" /><line x1={left} x2={left + plotW} y1={top + plotH} y2={top + plotH} stroke="#a8aeaa" strokeWidth="1" />
      {series.map(s => <polyline key={s.key} fill="none" stroke={s.color} strokeWidth="1.7" points={data.map(d => `${px(d.t)},${py(d[s.key])}`).join(' ')} />)}
      {hover && <line x1={px(hover.t)} x2={px(hover.t)} y1={top} y2={top + plotH} stroke="#d3d4c9" strokeDasharray="3 3" strokeWidth="1" />}
      <text x={left} y="143" fill="#aeb4b0" fontSize="9" fontFamily="monospace">{fmt(minT)}</text><text x={left + plotW - 25} y="143" fill="#aeb4b0" fontSize="9" fontFamily="monospace">{fmt(maxT)}</text><text x="142" y="160" fill="#b9bfba" fontSize="10" fontFamily="monospace">t (s)</text>
    </svg>
    <div className="plot-legend">{series.map(s => <span key={s.key}><i style={{ background: s.color }} />{s.label} {hover ? fmt(hover[s.key]) : ''}</span>)}</div>
  </div>
}

function explain(m: Motion, math: string, unit: string) {
  let text = ''
  if (m.magneticForce) text = 'The uniform magnetic field exerts q(v × B), perpendicular to velocity. In the ideal model it bends the path without changing speed.'
  else if (m.electricForce) text = 'The other model charges create an electric field. The selected charge feels force qE; like charges repel and unlike charges attract.'
  else if (m.springForce) text = 'The spring pulls the mass toward its anchor. Spring energy is greatest at the turning points, while kinetic energy is greatest near the centre.'
  else if (m.applied) text = 'An applied force is changing the object’s momentum. A larger model mass produces less acceleration under the same force.'
  else if (m.contact && m.friction) text = 'The surface pushes on the object. Model friction acts opposite its sliding motion and removes mechanical energy.'
  else if (m.contact) text = 'The surface exerts a normal force perpendicular to the contact. The object’s motion also depends on gravity along the surface.'
  else if (m.g === 0) text = 'With zero model gravity, velocity stays close to constant until a collision or applied force changes it.'
  else if (m.vy < -.1) text = 'The object is descending. Its gravitational potential decreases while kinetic energy can increase.'
  else text = 'Gravity gives the object a downward acceleration. Horizontal velocity changes only when another force or collision acts.'
  if (math === 'algebra') text += m.magneticForce ? '  FB = qvB for v ⟂ B.' : m.electricForce ? '  Fe = qE; |F| ∝ |q₁q₂|/r² outside the softened centre.' : m.springForce ? '  Fs = −kx; Us = ½kx²; T = 2π√(m/k).' : '  Fnet = ma; K = ½mv²; Ug = mgh.'
  if (math === 'calculus') text += m.magneticForce ? '  m dv/dt = q(v × B).' : m.electricForce ? '  m d²r/dt² = qE(r).' : m.springForce ? '  m d²x/dt² = −kx; ω = √(k/m).' : '  v = dr/dt; a = dv/dt; Fnet = dp/dt; W = ∫F·dr.'
  return `${text} Values use ${unit === 'm' ? 'calibrated metres and model kilograms' : 'simulated length units and model kilograms'}.`
}

export default function LabPanel({ snap, world, onClose }: { snap: Snapshot; world: RealityWorld; onClose: () => void }) {
  const [metric, setMetric] = useState<Metric>('velocity')
  const [component, setComponent] = useState<'x' | 'y'>('y')
  const [math, setMath] = useState('conceptual')
  const [showExplain, setShowExplain] = useState(false)
  const m = snap.motion, unit = snap.unit
  function exportCsv() {
    const keys: (keyof GraphPoint)[] = ['t', 'x', 'y', 'vx', 'vy', 'speed', 'ax', 'ay', 'kinetic', 'potential', 'springPotential', 'electricPotential', 'total']
    const csv = [keys.join(','), ...snap.data.map(row => keys.map(k => row[k].toFixed(5)).join(','))].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const link = document.createElement('a'); link.href = url; link.download = 'reality-lab-data.csv'; link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return <aside className="inspector lab-inspector">
    <div className="panel-header"><div><span className="section-kicker">LAB / LIVE DATA</span><strong>{m ? `OBJECT ${String(snap.bodyId).padStart(2, '0')}` : 'NO OBJECT SELECTED'}</strong></div><button onClick={onClose} aria-label="Close lab inspector">×</button></div>
    {!m ? <div className="empty-inspector">Select a virtual ball or cube in the viewport. Measurements appear here while it moves.</div> : <>
      <div className="instrument-note">{snap.calibrated ? `CALIBRATED · ${fmt(snap.pxPerUnit)} PX/M` : 'UNCALIBRATED · 100 PX/SU'}<br />MASS USES MODEL KG</div>
      <div className="readout-grid">
        <span>x</span><b>{signed(m.x)} {unit}</b><span>y</span><b>{signed(m.y)} {unit}</b>
        <span>vx</span><b>{signed(m.vx)} {unit}/s</b><span>vy</span><b>{signed(m.vy)} {unit}/s</b>
        <span>|v|</span><b>{fmt(m.speed)} {unit}/s</b><span>ax</span><b>{signed(m.ax)} {unit}/s²</b>
        <span>ay</span><b>{signed(m.ay)} {unit}/s²</b><span>m</span><b>{fmt(m.mass)} kg*</b>
        <span>|p|</span><b>{fmt(m.momentum)} kg·{unit}/s</b><span>K</span><b>{fmt(m.kinetic)} {unit === 'm' ? 'J*' : 'Eᵤ'}</b>
        <span>Ug</span><b>{fmt(m.potential - m.springPotential - m.electricPotential)} {unit === 'm' ? 'J*' : 'Eᵤ'}</b><span>Us</span><b>{fmt(m.springPotential)} {unit === 'm' ? 'J*' : 'Eᵤ'}</b>
        {snap.fieldMode === 'electric' && <><span>Ue</span><b>{fmt(m.electricPotential)} {unit === 'm' ? 'J*' : 'Eᵤ'}</b></>}
        <span>K+U</span><b>{fmt(m.total)} {unit === 'm' ? 'J*' : 'Eᵤ'}</b>
      </div>
      <div className="panel-section"><span className="section-kicker">MODEL MASS</span><div className="inline-field"><input aria-label="Model mass" type="number" min="0.1" max="100" step="0.1" defaultValue={m.mass.toFixed(2)} key={snap.bodyId || 0} onChange={e => { const n = Number(e.target.value); if (n > 0) world.setMass(n) }} /><span>kg*</span></div></div>
      {snap.fieldMode !== 'off' && <div className="panel-section"><span className="section-kicker">MODEL CHARGE</span><div className="inline-field"><input aria-label="Model charge" type="number" min="-5" max="5" step="0.1" value={m.charge} onChange={e => world.setCharge(Number(e.target.value))} /><span>q*</span></div><p className="panel-note">Charge units and field constants are model values.</p></div>}
      {snap.collision && <div className="panel-section collision-readout"><span className="section-kicker">LAST TWO-BODY COLLISION / t {fmt(snap.collision.at)} S</span><div className="collision-grid"><span></span><b>BEFORE vx</b><b>AFTER vx</b><span>OBJECT {snap.collision.ids[0]}</span><b>{signed(snap.collision.before[0].x)}</b><b>{signed(snap.collision.after[0].x)}</b><span>OBJECT {snap.collision.ids[1]}</span><b>{signed(snap.collision.before[1].x)}</b><b>{signed(snap.collision.after[1].x)}</b><span>Σpx</span><b>{signed(snap.collision.totalBefore.x)}</b><b>{signed(snap.collision.totalAfter.x)}</b><span>Σpy</span><b>{signed(snap.collision.totalBefore.y)}</b><b>{signed(snap.collision.totalAfter.y)}</b></div><p className="panel-note">Velocities use {unit}/s; total momentum uses model kg·{unit}/s. Walls or other contacts during the same step can change the total.</p></div>}
      <div className="panel-section"><span className="section-kicker">VECTOR OVERLAY</span><div className="check-grid">{(['velocity', 'acceleration', 'force', 'momentum'] as const).map(name => <label key={name}><input type="checkbox" checked={snap.vectors[name]} onChange={e => world.setVector(name, e.target.checked)} />{name}</label>)}<label><input type="checkbox" checked={snap.trail} onChange={e => world.setTrail(e.target.checked)} />trail</label></div></div>
      <div className="panel-section row-actions"><button className={snap.graph ? 'on' : ''} onClick={() => world.setGraph(!snap.graph)}>GRAPH</button><button className={snap.fbd ? 'on' : ''} onClick={() => world.setFbd(!snap.fbd)}>FBD</button><button className={showExplain ? 'on' : ''} onClick={() => setShowExplain(!showExplain)}>EXPLAIN</button></div>
      {snap.graph && <div className="panel-section"><div className="tab-row">{(['position', 'velocity', 'acceleration', 'energy'] as const).map(item => <button key={item} className={metric === item ? 'on' : ''} onClick={() => setMetric(item)}>{item === 'acceleration' ? 'a(t)' : item === 'position' ? 'r(t)' : item === 'velocity' ? 'v(t)' : 'E(t)'}</button>)}</div><div className="tab-row component-row"><button className={component === 'x' ? 'on' : ''} onClick={() => setComponent('x')}>X COMPONENT</button><button className={component === 'y' ? 'on' : ''} onClick={() => setComponent('y')}>Y COMPONENT</button></div><GraphPlot data={snap.data} metric={metric} unit={unit} component={component} /><div className="data-actions"><button onClick={() => world.setRecording(!snap.recording)}>{snap.recording ? 'PAUSE DATA' : 'RECORD DATA'}</button><button onClick={() => world.clearData()}>CLEAR</button><button onClick={exportCsv} disabled={!snap.data.length}>EXPORT CSV</button></div></div>}
      {snap.fbd && <Fbd m={m} unit={unit} />}
      {showExplain && <div className="explain-box"><div className="plot-title">EXPLAIN THIS</div><p>{explain(m, math, unit)}</p><select aria-label="Math level" value={math} onChange={e => setMath(e.target.value)}><option value="conceptual">Conceptual</option><option value="algebra">Algebra</option><option value="calculus">Calculus</option></select></div>}
      <div className="footnote">* Model kilograms are a simulation parameter. Meter and joule labels require length calibration; forces during contact are shown by direction only.</div>
    </>}
  </aside>
}
