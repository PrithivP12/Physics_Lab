const localCountUrl = 'https://abacus.jasoncameron.dev/get/physics-lab-five-rho.vercel.app/visits'
let countRequest: Promise<number | null> | null = null

function loadCount(url: string): Promise<number | null> {
  return fetch(url, { cache: 'no-store' })
    .then(async response => {
      if (!response.ok) throw new Error(`Visitor counter returned ${response.status}`)
      const data: unknown = await response.json()
      const value = (data as { value?: unknown }).value
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
        throw new Error('Visitor counter returned an invalid count')
      }
      return value
    })
    .catch(error => {
      console.warn('Visitor count is unavailable:', error)
      return null
    })
}

export function getVisitorCount(): Promise<number | null> {
  if (countRequest) return countRequest
  const isLocalPreview = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  countRequest = loadCount(isLocalPreview ? localCountUrl : '/api/visits')
  return countRequest
}

export function readVisitorCount(): Promise<number | null> {
  const isLocalPreview = ['localhost', '127.0.0.1'].includes(window.location.hostname)
  return loadCount(isLocalPreview ? localCountUrl : '/api/visits?readOnly=true')
}
