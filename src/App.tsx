import { useEffect, useRef, useState } from 'react'
import { RealityWorld } from './world'
import LabPanel from './LabPanel'
import { scanFrame } from './vision'
import { getVisitorCount, readVisitorCount } from './visitorCount'
import type { Action, Point, Power, Snapshot, Spawn, Tool } from './types'

type Drawer = 'add' | 'world' | 'gravity' | 'launcher' | 'spring' | 'stopwatch' | 'calibrate' | 'experiments' | 'models' | 'torque' | 'fields' | 'settings' | null
const powers: { value: Power; label: string }[] = [
  { value: 'normal', label: 'Normal' }, { value: 'ice', label: 'Ice' }, { value: 'bouncy', label: 'Bouncy' },
  { value: 'trampoline', label: 'Trampoline' }, { value: 'magnet', label: 'Magnet' },
  { value: 'gravity', label: 'Gravity switch' }, { value: 'spawner', label: 'Spawner' },
  { value: 'portalA', label: 'Portal A' }, { value: 'portalB', label: 'Portal B' }
]
const actions: { value: Action; label: string }[] = [
  { value: 'none', label: 'None' }, { value: 'reverse', label: 'Reverse gravity' },
  { value: 'left', label: 'Gravity left' }, { value: 'right', label: 'Gravity right' },
  { value: 'up', label: 'Gravity up' }, { value: 'spawn', label: 'Spawn balls' },
  { value: 'clear', label: 'Clear objects' }, { value: 'bouncy', label: 'Make balls bouncy' },
  { value: 'slow', label: 'Slow motion' }, { value: 'fast', label: 'Speed up' },
  { value: 'teleport', label: 'Teleport' }, { value: 'explosion', label: 'Explosion impulse' }
]
const spawnKinds: { value: Spawn; label: string }[] = [
  { value: 'ball', label: 'Ball' }, { value: 'cube', label: 'Cube' }, { value: 'heavy', label: 'Heavy ball' },
  { value: 'bouncy', label: 'Bouncy ball' }, { value: 'burst', label: '10-ball burst' }
]
const gravityValues = [['Moon', 1.62], ['Mars', 3.71], ['Earth', 9.81], ['Jupiter', 24.79], ['Zero-G', 0]] as const
const experiments = [
  { id: 'fall', name: 'Constant acceleration', prompt: 'Predict the ball height after 0.5 seconds.', unit: 'length units', tip: 'A ball is released high in the current world.' },
  { id: 'projectile', name: 'Projectile range', prompt: 'Predict horizontal range at launch height.', unit: 'length units', tip: 'Set launcher angle and speed, then fire.' },
  { id: 'energy', name: 'Energy and speed', prompt: 'Predict speed near the bottom of the world.', unit: 'length units/s', tip: 'A falling ball is tracked; capture anytime if a ramp intercepts it.' },
  { id: 'spring', name: 'Spring period', prompt: 'Predict the time for one complete oscillation.', unit: 's', tip: 'A model spring and mass oscillate in zero gravity. The period is measured across two centre crossings.' },
  { id: 'newton', name: 'Newton’s second law', prompt: 'Predict the mean acceleration while the fixed horizontal force acts.', unit: 'length units/s²', tip: 'Change the mass or force, then compare F/m with the measured acceleration.' },
  { id: 'friction', name: 'Friction stopping distance', prompt: 'Predict how far the slider travels before it stops.', unit: 'length units', tip: 'A controlled model friction force μmg acts on a horizontal track.' },
  { id: 'momentum', name: 'Two-body momentum', prompt: 'Predict ball B’s horizontal velocity after collision.', unit: 'length units/s', tip: 'Compare an elastic collision with an inelastic collision.' },
  { id: 'torque', name: 'Pinned beam torque', prompt: 'Predict mean angular acceleration during the force pulse.', unit: 'rad/s²', tip: 'Move the applied force farther from the pivot to change τ = rF.' }
]
const resultExplanations: Record<string, string> = {
  fall: 'For free fall before contact, y(t) = y₀ − ½gt². A surface collision changes that prediction because the surface exerts an additional force.',
  projectile: 'In the ideal model, horizontal velocity stays nearly constant while gravity changes vertical velocity. At equal launch and landing height, range is vx times flight time.',
  energy: 'As the ball drops, gravitational potential energy becomes kinetic energy. Contact, friction and numerical solver error can change the total mechanical energy.',
  spring: 'A spring follows Fs = −kx. Increasing model mass lengthens the period; increasing spring constant shortens it. The ideal period is T = 2π√(m/k).',
  newton: 'A fixed model force produces acceleration a = F/m. Changing mass while keeping force fixed changes acceleration inversely.',
  friction: 'The track uses a controlled opposing force μmg. For a constant deceleration model, expected stopping distance is approximately v₀²/(2μg).',
  momentum: 'The collision inspector records each body’s velocity and total vector momentum immediately before and after contact. An inelastic collision loses kinetic energy while momentum should remain close to constant in the isolated model.',
  torque: 'For an ideal pinned beam, τ = rF and I = mL²/12. Angular acceleration is α = τ/I, so moving the force farther from the pivot increases α.'
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const photoRef = useRef<HTMLImageElement>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const photoUrlRef = useRef<string | null>(null)
  const worldRef = useRef<RealityWorld | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const cameraRequest = useRef(0)
  const scanRequest = useRef(0)
  const scanningRef = useRef(false)
  const [snap, setSnap] = useState<Snapshot | null>(null)
  const [camera, setCamera] = useState<'idle' | 'loading' | 'ready' | 'error' | 'manual' | 'photo'>('idle')
  const [cameraError, setCameraError] = useState('')
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [drawer, setDrawer] = useState<Drawer>(null)
  const [scanning, setScanning] = useState(false)
  const [knownLength, setKnownLength] = useState('0.30')
  const [prediction, setPrediction] = useState('')
  const [showResultExplanation, setShowResultExplanation] = useState(false)
  const [visitorCount, setVisitorCount] = useState<number | null>(null)
  const active = camera === 'ready' || camera === 'manual' || camera === 'photo'

  useEffect(() => {
    let cancelled = false
    void getVisitorCount().then(count => { if (!cancelled) setVisitorCount(count) })
    const refresh = () => {
      if (document.visibilityState !== 'visible') return
      void readVisitorCount().then(count => {
        if (!cancelled && count !== null) setVisitorCount(current => Math.max(current ?? 0, count))
      })
    }
    const timer = window.setInterval(refresh, 15000)
    document.addEventListener('visibilitychange', refresh)
    return () => { cancelled = true; window.clearInterval(timer); document.removeEventListener('visibilitychange', refresh) }
  }, [])

  useEffect(() => {
    if (!canvasRef.current) return
    const world = new RealityWorld(canvasRef.current, setSnap)
    worldRef.current = world; world.emit()
    let rescanTimer = 0
    const resize = () => {
      const hadScan = world.surfaces.some(surface => surface.source === 'scan')
      world.resize()
      if (hadScan && !world.surfaces.some(surface => surface.source === 'scan')) {
        window.clearTimeout(rescanTimer)
        rescanTimer = window.setTimeout(() => {
          const image = photoRef.current
          if (image?.complete && image.naturalWidth) void performScan(image)
        }, 250)
      }
    }
    window.addEventListener('resize', resize)
    const observer = new ResizeObserver(resize); observer.observe(canvasRef.current)
    return () => { window.clearTimeout(rescanTimer); observer.disconnect(); window.removeEventListener('resize', resize); world.destroy(); worldRef.current = null }
  }, [])
  useEffect(() => () => { cameraRequest.current++; scanRequest.current++; streamRef.current?.getTracks().forEach(t => t.stop()); if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current) }, [])

  async function performScan(source: HTMLVideoElement | HTMLImageElement) {
    const world = worldRef.current
    if (!world || scanningRef.current) return
    const request = ++scanRequest.current
    scanningRef.current = true; setScanning(true)
    world.setStatus('RECOGNIZING OBJECTS · ON-DEVICE MODEL')
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
    try {
      const objects = await scanFrame(source, world.width, world.height)
      if (request !== scanRequest.current) return
      setCameraError(''); world.replaceScan(objects)
    } catch (error) {
      if (request !== scanRequest.current) return
      world.setStatus('OBJECT SCAN FAILED · TRY AGAIN OR DRAW A SURFACE')
      setCameraError(error instanceof Error ? error.message : 'Object recognition failed')
      console.error('Object recognition failed:', error)
    } finally {
      if (request === scanRequest.current) { scanningRef.current = false; setScanning(false) }
    }
  }

  async function startCamera() {
    const request = ++cameraRequest.current
    scanRequest.current++; scanningRef.current = false; setScanning(false)
    streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null
    if (photoUrlRef.current) { URL.revokeObjectURL(photoUrlRef.current); photoUrlRef.current = null; setPhotoUrl(null) }
    setCamera('loading'); setCameraError('')
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API unavailable. Use Chrome on HTTPS or localhost.')
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false })
      if (request !== cameraRequest.current) { stream.getTracks().forEach(t => t.stop()); return }
      streamRef.current = stream
      if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play() }
      if (request !== cameraRequest.current) return
      setCamera('ready'); worldRef.current?.setStatus('CAMERA LIVE · CAPTURING SCENE')
      const video = videoRef.current
      const world = worldRef.current
      if (!video || !world || !video.videoWidth || !video.videoHeight) throw new Error('Camera frame is not ready.')
      await new Promise<void>(resolve => {
        if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(() => resolve())
        else requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      })
      await new Promise(resolve => window.setTimeout(resolve, 300))
      if (request !== cameraRequest.current) return
      const scale = Math.min(1, 1280 / Math.max(world.width, world.height))
      const width = Math.max(1, Math.round(world.width * scale)), height = Math.max(1, Math.round(world.height * scale))
      const frame = document.createElement('canvas')
      frame.width = width; frame.height = height
      const fit = Math.max(width / video.videoWidth, height / video.videoHeight)
      const imageWidth = video.videoWidth * fit, imageHeight = video.videoHeight * fit
      frame.getContext('2d')!.drawImage(video, (width - imageWidth) / 2, (height - imageHeight) / 2, imageWidth, imageHeight)
      const blob = await new Promise<Blob>((resolve, reject) => frame.toBlob(value => value ? resolve(value) : reject(new Error('Could not capture the camera frame.')), 'image/jpeg', .92))
      if (request !== cameraRequest.current) return
      await importImage(new File([blob], 'reality-camera-capture.jpg', { type: 'image/jpeg' }), 'camera')
    } catch (err) {
      if (request !== cameraRequest.current) return
      const denied = err instanceof DOMException && err.name === 'NotAllowedError'
      const missing = err instanceof DOMException && (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError')
      const hasVideo = !!streamRef.current?.getVideoTracks().some(track => track.readyState === 'live')
      setCameraError(denied ? 'Camera access was denied. Allow it in your browser or use manual mode.' : missing ? 'No camera was found. Open without camera, then import a photo.' : err instanceof Error ? err.message : 'Camera unavailable.')
      setCamera(hasVideo ? 'ready' : 'error')
    }
  }
  function manualMode() {
    cameraRequest.current++; scanRequest.current++; scanningRef.current = false; setScanning(false)
    streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    if (photoUrlRef.current) { URL.revokeObjectURL(photoUrlRef.current); photoUrlRef.current = null; setPhotoUrl(null) }
    setCamera('manual'); worldRef.current?.replaceScan([]); worldRef.current?.setTool('manual'); worldRef.current?.setStatus('MANUAL MODE · DRAW OR IMPORT AN IMAGE')
  }
  async function importImage(file: File, origin: 'camera' | 'file' = 'file') {
    if (!file.type.startsWith('image/')) { setCameraError('Choose an image file.'); return }
    const request = ++cameraRequest.current
    scanRequest.current++; scanningRef.current = false; setScanning(false)
    streamRef.current?.getTracks().forEach(track => track.stop()); streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current)
    const url = URL.createObjectURL(file)
    photoUrlRef.current = url; setPhotoUrl(url); setCamera('photo'); setCameraError(''); worldRef.current?.replaceScan([])
    const image = new Image()
    image.src = url
    try { await image.decode(); if (request !== cameraRequest.current) return; worldRef.current?.setTool(origin === 'camera' ? 'spawn' : 'select'); await performScan(image) }
    catch (error) { if (request !== cameraRequest.current) return; setCameraError(error instanceof Error ? error.message : 'Could not open image') }
  }
  function scan() {
    if (camera === 'ready' && videoRef.current) void performScan(videoRef.current)
    if (camera === 'photo' && photoRef.current) void performScan(photoRef.current)
  }
  function point(event: React.PointerEvent<HTMLCanvasElement>): Point {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: event.clientX - rect.left, y: event.clientY - rect.top }
  }
  function tool(next: Tool) { worldRef.current?.setTool(next); setDrawer(null) }
  function spawn(next: Spawn) { worldRef.current?.setSpawn(next); setDrawer(null) }
  function toggle(next: Drawer) { setDrawer(drawer === next ? null : next) }
  function switchMode(lab: boolean) { worldRef.current?.setLabMode(lab); setDrawer(null) }

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
      const w = worldRef.current; if (!w) return
      if (e.key.toLowerCase() === 'l') switchMode(!w.lab)
      if (e.key.toLowerCase() === 'd') tool(w.tool === 'draw' ? 'select' : 'draw')
      if (e.key.toLowerCase() === 'a') toggle('add')
      if (e.key.toLowerCase() === 's') scan()
      if (e.code === 'Space') { e.preventDefault(); w.setPaused(!w.paused) }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  })

  const world = worldRef.current
  const selected = world?.getSelected()
  const lab = snap?.lab || false
  const selectedExperiment = experiments.find(e => e.id === snap?.experiment)
  const unit = snap?.unit || 'su'

  return <main className={`app-shell ${!active ? 'is-boot' : ''}`}>
    <header className="app-header">
      <div className="app-title"><span className="title-symbol">PS</span><strong>PHYSICS SIMULATOR</strong><span className="app-version">/ 2D WORLD ENGINE</span></div>
      <div className="mode-switch" role="group" aria-label="Simulation mode"><button className={!lab ? 'on' : ''} onClick={() => switchMode(false)}>SANDBOX</button><button className={lab ? 'on' : ''} onClick={() => switchMode(true)}>LAB</button></div>
    </header>

    <div className="viewport">
      <div className="scene">
        <div className="empty-scene" />
        <video ref={videoRef} className={`camera ${camera === 'ready' ? 'live' : ''}`} playsInline muted aria-hidden={camera !== 'ready'} />
        <img ref={photoRef} className={`photo ${camera === 'photo' ? 'live' : ''}`} src={photoUrl || undefined} alt="Captured world scene" />
        <canvas ref={canvasRef} className={`world-canvas tool-${snap?.tool || 'spawn'}`} aria-label="Interactive physics world"
          onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); worldRef.current?.pointerDown(point(e)) }}
          onPointerMove={e => { if (e.buttons) worldRef.current?.pointerMove(point(e)) }}
          onPointerUp={e => worldRef.current?.pointerUp(point(e))} />
        {scanning && <div className="scan-beam" />}
      </div>

      {!active && <section className="start-screen">
        <div className="liquid-field" aria-hidden="true"><i /><i /><i /><i /><i /></div>
        <h1 className="hero-title">PHYSICS<br /><span>SIMULATOR</span></h1>
        <div className="start-actions"><button className="start-main" onClick={startCamera} disabled={camera === 'loading'}>{camera === 'loading' ? 'CAPTURING…' : 'START CAMERA'}<b>↗</b></button><button onClick={() => imageInputRef.current?.click()}>IMPORT PHOTO<b>↗</b></button><button onClick={manualMode}>OPEN WITHOUT CAMERA<b>→</b></button></div>
        <p className="visitor-count" aria-live="polite"><strong>{visitorCount === null ? '—' : visitorCount.toLocaleString()}</strong> {visitorCount === 1 ? 'VISIT' : 'VISITS'}</p>
        {cameraError && <div className="error-line start-error">{cameraError}</div>}
      </section>}

      {active && <>
        {cameraError && <div className="error-line active-error">{cameraError}</div>}
        {snap?.challenge && !lab && <div className="challenge-line"><span>CHALLENGE</span>{snap.challenge}<b>{snap.won ? `SUCCESS / ${snap.score}` : `${snap.time}S / ${snap.spawned} SPAWNED`}</b></div>}

        {selected && <aside className="inspector surface-inspector">
          <div className="panel-header"><div><span className="section-kicker">WORLD / OBJECT</span><strong>SURFACE {selected.id.padStart(2, '0')}</strong></div><button onClick={() => { world!.selected = null; world!.emit() }} aria-label="Close surface inspector">×</button></div>
          <div className="inspector-row"><span>TYPE</span><b>{selected.source === 'scan' ? 'Scene edge' : selected.source === 'manual' ? 'Manual edge' : 'Drawn edge'}</b></div>
          <div className="inspector-row"><span>LENGTH</span><b>{(Math.hypot(selected.b.x - selected.a.x, selected.b.y - selected.a.y) / (snap?.pxPerUnit || 100)).toFixed(2)} {unit}</b></div>
          <div className="inspector-row"><span>ANGLE</span><b>{(Math.atan2(selected.a.y - selected.b.y, selected.b.x - selected.a.x) * 180 / Math.PI).toFixed(1)}°</b></div>
          {lab ? <>
            <div className="inspector-divider">SIMULATED MATERIAL</div>
            <div className="button-matrix"><button onClick={() => world?.setMaterial(.03, .04)}>ICE</button><button onClick={() => world?.setMaterial(.35, .15)}>WOOD</button><button onClick={() => world?.setMaterial(.8, .75)}>RUBBER</button></div>
            <label className="setting-row">FRICTION μ<input aria-label="Simulated friction" type="number" min="0" max="1" step="0.01" value={selected.mu} onChange={e => world?.setMaterial(Number(e.target.value), selected.bounce)} /></label>
            <label className="setting-row">RESTITUTION<input aria-label="Simulated restitution" type="number" min="0" max="1" step="0.01" value={selected.bounce} onChange={e => world?.setMaterial(selected.mu, Number(e.target.value))} /></label>
            <p className="inspector-note">These are model settings, not measurements of the real surface. Sandbox powers are inactive in Lab.</p>
          </> : <>
            <div className="inspector-divider">SANDBOX BEHAVIOR</div>
            <label className="setting-row">POWER<select aria-label="Surface power" value={selected.power} onChange={e => world?.setPower(e.target.value as Power)}>{powers.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
            <label className="setting-row">STRENGTH <span>{selected.strength}</span><input aria-label="Power strength" type="range" min="1" max="10" value={selected.strength} onChange={e => world?.setStrength(Number(e.target.value))} /></label>
            <div className="inspector-divider">WHEN TOUCHED → DO</div>
            <label className="setting-row">ACTION<select aria-label="On touch action" value={selected.action} onChange={e => world?.setAction(e.target.value as Action)}>{actions.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}</select></label>
            <p className="inspector-note">Portal, trampoline, magnet and gravity switch are fictional sandbox mechanics.</p>
          </>}
          <button className="inspector-delete" onClick={() => { world?.removeSurface(selected); world?.emit() }}>DELETE SURFACE</button>
        </aside>}

        {lab && snap && snap.bodyId != null && !selected && <LabPanel snap={snap} world={world!} onClose={() => world?.selectBody(null)} />}

        {drawer && <section className="drawer" aria-label={`${drawer} controls`}>
          <div className="drawer-header"><span>{drawer.toUpperCase()}</span><button onClick={() => setDrawer(null)} aria-label="Close controls">×</button></div>
          {drawer === 'add' && <><p className="drawer-help">Choose an object, then click the viewport.</p><div className="list-controls">{spawnKinds.map(s => <button key={s.value} className={snap?.spawn === s.value ? 'on' : ''} onClick={() => spawn(s.value)}><span>+ {s.label.toUpperCase()}</span><small>{s.value === 'burst' ? '10' : ''}</small></button>)}</div><p className="drawer-help">Select a moving object in Lab to inspect it.</p></>}
          {drawer === 'world' && <><p className="drawer-help">A camera still or imported photo becomes the world background. Recognized objects gain traced collision edges where possible; select or edit an edge to tune the scene.</p><div className="list-controls"><button onClick={() => imageInputRef.current?.click()}>IMPORT PHOTO / BUILD WORLD</button><button onClick={startCamera}>TAKE NEW CAMERA PHOTO</button><button onClick={() => tool('manual')}>MANUAL SURFACE</button><button onClick={() => tool('edit')}>EDIT ENDPOINTS</button><button onClick={() => tool('select')}>SELECT SURFACE</button><button onClick={() => world?.undoDrawn()}>UNDO LAST DRAWING</button><button onClick={() => world?.clearDrawn()}>CLEAR DRAWN SURFACES</button><button onClick={() => world?.clearBalls()}>CLEAR VIRTUAL OBJECTS</button></div><label className="drawer-check"><input type="checkbox" checked={snap?.colliders ?? true} onChange={e => world?.setColliders(e.target.checked)} /> SHOW COLLIDERS</label></>}
          {drawer === 'gravity' && <><p className="drawer-help">The model uses {snap?.calibrated ? 'metres' : 'simulated length units'} and seconds. Earth is 9.81 {unit}/s² in the model.</p><div className="list-controls">{gravityValues.map(([name, value]) => <button key={name} className={world?.gravityName === name ? 'on' : ''} onClick={() => world?.setGravity(name)}><span>{name.toUpperCase()}</span><small>{value.toFixed(2)} {unit}/s²</small></button>)}</div>{!lab && <><div className="drawer-subhead">DIRECTION</div><div className="button-matrix">{['DOWN', 'LEFT', 'UP', 'RIGHT'].map(d => <button key={d} className={world?.direction === d ? 'on' : ''} onClick={() => world?.setDirection(d)}>{d}</button>)}</div></>}</>}
          {drawer === 'calibrate' && <><p className="drawer-help">Enter a real length in metres. Drag along that length in the camera view. Until then, Lab reports simulated units (su).</p><label className="drawer-field">KNOWN LENGTH / M<input type="number" min="0.01" step="0.01" value={knownLength} onChange={e => setKnownLength(e.target.value)} /></label><button className="drawer-primary" onClick={() => { const n = Number(knownLength); if (n > 0) { world?.setKnownLength(n); tool('calibrate') } }}>CALIBRATE SCALE</button><div className="drawer-subhead">CURRENT SCALE</div><p className="drawer-help">{snap?.calibrated ? `${snap.pxPerUnit.toFixed(1)} pixels per metre` : '100 pixels per simulated unit'}</p></>}
          {drawer === 'launcher' && <><p className="drawer-help">Click PLACE, then click the viewport. FIRE releases a ball at the chosen angle and model speed.</p><label className="drawer-field">ANGLE / DEGREES<input type="number" min="-89" max="89" step="1" value={snap?.launcher?.angle ?? 45} onChange={e => world?.setLauncher(Number(e.target.value), snap?.launcher?.speed ?? 4)} /></label><label className="drawer-field">SPEED / {unit}/S<input type="number" min="0.1" max="30" step="0.1" value={snap?.launcher?.speed ?? 4} onChange={e => world?.setLauncher(snap?.launcher?.angle ?? 45, Number(e.target.value))} /></label><div className="drawer-actions"><button onClick={() => tool('launcher')}>PLACE</button><button onClick={() => world?.fireLauncher()} disabled={!snap?.launcher}>FIRE</button></div><p className="drawer-help">Enable TRAIL on the selected object to inspect its path.</p></>}
          {drawer === 'spring' && <><p className="drawer-help">A horizontal model spring pulls a mass toward its anchor in zero gravity. Other surfaces in the scene can still intercept it.</p><button className="drawer-primary" onClick={() => world?.prepareSpring(snap?.spring?.mass ?? 1, snap?.spring?.k ?? 8, snap?.spring?.displacement ?? 1.2)}>PREPARE SPRING</button>{snap?.spring && <><label className="drawer-field">MODEL MASS / KG<input type="number" min="0.1" max="20" step="0.1" value={snap.spring.mass} onChange={e => world?.setSpringSettings(Number(e.target.value), snap.spring!.k, snap.spring!.displacement)} /></label><label className="drawer-field">SPRING CONSTANT / KG/S²<input type="number" min="0.1" max="50" step="0.1" value={snap.spring.k} onChange={e => world?.setSpringSettings(snap.spring!.mass, Number(e.target.value), snap.spring!.displacement)} /></label><label className="drawer-field">START DISPLACEMENT / {unit}<input type="number" min="-2" max="2" step="0.1" value={snap.spring.displacement} onChange={e => world?.setSpringSettings(snap.spring!.mass, snap.spring!.k, Number(e.target.value))} /></label><button className="drawer-primary" onClick={() => world?.releaseSpring()}>{snap.spring.active ? 'RESTART OSCILLATION' : 'RELEASE'}</button><p className="drawer-help">Expected period T = 2π√(m/k). The graph records the actual simulated motion.</p></>}</>}
          {drawer === 'stopwatch' && <><div className="drawer-subhead">SIMULATION TIME</div><div className="stopwatch-readout">{(snap?.stopwatch || 0).toFixed(2)} <span>S</span></div><div className="drawer-actions"><button onClick={() => world?.setPaused(!snap?.paused)}>{snap?.paused ? 'START' : 'STOP'}</button><button onClick={() => world?.resetStopwatch()}>ZERO</button></div><p className="drawer-help">The clock advances with the physics simulation. Slow motion changes its rate.</p></>}
          {drawer === 'models' && <><p className="drawer-help">Controlled physics apparatuses in the current Lab world.</p><div className="list-controls"><button onClick={() => setDrawer('torque')}>PINNED BEAM / TORQUE</button><button onClick={() => { world?.setFieldMode('electric'); setDrawer('fields') }}>ELECTRIC CHARGES / FIELD</button><button onClick={() => { world?.setFieldMode('magnetic'); setDrawer('fields') }}>UNIFORM MAGNETIC FIELD</button></div></>}
          {drawer === 'torque' && <><p className="drawer-help">Ideal pinned beam with no collision coupling. A tangential model force acts at the marked lever point.</p><button className="drawer-primary" onClick={() => world?.prepareRotor()}>PREPARE BEAM</button>{snap?.rotor && <><div className="readout-grid rotor-readout"><span>θ</span><b>{(snap.rotor.theta * 180 / Math.PI).toFixed(1)}°</b><span>ω</span><b>{snap.rotor.omega.toFixed(2)} rad/s</b><span>α</span><b>{snap.rotor.alpha.toFixed(2)} rad/s²</b><span>I</span><b>{snap.rotor.inertia.toFixed(2)} kg·{unit}²</b><span>τ</span><b>{snap.rotor.torque.toFixed(2)} model</b></div><label className="drawer-field">MASS / MODEL KG<input type="number" min="0.2" max="20" step="0.1" value={snap.rotor.mass} onChange={e => world?.setRotorSettings(Number(e.target.value), snap.rotor!.length, snap.rotor!.lever, snap.rotor!.force)} /></label><label className="drawer-field">BEAM LENGTH / {unit}<input type="number" min="0.8" max="4" step="0.1" value={snap.rotor.length} onChange={e => world?.setRotorSettings(snap.rotor!.mass, Number(e.target.value), snap.rotor!.lever, snap.rotor!.force)} /></label><label className="drawer-field">LEVER ARM / {unit}<input type="number" min="0" max={snap.rotor.length / 2} step="0.1" value={snap.rotor.lever} onChange={e => world?.setRotorSettings(snap.rotor!.mass, snap.rotor!.length, Number(e.target.value), snap.rotor!.force)} /></label><label className="drawer-field">TANGENTIAL FORCE / MODEL {unit === 'm' ? 'N' : 'FORCE'}<input type="number" min="-10" max="10" step="0.1" value={snap.rotor.force} onChange={e => world?.setRotorSettings(snap.rotor!.mass, snap.rotor!.length, snap.rotor!.lever, Number(e.target.value))} /></label><div className="drawer-actions"><button onClick={() => world?.setRotorActive(!snap.rotor?.active)}>{snap.rotor.active ? 'STOP FORCE' : 'APPLY FORCE'}</button><button onClick={() => world?.resetRotor()}>ZERO BEAM</button></div><p className="drawer-help">I = mL²/12; τ = rF; α = τ/I. Positive angle is clockwise on screen.</p></>}</>}
          {drawer === 'fields' && <><p className="drawer-help">Model charges use a softened inverse-square electric force or a uniform magnetic field. These are simulation units until calibrated.</p><div className="button-matrix"><button className={snap?.fieldMode === 'electric' ? 'on' : ''} onClick={() => world?.setFieldMode('electric')}>ELECTRIC</button><button className={snap?.fieldMode === 'magnetic' ? 'on' : ''} onClick={() => world?.setFieldMode('magnetic')}>MAGNETIC</button><button className={snap?.fieldMode === 'off' ? 'on' : ''} onClick={() => world?.setFieldMode('off')}>OFF</button></div>{snap?.fieldMode !== 'off' && <><div className="drawer-subhead">MODEL CHARGES</div><div className="drawer-actions"><button onClick={() => world?.addCharge(1)}>ADD +</button><button onClick={() => world?.addCharge(-1)}>ADD −</button><button onClick={() => world?.setTool('move')}>MOVE</button></div><p className="drawer-help">Select a charge to edit q and mass in the right inspector. Drag with MOVE to reposition it.</p></>}{snap?.fieldMode === 'electric' && <><label className="drawer-check"><input type="checkbox" checked={snap.showEField} onChange={e => world?.setShowEField(e.target.checked)} /> SHOW E-FIELD GRID</label><label className="drawer-field">COULOMB CONSTANT / MODEL<input type="number" min="0.1" max="10" step="0.1" value={snap.electricK} onChange={e => world?.setElectricK(Number(e.target.value))} /></label><p className="drawer-help">E arrows show the projected field. Force is qE with 0.3 {unit} softening near each charge.</p></>}{snap?.fieldMode === 'magnetic' && <><label className="drawer-field">UNIFORM B / MODEL<input type="number" min="-8" max="8" step="0.1" value={snap.magneticB} onChange={e => world?.setMagneticB(Number(e.target.value))} /></label><div className="button-matrix"><button onClick={() => world?.setMagneticB(2)}>OUT OF SCREEN ⊙</button><button onClick={() => world?.setMagneticB(-2)}>INTO SCREEN ×</button></div><button className="drawer-primary" onClick={() => world?.prepareMagneticDemo()}>DEMO ORBIT</button><p className="drawer-help">F = q(v × B), perpendicular to motion. Reversing q or B reverses curvature.</p></>}</>}
          {drawer === 'experiments' && <>
            <p className="drawer-help">Experiments run in this same world. Existing scanned and drawn surfaces remain.</p>
            <div className="list-controls">{experiments.map(exp => <button key={exp.id} className={snap?.experiment === exp.id ? 'on' : ''} onClick={() => { world?.startExperiment(exp.id); setPrediction(''); setShowResultExplanation(false) }}><span>{exp.name.toUpperCase()}</span></button>)}</div>
            {selectedExperiment && <div className="experiment-box">
              <div className="drawer-subhead">{selectedExperiment.name.toUpperCase()}</div>
              <p>{selectedExperiment.tip}</p><p>{selectedExperiment.prompt}</p>
              <label className="drawer-field">YOUR PREDICTION / {selectedExperiment.unit.replace('length units', unit)}<input type="number" step="0.01" value={prediction} onChange={e => setPrediction(e.target.value)} /></label>
              {snap?.experiment === 'newton' && <><label className="drawer-field">MASS / MODEL KG<input type="number" min="0.1" max="20" step="0.1" value={snap.newton.mass} onChange={e => world?.setNewtonSettings(Number(e.target.value), snap.newton.force)} /></label><label className="drawer-field">HORIZONTAL FORCE / MODEL<input type="number" min="0.1" max="20" step="0.1" value={snap.newton.force} onChange={e => world?.setNewtonSettings(snap.newton.mass, Number(e.target.value))} /></label><p>Expected acceleration F/m = {(snap.newton.force / snap.newton.mass).toFixed(2)} {unit}/s².</p></>}
              {snap?.experiment === 'friction' && snap.frictionTest && <><label className="drawer-field">MODEL FRICTION μ<input type="number" min="0.01" max="0.8" step="0.01" value={snap.frictionTest.mu} onChange={e => world?.setFrictionSettings(Number(e.target.value), snap.frictionTest!.speed)} /></label><label className="drawer-field">START SPEED / {unit}/S<input type="number" min="0.2" max="10" step="0.1" value={snap.frictionTest.speed} onChange={e => world?.setFrictionSettings(snap.frictionTest!.mu, Number(e.target.value))} /></label><p>Ideal estimate v²/(2μg) = {(snap.frictionTest.speed ** 2 / (2 * snap.frictionTest.mu * 9.81)).toFixed(2)} {unit}.</p></>}
              {snap?.experiment === 'momentum' && <><label className="drawer-field">MASS A / MODEL KG<input type="number" min="0.1" max="10" step="0.1" value={snap.momentumTest.massA} onChange={e => world?.setMomentumSettings(Number(e.target.value), snap.momentumTest.massB, snap.momentumTest.speedA, snap.momentumTest.restitution)} /></label><label className="drawer-field">MASS B / MODEL KG<input type="number" min="0.1" max="10" step="0.1" value={snap.momentumTest.massB} onChange={e => world?.setMomentumSettings(snap.momentumTest.massA, Number(e.target.value), snap.momentumTest.speedA, snap.momentumTest.restitution)} /></label><label className="drawer-field">BALL A SPEED / {unit}/S<input type="number" min="0.1" max="8" step="0.1" value={snap.momentumTest.speedA} onChange={e => world?.setMomentumSettings(snap.momentumTest.massA, snap.momentumTest.massB, Number(e.target.value), snap.momentumTest.restitution)} /></label><label className="drawer-field">COLLISION TYPE<select value={snap.momentumTest.restitution} onChange={e => world?.setMomentumSettings(snap.momentumTest.massA, snap.momentumTest.massB, snap.momentumTest.speedA, Number(e.target.value))}><option value="1">Elastic / e = 1</option><option value="0">Inelastic / e = 0</option></select></label><p>Ideal ball B speed = {((1 + snap.momentumTest.restitution) * snap.momentumTest.massA / (snap.momentumTest.massA + snap.momentumTest.massB) * snap.momentumTest.speedA).toFixed(2)} {unit}/s.</p></>}
              {snap?.experiment === 'torque' && <><button className="drawer-primary secondary" onClick={() => setDrawer('torque')}>SET BEAM / LEVER</button>{snap.rotor && <p>Expected α = τ/I = {(snap.rotor.lever * snap.rotor.force / snap.rotor.inertia).toFixed(2)} rad/s².</p>}</>}
              {snap?.experiment === 'projectile' && <button className="drawer-primary secondary" onClick={() => setDrawer('launcher')}>SET LAUNCHER</button>}
              {snap?.experiment === 'spring' && <button className="drawer-primary secondary" onClick={() => setDrawer('spring')}>SET SPRING</button>}
              <button className="drawer-primary" onClick={() => world?.runExperiment()} disabled={snap?.experimentRunning}>RUN EXPERIMENT</button>
              <button className="drawer-primary secondary" onClick={() => world?.captureExperiment()} disabled={!snap?.experimentRunning || ['spring', 'momentum'].includes(snap.experiment)}>CAPTURE CURRENT VALUE</button>
              {snap?.experimentValue != null && <div className="experiment-result"><span>{snap.experimentResult}</span><strong>{snap.experimentValue.toFixed(2)} {selectedExperiment.unit.replace('length units', unit)}</strong><small>{prediction !== '' ? `PREDICTED ${Number(prediction).toFixed(2)} · DIFFERENCE ${Math.abs(Number(prediction) - snap.experimentValue).toFixed(2)}` : 'ENTER A PREDICTION TO COMPARE'}</small></div>}
              {snap?.experimentValue != null && <><button className="drawer-primary secondary" onClick={() => setShowResultExplanation(!showResultExplanation)}>{showResultExplanation ? 'HIDE EXPLANATION' : 'EXPLAIN RESULT'}</button>{showResultExplanation && <p className="experiment-explanation">{resultExplanations[snap.experiment]}</p>}</>}
            </div>}
          </>}
          {drawer === 'settings' && <><div className="drawer-subhead">SIMULATION</div><label className="drawer-check"><input type="checkbox" checked={snap?.slow || false} onChange={e => world?.setSlow(e.target.checked)} /> SLOW MOTION</label><div className="drawer-subhead">WORLD PRESET / SANDBOX</div><div className="list-controls">{['NORMAL', 'MOON ROOM', 'CHAOS', 'PINBALL', 'ZERO-G'].map(name => <button key={name} disabled={lab} onClick={() => world?.setPreset(name)}>{name}</button>)}</div><div className="drawer-subhead">CHALLENGE / SANDBOX</div><div className="drawer-actions"><button disabled={lab} onClick={() => world?.newChallenge()}>NEW</button><button disabled={lab} onClick={() => world?.resetAttempt()}>RESET ATTEMPT</button></div><button className="drawer-danger" onClick={() => { world?.resetAll(); setCameraError(''); setDrawer(null) }}>RESET EVERYTHING</button></>}
        </section>}
      </>}
    </div>

    <input ref={imageInputRef} className="visually-hidden" type="file" accept="image/*" aria-label="Import a world image" onChange={e => { const file = e.target.files?.[0]; if (file) void importImage(file); e.target.value = '' }} />

    <footer className={`tool-strip ${!active ? 'boot-footer' : ''}`}>
      {!active ? <div className="boot-status">WORLD NOT INITIALIZED <span>START CAMERA OR OPEN MANUAL MODE</span></div> : !lab ? <>
        <div className="tool-group"><span>WORLD</span><button onClick={scan} disabled={!['ready', 'photo'].includes(camera) || scanning}>{scanning ? 'RECOGNIZING' : 'SCAN WORLD'}<kbd>S</kbd></button><button onClick={() => toggle('world')} className={drawer === 'world' ? 'on' : ''}>EDIT / IMPORT</button></div>
        <div className="tool-group"><span>OBJECT</span><button onClick={() => spawn('ball')} className={snap?.tool === 'spawn' && snap?.spawn === 'ball' ? 'on' : ''}>+ BALL</button><button onClick={() => spawn('cube')} className={snap?.tool === 'spawn' && snap?.spawn === 'cube' ? 'on' : ''}>+ CUBE</button><button onClick={() => toggle('add')} className={drawer === 'add' ? 'on' : ''}>MORE<kbd>A</kbd></button></div>
        <div className="tool-group"><span>BUILD</span><button onClick={() => tool(snap?.tool === 'draw' ? 'select' : 'draw')} className={snap?.tool === 'draw' ? 'on' : ''}>DRAW<kbd>D</kbd></button><button onClick={() => tool('target')}>TARGET</button></div>
        <div className="tool-group"><span>RULES</span><button onClick={() => { tool('select'); world?.setStatus('SELECT A SURFACE TO EDIT ITS RULE') }}>BEHAVIOR</button></div>
        <div className="tool-group"><span>PHYSICS</span><button onClick={() => toggle('gravity')} className={drawer === 'gravity' ? 'on' : ''}>GRAVITY</button><button onClick={() => switchMode(true)}>LAB<kbd>L</kbd></button></div>
        <div className="tool-group system-group"><span>SYSTEM</span><button onClick={() => world?.setPaused(!snap?.paused)}>{snap?.paused ? 'PLAY' : 'PAUSE'}<kbd>SPC</kbd></button><button onClick={() => toggle('settings')} className={drawer === 'settings' ? 'on' : ''}>SETTINGS</button></div>
      </> : <>
        <div className="tool-group"><span>WORLD</span><button onClick={scan} disabled={!['ready', 'photo'].includes(camera) || scanning}>{scanning ? 'RECOGNIZING' : 'SCAN WORLD'}<kbd>S</kbd></button><button onClick={() => toggle('calibrate')} className={drawer === 'calibrate' ? 'on' : ''}>SCALE</button><button onClick={() => toggle('world')} className={drawer === 'world' ? 'on' : ''}>EDIT / IMPORT</button></div>
        <div className="tool-group"><span>OBJECT</span><button onClick={() => tool('select')} className={snap?.tool === 'select' ? 'on' : ''}>SELECT</button><button onClick={() => toggle('add')} className={drawer === 'add' ? 'on' : ''}>ADD<kbd>A</kbd></button></div>
        <div className="tool-group"><span>MEASURE</span><button onClick={() => tool('ruler')} className={snap?.tool === 'ruler' ? 'on' : ''}>RULER</button><button onClick={() => tool('angle')} className={snap?.tool === 'angle' ? 'on' : ''}>ANGLE</button><button onClick={() => toggle('stopwatch')} className={drawer === 'stopwatch' ? 'on' : ''}>TIME</button></div>
        <div className="tool-group"><span>MOTION</span><button onClick={() => toggle('launcher')} className={drawer === 'launcher' ? 'on' : ''}>LAUNCHER</button><button onClick={() => toggle('spring')} className={drawer === 'spring' ? 'on' : ''}>SPRING</button><button onClick={() => tool('force')} className={snap?.tool === 'force' ? 'on' : ''}>FORCE</button></div>
        <div className="tool-group"><span>ANALYZE</span><button onClick={() => world?.setGraph(!snap?.graph)} className={snap?.graph ? 'on' : ''}>GRAPH</button><button onClick={() => world?.setFbd(!snap?.fbd)} className={snap?.fbd ? 'on' : ''}>FBD</button><button onClick={() => toggle('experiments')} className={drawer === 'experiments' ? 'on' : ''}>EXPERIMENTS</button><button onClick={() => toggle('models')} className={['models', 'torque', 'fields'].includes(drawer || '') ? 'on' : ''}>MODELS</button></div>
        <div className="tool-group system-group"><span>SYSTEM</span><button onClick={() => world?.setPaused(!snap?.paused)}>{snap?.paused ? 'PLAY' : 'PAUSE'}<kbd>SPC</kbd></button><button onClick={() => toggle('gravity')} className={drawer === 'gravity' ? 'on' : ''}>GRAVITY</button><button onClick={() => toggle('settings')} className={drawer === 'settings' ? 'on' : ''}>RESET</button></div>
      </>}
    </footer>
  </main>
}
