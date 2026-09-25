import { describe, it, expect, vi } from 'vitest'
import type { VercelRequest, VercelResponse } from '@vercel/node'

const handler = (await import('./callback.js')).default

function mockRes(): VercelResponse {
  const res = {} as VercelResponse
  res.status = vi.fn().mockReturnValue(res)
  res.setHeader = vi.fn().mockReturnValue(res)
  res.send = vi.fn().mockReturnValue(res)
  res.json = vi.fn().mockReturnValue(res)
  return res
}

describe('GET /callback', () => {
  it('renders the code in a copyable block when present', async () => {
    const req = { query: { code: 'abc123' } } as unknown as VercelRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store')
    const html = (res.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(html).toContain('Use this code')
    expect(html).toContain('abc123')
    expect(html).toContain('navigator.clipboard.writeText')
  })

  it('shows the error and error_description when error is present', async () => {
    const req = {
      query: { error: 'access_denied', error_description: 'user declined' },
    } as unknown as VercelRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(200)
    const html = (res.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(html).toContain('access_denied')
    expect(html).toContain('user declined')
  })

  it('returns 400 with a short message when neither code nor error is present', async () => {
    const req = { query: {} } as unknown as VercelRequest
    const res = mockRes()

    await handler(req, res)

    expect(res.status).toHaveBeenCalledWith(400)
    const html = (res.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(html).toContain('No code present')
  })

  it('HTML-escapes a script tag injected via the code param', async () => {
    const req = { query: { code: '<script>alert(1)</script>' } } as unknown as VercelRequest
    const res = mockRes()

    await handler(req, res)

    const html = (res.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('does not log the code', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const req = { query: { code: 'super-secret-code' } } as unknown as VercelRequest
    const res = mockRes()

    await handler(req, res)

    const loggedAnywhere = [...logSpy.mock.calls, ...errorSpy.mock.calls].some((call) =>
      call.some((arg) => typeof arg === 'string' && arg.includes('super-secret-code'))
    )
    expect(loggedAnywhere).toBe(false)

    logSpy.mockRestore()
    errorSpy.mockRestore()
  })
})
