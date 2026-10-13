const ALLOWED_PREFIXES = [
  '/auth/v1/signup',
  '/auth/v1/token',
  '/auth/v1/logout',
  '/auth/v1/user',
  '/auth/v1/recover'
]

const RATE_LIMITS = [
  { prefix: '/auth/v1/signup', requests: 5, windowSeconds: 3600 },
  { prefix: '/auth/v1/token', requests: 20, windowSeconds: 60 },
  { prefix: '/auth/v1/recover', requests: 3, windowSeconds: 3600 }
]

const DEFAULT_RATE_LIMIT = { requests: 60, windowSeconds: 60 }

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-client-info, accept',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Max-Age': '86400'
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }

    if (!['GET', 'POST'].includes(request.method)) {
      return jsonResponse({ error: 'method_not_allowed' }, 405)
    }

    const url = new URL(request.url)
    const path = url.pathname

    if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
      return jsonResponse({ error: 'proxy_misconfigured' }, 500)
    }

    if (!ALLOWED_PREFIXES.some(prefix => path.startsWith(prefix))) {
      return jsonResponse({ error: 'not_found' }, 404)
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown'
    const limit = resolveRateLimit(path)
    const allowed = await checkRateLimit(env, ip, path, limit)
    if (!allowed) {
      return jsonResponse({ error: 'rate_limited', msg: 'Too many requests. Try again later.' }, 429)
    }

    const upstream = new URL(path + url.search, env.SUPABASE_URL)
    const headers = new Headers()
    headers.set('apikey', env.SUPABASE_ANON_KEY)
    headers.set('Authorization', `Bearer ${env.SUPABASE_ANON_KEY}`)
    headers.set('Content-Type', request.headers.get('Content-Type') || 'application/json')

    const body = request.method === 'POST' ? await request.text() : undefined

    let response
    try {
      response = await fetch(upstream.toString(), {
        method: request.method,
        headers,
        body
      })
    } catch {
      return jsonResponse({ error: 'upstream_unavailable' }, 502)
    }

    const responseBody = await response.text()
    return new Response(responseBody, {
      status: response.status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type': response.headers.get('Content-Type') || 'application/json'
      }
    })
  }
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
  })
}

function resolveRateLimit(path) {
  for (const rule of RATE_LIMITS) {
    if (path.startsWith(rule.prefix)) return rule
  }
  return DEFAULT_RATE_LIMIT
}

async function checkRateLimit(env, ip, path, limit) {
  if (!env.RATE_LIMIT) return true

  const bucket = path.split('/').filter(Boolean).slice(0, 3).join(':')
  const key = `rl:${ip}:${bucket}`
  const raw = await env.RATE_LIMIT.get(key)
  const count = parseInt(raw || '0', 10)

  if (count >= limit.requests) return false

  await env.RATE_LIMIT.put(key, String(count + 1), {
    expirationTtl: limit.windowSeconds
  })
  return true
}
