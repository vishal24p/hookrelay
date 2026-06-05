import { describe, expect, it, vi } from 'vitest'
import {
  formatBytes,
  formatRelative,
  getForwardBadge,
  getSignatureBadge,
  prettyPrintBody,
} from '../ui.js'

describe('ui helpers', () => {
  it('formats relative timestamps from the current clock', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-04T12:00:00.000Z'))

    expect(formatRelative('2026-06-04T12:00:00.000Z')).toBe('Just now')
    expect(formatRelative('2026-06-04T11:59:30.000Z')).toBe('30s ago')
    expect(formatRelative('2026-06-04T11:01:00.000Z')).toBe('59m ago')
    expect(formatRelative('not-a-date')).toBe('Unknown time')

    vi.useRealTimers()
  })

  it('formats byte counts', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1.0 KB')
  })

  it('pretty prints JSON and leaves unsafe-looking text as inert text', () => {
    expect(prettyPrintBody('{"ok":true,"items":[1,2]}')).toContain('\n')
    expect(prettyPrintBody('<script>alert("xss")</script>&')).toBe('<script>alert("xss")</script>&')
    expect(prettyPrintBody('not json')).toBe('not json')
  })

  it('maps forward delivery states to stable badge labels', () => {
    expect(getForwardBadge({ forward_delivery_status: 'pending' })).toEqual({
      tone: 'info',
      label: 'Forwarding',
    })
    expect(getForwardBadge({ forward_delivery_status: 'success' })).toEqual({
      tone: 'success',
      label: 'Delivered',
    })
    expect(getForwardBadge({ forward_delivery_status: 'retry_risk' })).toEqual({
      tone: 'warning',
      label: 'Retry risk',
    })
    expect(getForwardBadge({ forward_delivery_status: 'delivery_failure' })).toEqual({
      tone: 'error',
      label: 'Delivery failure',
    })
    expect(getForwardBadge({ forward_error: 'upstream failed' })).toEqual({
      tone: 'error',
      label: 'Delivery failure',
    })
  })

  it('maps signature states to stable badge labels', () => {
    expect(getSignatureBadge({ signature_status: 'valid' })).toEqual({
      tone: 'success',
      label: 'Signature valid',
    })
    expect(getSignatureBadge({ signature_status: 'invalid' })).toEqual({
      tone: 'error',
      label: 'Signature invalid',
    })
    expect(getSignatureBadge({ signature_status: 'missing_signature' })).toEqual({
      tone: 'warning',
      label: 'Signature missing',
    })
  })
})
