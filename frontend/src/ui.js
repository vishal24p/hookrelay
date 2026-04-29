export const uiFontStack = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
export const codeFontStack = '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace'

export function generateSessionId() {
  return Math.random().toString(36).slice(2, 10)
}

export function getSessionFromUrl() {
  const hash = window.location.hash.replace('#', '')
  return hash || null
}

export function formatTime(value) {
  if (!value) return 'No activity yet'
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function formatDateTime(value) {
  if (!value) return 'Not available'
  return new Date(value).toLocaleString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function formatRelative(value) {
  if (!value) return 'No activity yet'

  const diffMs = Date.now() - new Date(value).getTime()
  const seconds = Math.max(0, Math.floor(diffMs / 1000))
  if (seconds < 60) return `${seconds}s ago`

  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`

  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

export function getEventSize(event) {
  const encoder = new TextEncoder()
  const bodyBytes = event?.body ? encoder.encode(event.body).length : 0
  return formatBytes(bodyBytes)
}

export function formatBytes(bytes) {
  if (!bytes) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function prettyPrintBody(raw) {
  if (!raw) return 'No payload body'

  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

export function prettyPrintObject(value) {
  if (!value || (typeof value === 'object' && Object.keys(value).length === 0)) {
    return 'Not available in current event schema'
  }
  return JSON.stringify(value, null, 2)
}

export function getForwardBadge(event) {
  if (event?.forward_error) {
    return { tone: 'error', label: 'Forward error' }
  }
  if (event?.forward_status == null) {
    return { tone: 'info', label: 'Not forwarded' }
  }
  if (event.forward_status >= 200 && event.forward_status < 300) {
    return { tone: 'success', label: `${event.forward_status} OK` }
  }
  if (event.forward_status >= 400 && event.forward_status < 500) {
    return { tone: 'warning', label: `${event.forward_status} Client error` }
  }
  return { tone: 'error', label: `${event.forward_status} Server error` }
}

export async function readJson(response) {
  const text = await response.text()
  const contentType = response.headers.get('content-type') || ''
  let payload = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }

  if (!response.ok) {
    if (payload && typeof payload === 'object' && payload.detail) {
      throw new Error(String(payload.detail))
    }
    if (typeof payload === 'string' && payload.trim()) {
      throw new Error(payload.trim())
    }
    throw new Error(`Request failed with status ${response.status}.`)
  }

  if (typeof payload === 'string' && contentType.includes('text/html')) {
    throw new Error('HookRelay API is not reachable from this frontend origin.')
  }

  return payload
}

export function getErrorMessage(error, fallback) {
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export async function copyText(value) {
  try {
    await navigator.clipboard.writeText(value)
    return true
  } catch {
    return false
  }
}
