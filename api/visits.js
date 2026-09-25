const counterBase = 'https://abacus.jasoncameron.dev'
const counterKey = 'physics-lab-five-rho.vercel.app/visits'

function countFrom(data) {
  const value = data?.value
  if (!Number.isSafeInteger(value) || value < 0) throw new Error('Invalid visit count')
  return value
}

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store, max-age=0')
  if (request.method !== 'GET') return response.status(405).json({ error: 'Method not allowed' })

  try {
    const readOnly = new URL(request.url || '/', 'https://local.invalid').searchParams.get('readOnly') === 'true'
    const counter = await fetch(`${counterBase}/${readOnly ? 'get' : 'hit'}/${counterKey}`, { cache: 'no-store' })
    if (!counter.ok) throw new Error(`Abacus returned ${counter.status}`)
    return response.status(200).json({ value: countFrom(await counter.json()) })
  } catch (error) {
    console.error('Could not count visit:', error)
    return response.status(503).json({ error: 'Visit counter unavailable' })
  }
}
