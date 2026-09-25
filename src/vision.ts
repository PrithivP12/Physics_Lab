import type { BrushMode, InteractiveSegmenter, ObjectDetector } from '@mediapipe/tasks-vision'
import type { VisionObject } from './types'
import { outlineFromMask } from './outline'

let detector: ObjectDetector | null = null
let detectorLoading: Promise<void> | null = null
let segmenter: InteractiveSegmenter | null = null
let segmenterLoading: Promise<void> | null = null

export function loadVision(): Promise<void> {
  if (detector) return Promise.resolve()
  if (detectorLoading) return detectorLoading
  const assetsBase = import.meta.env.BASE_URL
  detectorLoading = (async () => {
    const { FilesetResolver, ObjectDetector } = await import('@mediapipe/tasks-vision')
    const visionFiles = await FilesetResolver.forVisionTasks(`${assetsBase}mediapipe`)
    detector = await ObjectDetector.createFromOptions(visionFiles, {
      baseOptions: { modelAssetPath: `${assetsBase}models/efficientdet_lite0.tflite`, delegate: 'CPU' },
      runningMode: 'IMAGE',
      scoreThreshold: .36,
      maxResults: 12
    })
  })().catch(error => { detectorLoading = null; throw error })
  return detectorLoading
}

async function loadSegmenter(): Promise<void> {
  if (segmenter) return
  if (segmenterLoading) return segmenterLoading
  const assetsBase = import.meta.env.BASE_URL
  segmenterLoading = (async () => {
    const { FilesetResolver, InteractiveSegmenter } = await import('@mediapipe/tasks-vision')
    const visionFiles = await FilesetResolver.forVisionTasks(`${assetsBase}mediapipe`)
    segmenter = await InteractiveSegmenter.createFromOptions(visionFiles, {
      baseOptions: { modelAssetPath: `${assetsBase}models/interactive_segmentation.task`, delegate: 'CPU' }
    })
  })().catch(error => { segmenterLoading = null; throw error })
  return segmenterLoading
}

export async function scanFrame(source: HTMLVideoElement | HTMLImageElement, width: number, height: number): Promise<VisionObject[]> {
  await loadVision()
  const sourceWidth = source instanceof HTMLVideoElement ? source.videoWidth : source.naturalWidth
  const sourceHeight = source instanceof HTMLVideoElement ? source.videoHeight : source.naturalHeight
  if (!sourceWidth || !sourceHeight || width < 1 || height < 1) throw new Error('Image is not ready for scanning')

  const isCameraVideo = source instanceof HTMLVideoElement
  const scale = isCameraVideo ? Math.min(1, 800 / width) : Math.min(1, 800 / Math.max(sourceWidth, sourceHeight))
  const scanWidth = Math.max(1, Math.round((isCameraVideo ? width : sourceWidth) * scale))
  const scanHeight = Math.max(1, Math.round((isCameraVideo ? height : sourceHeight) * scale))
  const canvas = document.createElement('canvas')
  canvas.width = scanWidth; canvas.height = scanHeight
  const context = canvas.getContext('2d')!
  if (isCameraVideo) {
    // The camera view is cropped on screen, so scan that same crop.
    const coverScale = Math.max(scanWidth / sourceWidth, scanHeight / sourceHeight)
    const drawnWidth = sourceWidth * coverScale, drawnHeight = sourceHeight * coverScale
    context.drawImage(source, (scanWidth - drawnWidth) / 2, (scanHeight - drawnHeight) / 2, drawnWidth, drawnHeight)
  } else {
    // Scan the whole photo. Its position on screen is worked out below.
    context.drawImage(source, 0, 0, scanWidth, scanHeight)
  }
  const displayFit = Math.min(width / sourceWidth, height / sourceHeight)
  const displayOffsetX = (width - sourceWidth * displayFit) / 2
  const displayOffsetY = (height - sourceHeight * displayFit) / 2
  const mapX = (x: number) => isCameraVideo ? x / scale : displayOffsetX + x / scale * displayFit
  const mapY = (y: number) => isCameraVideo ? y / scale : displayOffsetY + y / scale * displayFit

  const detectionResult = detector!.detect(canvas)
  const foundObjects = detectionResult.detections.flatMap(detection => {
    const box = detection.boundingBox, category = detection.categories[0]
    if (!box || !category) return []
    const label = category.displayName || category.categoryName || 'object'
    const x = Math.max(0, mapX(box.originX)), y = Math.max(0, mapY(box.originY))
    const right = Math.min(width, mapX(box.originX + box.width))
    const bottom = Math.min(height, mapY(box.originY + box.height))
    const objectWidth = right - x, objectHeight = bottom - y
    if (objectWidth < 28 || objectHeight < 28 || objectWidth * objectHeight > width * height * .72) return []
    return [{ x, y, width: objectWidth, height: objectHeight, label, score: category.score, modelBox: box, outline: undefined as VisionObject['outline'] }]
  }).slice(0, 8)

  if (foundObjects.length) {
    try {
      await loadSegmenter()
      segmenter!.setImage(canvas)
      for (const object of foundObjects) {
        const box = object.modelBox
        for (const [fx, fy] of [[.5, .5], [.5, .3], [.5, .7]]) {
          const mask = segmenter!.segment([{ brushMode: 1 as BrushMode, point: [{
            x: Math.max(0, Math.min(1, (box.originX + box.width * fx) / scanWidth)),
            y: Math.max(0, Math.min(1, (box.originY + box.height * fy) / scanHeight))
          }], isCompleted: true }])
          try {
            const values = mask.hasFloat32Array() ? mask.getAsFloat32Array() : mask.getAsUint8Array()
            object.outline = outlineFromMask(values, mask.width, mask.height, box, scanWidth, scanHeight, mapX, mapY)
          } finally { mask.close() }
          if (object.outline) break
        }
      }
    } catch (error) {
      console.warn('Silhouette segmentation unavailable; using detected bounds.', error)
    }
  }
  return foundObjects.map(({ modelBox: _modelBox, ...object }) => object)
}
