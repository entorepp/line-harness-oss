const origin = process.argv[2]
if (!origin) {
  throw new Error('Usage: node verify-chat-ui-release.mjs <production-origin>')
}

const releaseOrigin = new URL(origin)
const isLocalTest = ['127.0.0.1', 'localhost'].includes(releaseOrigin.hostname)
if (releaseOrigin.protocol !== 'https:' && !isLocalTest) {
  throw new Error('Production origin must use HTTPS')
}

const nonce = Date.now().toString()
const headers = { 'cache-control': 'no-cache' }
const pageUrl = new URL(`/chats?release=${nonce}`, releaseOrigin)
const pageResponse = await fetch(pageUrl, { headers })
if (!pageResponse.ok) {
  throw new Error(`Could not load ${pageUrl}: HTTP ${pageResponse.status}`)
}

const html = await pageResponse.text()
const scriptSources = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+\.js(?:\?[^"']*)?)["'][^>]*>/gi)]
  .map((match) => match[1])
if (scriptSources.length === 0) {
  throw new Error('No JavaScript bundles were found on the live /chats page')
}

const bundles = await Promise.all(
  [...new Set(scriptSources)].map(async (source) => {
    const url = new URL(source, pageUrl)
    url.searchParams.set('release', nonce)
    const response = await fetch(url, { headers })
    if (!response.ok) {
      throw new Error(`Could not load ${url}: HTTP ${response.status}`)
    }
    return response.text()
  }),
)
const release = bundles.join('\n')

const requiredMarkers = [
  '予約送信設定中',
  '日本時間',
  'Slackチャンネルを紐付け',
  'https://line-flattravel.flat-travel.workers.dev',
]
for (const marker of requiredMarkers) {
  if (!release.includes(marker)) {
    throw new Error(`Live chat bundle is missing: ${marker}`)
  }
}
if (release.includes('http://localhost:8787')) {
  throw new Error('Live chat bundle still points at the local Worker')
}

console.log('Verified live Flat Harness scheduling and Slack linking UI')
