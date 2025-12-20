import { getConfig } from '../config/config.js'
import { logger } from '../utils/logger.js'

type RateInfo = {
  maxRequests: number
  remainingRequests: number
  resetTime: number
}

class UnifiedRateLimiter {
  private max = 60
  private remaining = 60
  private windowSeconds = 60
  private resetAt = Date.now() + 60_000
  private inited = false
  private initPromise: Promise<void> | null = null
  private waiters: Array<() => void> = []
  private resetTimer: NodeJS.Timeout | null = null
  private lastKey: string | null = null

  private scheduleReset(delayMs: number) {
    if (this.resetTimer) clearTimeout(this.resetTimer)
    this.resetTimer = setTimeout(() => {
      this.remaining = this.max
      this.resetAt = Date.now() + this.windowSeconds * 1000
      while (this.remaining > 0 && this.waiters.length > 0) {
        this.remaining -= 1
        const w = this.waiters.shift()!
        try { w() } catch { /* no-op */ }
      }
      this.scheduleReset(this.windowSeconds * 1000)
    }, Math.max(0, delayMs))
  }

  private applyRateInfo(info: RateInfo) {
    this.max = Math.max(1, Number(info.maxRequests) || 60)
    this.remaining = Math.min(this.max, Math.max(0, Number(info.remainingRequests) || 0))
    this.windowSeconds = Math.max(1, Number(info.resetTime) || 60)
    this.resetAt = Date.now() + this.windowSeconds * 1000
    this.inited = true
    this.scheduleReset(this.windowSeconds * 1000)
  }

  async refreshFromApi(bypassLimiter = true): Promise<void> {
    const cfg = getConfig()
    const key = (cfg.General.winstreakKey || '').trim()
    if (!key) {
      this.inited = false
      this.lastKey = null
      return
    }
    this.lastKey = key
    const url = `https://api.winstreak.ws/v1/user?key=${encodeURIComponent(key)}`
    try {
      if (!bypassLimiter && this.inited) await this.acquire(1)
      const res = await fetch(url, { headers: { 'User-Agent': 'Astral WebSocketServer/1.0' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: any = await res.json()
      if (data?.rate_limit) this.applyRateInfo(data.rate_limit as RateInfo)
      else throw new Error('Missing rate_limit in response')
    } catch (e) {
      if (!this.inited) {
        this.applyRateInfo({ maxRequests: 60, remainingRequests: 60, resetTime: 60 })
      }
    }
  }

  init(): void {
    if (this.initPromise) return
    this.initPromise = this.refreshFromApi(true)

    setInterval(async () => {
      try {
        const key = (getConfig()?.General.winstreakKey || '').trim()
        if (key && key !== this.lastKey) {
          this.max = 60; this.remaining = 60; this.windowSeconds = 60; this.resetAt = Date.now()
          this.waiters.length = 0
          await this.refreshFromApi(true)
        }
      } catch { /* no-op */ }
    }, 2_000)
  }

  private ensureWindow() {
    const now = Date.now()
    if (now >= this.resetAt) {
      this.remaining = this.max
      this.resetAt = now + this.windowSeconds * 1000
    }
  }

  async acquire(count = 1): Promise<void> {
    if (!this.initPromise) this.init()
    await this.initPromise

    if (count <= 0) return
    this.ensureWindow()
    if (this.remaining >= count) {
      this.remaining -= count
      return
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve)
    })
  }

  getRemaining(): number { return this.remaining }
  getMax(): number { return this.max }
  getResetInMs(): number { return Math.max(0, this.resetAt - Date.now()) }
}

export const rateLimiter = new UnifiedRateLimiter()
export default rateLimiter

// Hypixel API rate limiter for user-provided API keys
// Defaults to 60 requests/minute and adjusts using Hypixel response headers:
// 'RateLimit-Limit' (max/min), 'RateLimit-Remaining', 'RateLimit-Reset' (seconds to reset)
class HypixelRateLimiter {
  private max = 60
  private remaining = 60
  private windowSeconds = 60
  private resetAt = Date.now() + 60_000
  private waiters: Array<() => void> = []
  private resetTimer: NodeJS.Timeout | null = null

  private scheduleReset(delayMs: number) {
    if (this.resetTimer) clearTimeout(this.resetTimer)
    this.resetTimer = setTimeout(() => {
      this.remaining = this.max
      this.resetAt = Date.now() + this.windowSeconds * 1000
      while (this.remaining > 0 && this.waiters.length > 0) {
        this.remaining -= 1
        const w = this.waiters.shift()!
        try { w() } catch { /* no-op */ }
      }
      this.scheduleReset(this.windowSeconds * 1000)
    }, Math.max(0, delayMs))
  }

  private ensureWindow() {
    const now = Date.now()
    if (now >= this.resetAt) {
      this.remaining = this.max
      this.resetAt = now + this.windowSeconds * 1000
    }
  }

  async acquire(count = 1): Promise<void> {
    if (count <= 0) return
    this.ensureWindow()
    if (this.remaining >= count) {
      this.remaining -= count
      return
    }
    await new Promise<void>((resolve) => {
      this.waiters.push(resolve)
    })
  }

  updateFromHeaders(headers: Headers | Record<string, any> | undefined | null): void {
    if (!headers) return

    const get = (name: string): string | undefined => {
      try {
        if (typeof (headers as any).get === 'function') {
          const v = (headers as any).get(name) || (headers as any).get(name.toLowerCase())
          return v === null ? undefined : v
        }
      } catch { /* ignore */ }
      const h = headers as Record<string, any>
      const direct = h[name]
      if (direct !== undefined) return Array.isArray(direct) ? String(direct[0]) : String(direct)
      const lower = h[name.toLowerCase()]
      if (lower !== undefined) return Array.isArray(lower) ? String(lower[0]) : String(lower)
      return undefined
    }

    const limitStr = get('RateLimit-Limit')
    const remainingStr = get('RateLimit-Remaining')
    const resetStr = get('RateLimit-Reset')

    const limit = limitStr ? Number(limitStr) : undefined
    const remaining = remainingStr ? Number(remainingStr) : undefined
    const reset = resetStr ? Number(resetStr) : undefined

    let changed = false
    if (!Number.isNaN(limit!) && limit !== undefined) { this.max = Math.max(1, limit); changed = true }
    if (!Number.isNaN(remaining!) && remaining !== undefined) { this.remaining = Math.max(0, Math.min(this.max, remaining)); changed = true }
    if (!Number.isNaN(reset!) && reset !== undefined) { this.windowSeconds = Math.max(1, reset); changed = true }

    if (changed) {
      this.resetAt = Date.now() + this.windowSeconds * 1000
      this.scheduleReset(this.windowSeconds * 1000)
    }
  }

  getRemaining(): number { return this.remaining }
  getMax(): number { return this.max }
  getResetInMs(): number { return Math.max(0, this.resetAt - Date.now()) }
}

export const hypixelRateLimiter = new HypixelRateLimiter()
