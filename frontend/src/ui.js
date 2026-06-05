export const uiFontStack = 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
export const codeFontStack = '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace'
export const razorpayFixtureOptions = [
  { key: 'payment_captured', label: 'Payment captured' },
  { key: 'payment_failed', label: 'Payment failed' },
  { key: 'order_paid', label: 'Order paid' },
  { key: 'refund_processed', label: 'Refund processed' },
  { key: 'subscription_charged', label: 'Subscription charged' },
]

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

  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return 'Unknown time'

  const diffMs = Date.now() - timestamp

  const seconds = Math.max(0, Math.floor(diffMs / 1000))
  if (seconds < 60) return seconds === 0 ? 'Just now' : `${seconds}s ago`

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
  switch (event?.forward_delivery_status) {
    case 'pending':
      return { tone: 'info', label: 'Forwarding' }
    case 'success':
      return { tone: 'success', label: 'Delivered' }
    case 'retry_risk':
      return { tone: 'warning', label: 'Retry risk' }
    case 'delivery_failure':
      return { tone: 'error', label: 'Delivery failure' }
    case 'not_forwarded':
      return { tone: 'info', label: 'Not forwarded' }
    default:
      break
  }

  if (event?.forward_error) {
    return { tone: 'error', label: 'Delivery failure' }
  }
  if (event?.forward_status == null) {
    return { tone: 'info', label: 'Not forwarded' }
  }
  if (event.forward_status >= 200 && event.forward_status < 300) {
    return { tone: 'success', label: 'Delivered' }
  }
  return { tone: 'warning', label: 'Retry risk' }
}

export function getSignatureBadge(event) {
  switch (event?.signature_status) {
    case 'valid':
      return { tone: 'success', label: 'Signature valid' }
    case 'invalid':
      return { tone: 'error', label: 'Signature invalid' }
    case 'missing_secret':
      return { tone: 'warning', label: 'Secret missing' }
    case 'missing_signature':
      return { tone: 'warning', label: 'Signature missing' }
    default:
      return { tone: 'info', label: 'Not checked' }
  }
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
