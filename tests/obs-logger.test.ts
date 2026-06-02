import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

import { createLogger } from '@/lib/obs/logger'

describe('structured logger', () => {
  let logSpy: ReturnType<typeof vi.spyOn>
  let warnSpy: ReturnType<typeof vi.spyOn>
  let errSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    delete process.env.LOG_LEVEL
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('emits a JSON line with level, event and bound context', () => {
    const log = createLogger({ traceId: 't1', orgId: 'o1' })
    log.info('agent_turn_start', { agentId: 'a1' })
    expect(logSpy).toHaveBeenCalledOnce()
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string)
    expect(parsed).toMatchObject({
      level: 'info',
      event: 'agent_turn_start',
      traceId: 't1',
      orgId: 'o1',
      agentId: 'a1',
    })
    expect(typeof parsed.time).toBe('string')
  })

  it('child() merges and overrides context', () => {
    const log = createLogger({ traceId: 't1', orgId: 'o1' }).child({ agentId: 'a1', orgId: 'o2' })
    log.warn('x')
    const parsed = JSON.parse(warnSpy.mock.calls[0][0] as string)
    expect(parsed).toMatchObject({ traceId: 't1', orgId: 'o2', agentId: 'a1' })
  })

  it('serializes Error objects into name/message/stack', () => {
    createLogger().error('boom', { error: new Error('nope') })
    const parsed = JSON.parse(errSpy.mock.calls[0][0] as string)
    expect(parsed.error).toMatchObject({ name: 'Error', message: 'nope' })
    expect(typeof parsed.error.stack).toBe('string')
  })

  it('respects LOG_LEVEL threshold', () => {
    process.env.LOG_LEVEL = 'warn'
    const log = createLogger()
    log.info('skipped')
    log.warn('kept')
    expect(logSpy).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledOnce()
  })

  it('routes error->console.error, warn->console.warn, info->console.log', () => {
    const log = createLogger()
    log.error('e')
    log.warn('w')
    log.info('i')
    expect(errSpy).toHaveBeenCalledOnce()
    expect(warnSpy).toHaveBeenCalledOnce()
    expect(logSpy).toHaveBeenCalledOnce()
  })

  it('does not throw on circular structures', () => {
    const a: Record<string, unknown> = {}
    a.self = a
    expect(() => createLogger().info('cycle', { a })).not.toThrow()
    const parsed = JSON.parse(logSpy.mock.calls[0][0] as string)
    expect(parsed.a.self).toBe('[Circular]')
  })
})
