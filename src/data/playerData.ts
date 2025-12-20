// Help class to fetch data for players from cache or fetch from winstreak servers

import cacheMaster from './cacheMaster.js'
import { getConfig } from '../config/config.js'
import { logger } from '../utils/logger.js'
import wsClient from './websocketClient.js'
import { TextDecoder } from 'util'
import tagManager from './tagManager.js'
import rateLimiter from './rateLimiter.js'
import axios from 'axios'

export type PlayerTagsResult = { tags: string[]; customtag: string | null; tagsDetailed?: Array<{ text: string; description: string }> }

const TTL = {
    tags: 30 * 60 * 1000,           // 30 minutes
    blacklist: 10 * 60 * 1000,      // 10 minutes
    ping: 5 * 60 * 1000,            // 5 minutes
    bordic: 10 * 60 * 1000,         // 10 minutes (kept for potential future re-enable)
    keyValidation: 10 * 60 * 1000,  // 10 minutes
} as const

function normalizeUUID(uuid: string): string {
    return String(uuid).toLowerCase().replace(/-/g, '')
}

function getTagSettingsSignature(): string {
    try {
        const cfg: any = getConfig()
        const ts = (cfg && cfg.tagSettings) || {}
        const order = ['blacklist', 'unverified', 'gaps', 'nacc', 'ping', 'radar', 'rnc', 'statacc']
        const str = order.map(k => `${k}:${ts[k] !== false ? 1 : 0}`).join('|')
        let h = 0
        for (let i = 0; i < str.length; i++) {
            h = ((h << 5) - h + str.charCodeAt(i)) | 0
        }
        return Math.abs(h).toString(36)
    } catch {
        return '0'
    }
}

// ---- Tag batching queue to reduce API calls and avoid 429 ----
const TAG_BATCH_SIZE = 60
const TAG_BATCH_DELAY_MS = 2000
let tagBatchQueue = new Set<string>()
let tagBatchTimer: NodeJS.Timeout | null = null
let tagBatchInFlight = false
const tagResolvers = new Map<string, Array<(res: PlayerTagsResult) => void>>()
const knownTagPlayers = new Set<string>()
let lastTagSignature = ''
let lastUrchinEnabled = false

function stripMc(s: string): string {
    return String(s).replace(/§[0-9a-fk-or]/gi, '')
}

function scheduleTagBatchFlush() {
    if (tagBatchQueue.size >= TAG_BATCH_SIZE) {
        if (!tagBatchInFlight) {
            void flushTagBatch()
        }
        return
    }
    if (tagBatchTimer) return
    tagBatchTimer = setTimeout(() => {
        tagBatchTimer = null
        if (!tagBatchInFlight) {
            void flushTagBatch()
        } else {
            scheduleTagBatchFlush()
        }
    }, TAG_BATCH_DELAY_MS)
}

function pickAndFormatCustomTag(tags: Array<{ name: string, color?: number | string, description?: string }>): { formatted: string | null, remaining: Array<{ name: string, color?: number | string, description?: string }> } {
    let custom: { name: string, color?: number | string, description?: string } | undefined
    const remaining: Array<{ name: string, color?: number | string, description?: string }> = []
    const isRadar = (n: string) => /^Radar \(\d+%\)$/.test(n)
    for (const t of tags) {
        const name = String(t?.name ?? '')
        let colorNum: number | null = null
        if (typeof t.color === 'number') colorNum = t.color
        else if (typeof t.color === 'string' && t.color.startsWith('#')) {
            const v = parseInt(t.color.slice(1), 16)
            if (!Number.isNaN(v)) colorNum = v
        }
        if (!custom && colorNum === 7_498_734 && name !== 'I' && !isRadar(name)) custom = t
        else remaining.push(t)
    }
    const formatted = custom ? `${getMinecraftColorByNumber(custom.color)}${custom.name}§r` : null
    return { formatted, remaining }
}

async function flushTagBatch() {
    if (tagBatchInFlight) return
    const players = Array.from(tagBatchQueue)
    if (players.length === 0) return
    tagBatchQueue.clear()
    tagBatchInFlight = true
    try {
        let res: Record<string, PlayerTagsResult> | null = null;
        try {
            const cfg: any = getConfig()
            const ts = (cfg && cfg.tagSettings) || {}
            const params: Record<string, string> = { color: 'true' }
            if (ts.blacklist === false) params.blacklist = 'false'
            if (ts.gaps === false) params.gaps = 'false'
            if (ts.nacc === false) params.nacc = 'false'
            if (ts.ping === false) params.ping = 'false'
            if (ts.radar === false) params.radar = 'false'
            if (ts.rnc === false) params.rnc = 'false'
            if (ts.statacc === false) params.statacc = 'false'
            if (ts.unverified === false) params.unverified = 'false'

            const wsRes = await wsJson<any>('POST', '/v1/player/tags', params, { players })
            if (wsRes && wsRes.results) {
                const out: Record<string, PlayerTagsResult> = {}
                for (const [player, playerData] of Object.entries<any>(wsRes.results)) {
                    let tags = (playerData?.tags ?? []) as Array<{ name: string, color?: number | string, description?: string }>
                    const { formatted: customtag, remaining } = pickAndFormatCustomTag(tags)
                    const formattedTags = remaining.map(t => `${getMinecraftColorByNumber(t.color)}${replaceTagNames(t.name)}§r`)
                    const detailed = remaining.map(t => ({ text: `${getMinecraftColorByNumber(t.color)}${replaceTagNames(t.name)}§r`, description: t.description ?? '...' }))
                    out[String(player).toLowerCase()] = { tags: formattedTags, customtag, tagsDetailed: detailed }
                }
                res = out
            }
        } catch { }
        if (!res) {
            console.warn('[playerData] Tag batch fetch failed or returned no data');
            return;
        }
        const sig = getTagSettingsSignature()
        for (const p of players) {
            const payload = (res && res[p]) ? res[p] : { tags: [], customtag: null, tagsDetailed: [] }
            cacheMaster.setJson(`playerTags:${sig}:${p}`, payload.tags, TTL.tags)
            cacheMaster.setJson(`playerCustomTag:${sig}:${p}`, { v: payload.customtag }, TTL.tags)
            cacheMaster.setJson(`playerTagsDetailed:${sig}:${p}`, payload.tagsDetailed ?? [], TTL.tags)
            const combined = tagManager.combine(p, payload.tags)
            const resolvers = tagResolvers.get(p) || []
            const baseDescMap = new Map<string, string>()
            for (const d of payload.tagsDetailed || []) {
                const plain = stripMc(d.text)
                if (plain) baseDescMap.set(plain, d.description || '...')
            }
            const combinedDetailed = combined.map(t => {
                const plain = stripMc(t)
                const desc = baseDescMap.get(plain) || '...'
                return { text: t, description: desc }
            })
            for (const resolve of resolvers) resolve({ tags: combined, customtag: payload.customtag, tagsDetailed: combinedDetailed })
            tagResolvers.delete(p)
            tagManager.notifyChanged(p)
        }

        try {
            const cfg: any = getConfig()
            const ts = (cfg && cfg.tagSettings) || {}
            if (ts.urchin !== false) {
                for (const p of players) {
                    void getPurpleTags(p).then(purpleTags => {
                        if (!Array.isArray(purpleTags) || purpleTags.length === 0) return
                        tagManager.clearTags(p, 'urchin')
                        tagManager.addTags(p, purpleTags.map(t => ({ name: t.name, color: 0xAA00FF, description: t.description })), 'urchin')
                        try {
                            const sig = getTagSettingsSignature()
                            const existingDetailed = cacheMaster.getJson(`playerTagsDetailed:${sig}:${p}`) as Array<{ text: string; description: string }> | null
                            const map = new Map<string, string>()
                            for (const d of existingDetailed || []) map.set(stripMc(d.text), d.description || '...')
                            for (const t of purpleTags) {
                                const formatted = `${getMinecraftColorByNumber(0xAA00FF)}${replaceTagNames(t.name)}§r`
                                map.set(stripMc(formatted), t.description || '...')
                            }
                            const out = Array.from(map.entries()).map(([text, desc]) => ({ text: text ? `${text}` : text, description: desc }))
                            const combined = tagManager.combine(p, cacheMaster.getJson(`playerTags:${sig}:${p}`) as string[] || [])
                            const detailedFinal: Array<{ text: string; description: string }> = combined.map(t => ({ text: t, description: map.get(stripMc(t)) || '...' }))
                            cacheMaster.setJson(`playerTagsDetailed:${sig}:${p}`, detailedFinal, TTL.tags)
                        } catch {
                            /* ignore caching errors */
                        }
                        tagManager.notifyChanged(p)
                    }).catch(() => { /* ignore individual failures */ })
                }
            }
        } catch { /* ignore */ }
    } catch (e) {
        for (const p of players) {
            const resolvers = tagResolvers.get(p) || []
            for (const resolve of resolvers) resolve({ tags: [], customtag: null, tagsDetailed: [] })
            tagResolvers.delete(p)
        }
    } finally {
        tagBatchInFlight = false
    }
}

function enqueueTagRequest(uuid: string): Promise<PlayerTagsResult> {
    const clean = normalizeUUID(uuid)
    knownTagPlayers.add(clean)
    const cacheKey = `playerTags:${getTagSettingsSignature()}:${clean}`
    const cached = cacheMaster.getJson(cacheKey)
    if (cached) {
        const tags = tagManager.combine(clean, cached as string[])
        const ct = cacheMaster.getJson(`playerCustomTag:${getTagSettingsSignature()}:${clean}`) as { v?: string | null } | null
        const customtag = ct?.v ?? null
        const baseDetailed = cacheMaster.getJson(`playerTagsDetailed:${getTagSettingsSignature()}:${clean}`) as Array<{ text: string; description: string }> | null
        const descMap = new Map<string, string>()
        for (const d of baseDetailed || []) {
            const plain = stripMc(d.text)
            if (plain) descMap.set(plain, d.description || '...')
        }
        const tagsDetailed = tags.map(t => {
            const plain = stripMc(t)
            const desc = descMap.get(plain) || '...'
            return { text: t, description: desc }
        })
        return Promise.resolve({ tags, customtag, tagsDetailed })
    }

    return new Promise<PlayerTagsResult>((resolve) => {
        const arr = tagResolvers.get(clean) || []
        arr.push(resolve)
        tagResolvers.set(clean, arr)
        tagBatchQueue.add(clean)
        scheduleTagBatchFlush()
    })
}

// Tags (single) via batching queue (combined API + mod tags), plus customtag separated
export async function getPlayerTags(uuid: string): Promise<PlayerTagsResult> {
    const res = await enqueueTagRequest(uuid)
    const combined = tagManager.combine(uuid, res.tags)
    const descMap = new Map<string, string>()
    for (const d of res.tagsDetailed || []) {
        const plain = stripMc(d.text)
        if (plain) descMap.set(plain, d.description || '...')
    }
    const tagsDetailed = combined.map(t => {
        const plain = stripMc(t)
        const desc = descMap.get(plain) || '...'
        return { text: t, description: desc }
    })
    return { tags: combined, customtag: res.customtag, tagsDetailed }
}

// Tags (batch) via batching queue, returning both standard tags and customtag per player
export async function getMultiplePlayerTags(uuids: string[]): Promise<Record<string, PlayerTagsResult>> {
    const normalized = uuids.map(normalizeUUID)
    const result: Record<string, PlayerTagsResult> = {}
    const pending: Array<Promise<void>> = []

    for (const id of normalized) {
        const cacheKey = `playerTags:${getTagSettingsSignature()}:${id}`
        const cached = cacheMaster.getJson(cacheKey)
        if (cached) {
            const tags = tagManager.combine(id, cached as string[])
            const customtag = cacheMaster.getJson(`playerCustomTag:${getTagSettingsSignature()}:${id}`) as string | null
            const baseDetailed = cacheMaster.getJson(`playerTagsDetailed:${getTagSettingsSignature()}:${id}`) as Array<{ text: string; description: string }> | null
            const descMap = new Map<string, string>()
            for (const d of baseDetailed || []) {
                const plain = stripMc(d.text)
                if (plain) descMap.set(plain, d.description || '...')
            }
            const tagsDetailed = tags.map(t => {
                const plain = stripMc(t)
                const desc = descMap.get(plain) || '...'
                return { text: t, description: desc }
            })
            result[id] = { tags, customtag: customtag ?? null, tagsDetailed }
        } else {
            const p = enqueueTagRequest(id).then(res => {
                const combined = tagManager.combine(id, res.tags)
                const descMap = new Map<string, string>()
                for (const d of res.tagsDetailed || []) {
                    const plain = stripMc(d.text)
                    if (plain) descMap.set(plain, d.description || '...')
                }
                const tagsDetailed = combined.map(t => {
                    const plain = stripMc(t)
                    const desc = descMap.get(plain) || '...'
                    return { text: t, description: desc }
                })
                result[id] = { tags: combined, customtag: res.customtag, tagsDetailed }
            })
            pending.push(p)
        }
    }

    if (pending.length > 0) await Promise.all(pending)
    return result
}

// -- Live config change handling to add/remove tags immediately --
function primeSignatureState() {
    try {
        lastTagSignature = getTagSettingsSignature()
        const cfg: any = getConfig()
        lastUrchinEnabled = (cfg && cfg.tagSettings && cfg.tagSettings.urchin !== false)
    } catch { /* ignore */ }
}

async function forceRecomputeAllKnownTags() {
    try {
        for (const p of knownTagPlayers) tagBatchQueue.add(p)
        await flushTagBatch()
    } catch { /* ignore */ }
}

primeSignatureState()
setInterval(async () => {
    try {
        const currentSig = getTagSettingsSignature()
        const cfg: any = getConfig()
        const urchinEnabled = (cfg && cfg.tagSettings && cfg.tagSettings.urchin !== false)
        let needRecompute = false

        if (currentSig !== lastTagSignature) {
            lastTagSignature = currentSig
            needRecompute = true
        }

        if (urchinEnabled !== lastUrchinEnabled) {
            if (!urchinEnabled) {
                for (const p of knownTagPlayers) {
                    tagManager.clearTags(p, 'urchin')
                    tagManager.notifyChanged(p)
                }
            } else {
                needRecompute = true
            }
            lastUrchinEnabled = urchinEnabled
        }

        if (needRecompute && knownTagPlayers.size > 0) {
            await forceRecomputeAllKnownTags()
        }
    } catch { /* ignore */ }
}, 1000)

// Ping info
export async function getPlayerPingInfo(uuid: string): Promise<{ averagePing: number | null; lastPingUnix: number | null; lastPingFormatted: string | null }> {
    const clean = normalizeUUID(uuid)
    const cacheKey = `playerPing:${clean}`
    const cached = cacheMaster.getJson(cacheKey)
    if (cached) return cached as any

    let data: { averagePing: number | null; lastPingUnix: number | null; lastPingFormatted: string | null } | null = null
    try {
        const wsData = await wsJson<any>('GET', '/v1/player/ping', { player: clean })
        if (wsData) {
            const averagePing = (wsData?.average && typeof wsData.average.average === 'number') ? wsData.average.average : null
            let lastPingUnix: number | null = null
            if (Array.isArray(wsData?.history) && wsData.history.length > 0) {
                const latest = wsData.history.reduce((latest: any, current: any) =>
                    Number(current.timestamp) > Number(latest.timestamp) ? current : latest
                )
                lastPingUnix = Number(latest.timestamp) || null
            }
            let lastPingFormatted: string | null = null
            if (lastPingUnix) {
                const lastPing = new Date(lastPingUnix)
                const now = new Date()
                const msDiff = now.getTime() - lastPing.getTime()
                const totalDays = Math.floor(msDiff / (1000 * 60 * 60 * 24))
                let years = now.getFullYear() - lastPing.getFullYear()
                let months = now.getMonth() - lastPing.getMonth()
                let days = now.getDate() - lastPing.getDate()
                if (days < 0) { months -= 1 }
                if (months < 0) { years -= 1; months += 12 }
                if (years > 0) lastPingFormatted = `${years}y ${months}m ago`
                else if (months > 0) lastPingFormatted = `${months}m ${Math.max(0, days)}d ago`
                else lastPingFormatted = `${totalDays}d ago`
            }
            data = { averagePing, lastPingUnix, lastPingFormatted }
        }
    } catch { }
    if (!data) {
        data = { averagePing: null, lastPingUnix: null, lastPingFormatted: null }
        console.warn('[playerData] Ping info fetch failed or returned no data');
    }
    cacheMaster.setJson(cacheKey, data, TTL.ping)
    return data
}

// Blacklist tag messages (formatted)
export async function getBlacklistTagMessages(uuid: string): Promise<{ tagMsg: string, customTagMsg: string }> {
    const { tags } = await getPlayerTags(uuid)
    const tagMsg = tags.length > 0 ? `§7[${tags.join('§7, ')}§7] ` : ''
    return { tagMsg, customTagMsg: '' }
}

// !! DEPRECATED!! Bordic winstreak (not used currently)
export async function getBordicWinstreak(_uuid: string): Promise<number | null> {
    return null
}

// Bedwars Tabstats
export async function getBedwarsTabstats(uuid: string): Promise<{ level: number; finals: number; fkdr: number; wins: number; wlr: number; kills: number; deaths: number; kdr: number; beds: number; bblr: number; winstreak: number; rank: string; rankPlusColor: string; } | null> {
    const clean = normalizeUUID(uuid)
    const cacheKey = `bedwarsTabstats:${clean}`
    const cached = cacheMaster.getJson(cacheKey)
    if (cached) return cached as any

    let data: { level: number; finals: number; fkdr: number; wins: number; wlr: number; kills: number; deaths: number; kdr: number; beds: number; bblr: number; winstreak: number; rank: string; rankPlusColor: string; } | null = null
    try {
        const wsData = await wsJson<any>('GET', '/v1/player/bedwars/tabstats', { player: clean, rank: 'true' })
        if (wsData) {
            data = {
                level: typeof wsData.level === 'number' ? wsData.level : 0,
                finals: typeof wsData.finals === 'number' ? wsData.finals : 0,
                fkdr: typeof wsData.fkdr === 'number' ? wsData.fkdr : 0,
                wins: typeof wsData.wins === 'number' ? wsData.wins : 0,
                wlr: typeof wsData.wlr === 'number' ? wsData.wlr : 0,
                kills: typeof wsData.kills === 'number' ? wsData.kills : 0,
                deaths: typeof wsData.deaths === 'number' ? wsData.deaths : 0,
                kdr: typeof wsData.kdr === 'number' ? wsData.kdr : 0,
                beds: typeof wsData.beds === 'number' ? wsData.beds : 0,
                bblr: typeof wsData.bblr === 'number' ? wsData.bblr : 0,
                winstreak: typeof wsData.winstreak === 'number' ? wsData.winstreak : 0,
                rank: typeof wsData.rank === 'string' ? wsData.rank : 'None',
                rankPlusColor: typeof wsData.rankPlusColor === 'string' ? wsData.rankPlusColor : '',
            }
        }
    } catch { /* fallthrough */ }

    if (!data) data = null
    if (data) {
        cacheMaster.setJson(cacheKey, data, TTL.bordic)
    }
    return data
}

// Validate winstreak key (not shield; OK to cache briefly)
export async function validateWinstreakKey(key: string): Promise<{ valid: boolean; status: number }> {
    const cacheKey = `winstreakKeyValid:${key}`
    const cached = cacheMaster.getJson(cacheKey)
    if (cached) return cached as any

    const url = `https://api.winstreak.ws/v1/user?key=${encodeURIComponent(key)}`
    try {
        await rateLimiter.acquire(1)
        const res = await fetch(url)
        if (res.status === 403) return { valid: false, status: 403 }
        cacheMaster.setJson(cacheKey, { valid: res.ok, status: res.status }, TTL.keyValidation)
        return { valid: res.ok, status: res.status }
    } catch {
        cacheMaster.setJson(cacheKey, { valid: false, status: 0 }, TTL.keyValidation)
        return { valid: false, status: 0 }
    }
}

// Shield endpoints — no caching
export async function shieldPartyJoin(req: { join_secret: string; discord: string; uuid: string }): Promise<boolean> {
    const wsData = await wsJson<any>('POST', '/shield/party/join', {}, req)
    return wsData !== null
}

export async function shieldPartyConfirmInvite(join_secret: string, discord: string): Promise<boolean> {
    const wsData = await wsJson<any>('POST', '/shield/party/confirminvite', {}, { join_secret, discord })
    return wsData !== null
}

export async function shieldPartyPending(join_secret: string): Promise<{ discord: string; uuid: string }[]> {
    const wsData = await wsJson<any>('GET', '/shield/party/pending', { join_secret })
    return wsData?.pending ?? []
}


export async function getPurpleTags(uuid: string): Promise<Array<{ name: string; description?: string }>> {

    function formatTag(tag: string): string {
        switch (tag.toLowerCase()) {
            case 'legit_sniper':
                return 'LS';
            case 'possible_sniper':
                return 'PS';
            case 'sniper':
                return 'S';
            case 'confirmed_cheater':
                return '✔C';
            case 'blatant_cheater':
                return 'BC';
            case 'closet_cheater':
                return 'CC';
            case 'caution':
                return '⚠';
            case 'info':
                return 'ℹ';
            case 'account':
                return '⚐';
            default:
                return tag;
        }
    }

    // Sorry for the b64 encryption here lol
    // It has its reasons.
    const url = Buffer.from('aHR0cHM6Ly9jb3JhbC51cmNoaW4ud3MvYXBpL3VyY2hpbj8=', 'base64').toString('utf-8')
    try {
        const res = await axios.get(
            `${url}?uuid=${uuid}`,
            {
                headers: {
                    'Accept': '*/*',
                    'Accept-Encoding': 'gzip, deflate, br',
                    'Cookie': 'coral_theme=dark;',
                    'Priority': 'u=1, i',
                    'Referer': Buffer.from('aHR0cHM6Ly9jb3JhbC51cmNoaW4ud3MvV2luc3RyZWFrT25Ub3A=', 'base64').toString('utf-8'),
                    'Sec-CH-UA': '"Chromium";v="141", "Google Chrome";v="141", ";Not A Brand";v="99"',
                    'Sec-CH-UA-Mobile': '?0',
                    'Sec-CH-UA-Platform': '"Windows"',
                    'Sec-Fetch-Dest': 'empty',
                    'Sec-Fetch-Mode': 'cors',
                    'Sec-Fetch-Site': 'same-origin',
                    'Sec-GPC': '1',
                    'User-Agent': Buffer.from('TW96aWxsYS81LjAgKFdpbmRvd3MgTlQgMTAuMDsgV2luNjQ7IHg2NCkgQXBwbGVXZWJLaXQvNTM3LjM2IChLSFRNTCwgbGlrZSBHZWNrbykgQ2hyb21lLzE0MS4wLjAuMCBTYWZhcmkvNTM3LjM2', 'base64').toString('utf-8')
                },
                timeout: 5000
            })

        if (res.status === 200 && Array.isArray(res.data?.tags)) {
            const tags: Array<{ name: string; description?: string }> = []
            for (const tagObj of res.data.tags) {
                const f = formatTag(tagObj.type)
                tags.push({ name: f, description: tagObj.reason })
            }
            return tags
        }

    } catch {
        return []
    }

    return []
}

// --- WebSocket helpers ---
const __td = new TextDecoder()
async function wsJson<T = any>(method: 'GET' | 'POST' | 'DELETE' | 'PUT', path: string, params: Record<string, string> = {}, body: Record<string, any> = {}): Promise<T | null> {

    if (!wsClient.connected) return null
    try {
        const strBody: Record<string, string> = {}
        for (const [k, v] of Object.entries(body)) {
            strBody[k] = typeof v === 'string' ? v : JSON.stringify(v)
        }
        const res = await wsClient.callApi(method, path, params, strBody)
        if (res.status < 200 || res.status >= 300) return null
        const text = __td.decode(res.data)
        return JSON.parse(text) as T
    } catch {
        return null
    }
}

function getMinecraftColorByNumber(num: number | string | undefined) {
    const colorMap = [
        { code: '§0', rgb: [0, 0, 0] }, { code: '§1', rgb: [0, 0, 170] },
        { code: '§2', rgb: [0, 170, 0] }, { code: '§3', rgb: [0, 170, 170] },
        { code: '§4', rgb: [170, 0, 0] }, { code: '§5', rgb: [170, 0, 170] },
        { code: '§6', rgb: [255, 170, 0] }, { code: '§7', rgb: [170, 170, 170] },
        { code: '§8', rgb: [85, 85, 85] }, { code: '§9', rgb: [85, 85, 255] },
        { code: '§a', rgb: [85, 255, 85] }, { code: '§b', rgb: [85, 255, 255] },
        { code: '§c', rgb: [255, 85, 85] }, { code: '§d', rgb: [255, 85, 255] },
        { code: '§e', rgb: [255, 255, 85] }, { code: '§f', rgb: [255, 255, 255] },
    ] as const
    if (num === undefined) return '§f'
    const toRGB = (n: number) => [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff] as const
    let r: number, g: number, b: number
    if (typeof num === 'string' && num.startsWith('#')) {
        const n = parseInt(num.slice(1), 16)
            ;[r, g, b] = toRGB(n)
    } else if (typeof num === 'number') {
        ;[r, g, b] = toRGB(num)
    } else {
        return '§f'
    }
    let min = Infinity, best = '§f'
    for (const c of colorMap) {
        const dr = r - c.rgb[0], dg = g - c.rgb[1], db = b - c.rgb[2]
        const d = dr * dr + dg * dg + db * db
        if (d < min) { min = d; best = c.code }
    }
    return best
}

function replaceTagNames(name: string): string {
    switch (name.toLowerCase()) {
        case 'w': return '⚠';
        case 'i': return 'ℹ';

        default: return name;
    }
}