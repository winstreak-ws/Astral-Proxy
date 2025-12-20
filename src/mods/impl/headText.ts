// mods/headText.ts
import type Mod from '../mod.js'
import { logger } from '../../utils/logger.js'
import { getPlayerTags as dataGetPlayerTags } from '../../data/playerData.js'
import { v4 as uuidv4 } from 'uuid'
import tagManager from '../../data/tagManager.js'
import { getConfig } from '../../config/config.js'

const OFFSET_MODE: 'world' | 'yaw' = 'world'
const INCLUDE_SELF = false
const LOG = false

const NO_HITBOX = true
const VISIBLE = false
const HIDE_BASE_PLATE = true
const SHOW_ARMS = false
const MAKE_STANDS_UNCLICKABLE = true

const PROXIMITY_HIDE = true
const HIDE_RADIUS_BLOCKS = 10
const SHOW_RADIUS_BLOCKS = 10.3
const PROXIMITY_TICK_MS = 150

let config = getConfig()
setInterval(() => { config = getConfig() }, 5000)

type TrackedPlayer = {
    eid: number
    uuid?: string
    name?: string
    x: number, y: number, z: number
    yaw: number, pitch: Number
    haveAbsPos: boolean
    sneaking: boolean
    metaInvisible: boolean
    effectInvisible: boolean
    labelShown?: boolean
    tagString?: string
    proximityHidden?: boolean
}

type StandMgr = {
    toClient: any
    players: Map<number, TrackedPlayer>
    stands: Map<number, number>
    enabled: boolean
    selfEid: number | null
    selfPos: { x: number, y: number, z: number, haveAbsPos: boolean }
}

let nextFakeId = 2_000_000
const blocksToFixed = (n: number) => Math.round(n * 32)
const yawByteToRad = (b: number) => ((b & 0xff) * (2 * Math.PI)) / 256

const worldOffsetRaw = (x: number, y: number, z: number) =>
    ({ x: blocksToFixed(x), y: blocksToFixed(y), z: blocksToFixed(z) })

function yawRelativeOffsetRaw(yawByte: number, back: number, right: number, up: number) {
    const r = yawByteToRad(yawByte)
    const fx = -Math.sin(r), fz = Math.cos(r)
    const rx = Math.cos(r), rz = Math.sin(r)
    const dx = (-back * fx) + (right * rx)
    const dz = (-back * fz) + (right * rz)
    return { x: blocksToFixed(dx), y: blocksToFixed(up), z: blocksToFixed(dz) }
}

function spawnArmorStandRaw(toClient: any, xRaw: number, yRaw: number, zRaw: number, yawByte = 0) {
    const entityId = nextFakeId++
    const uuid = uuidv4()
    const ARMOR_STAND_TYPE = 30

    toClient.write('spawn_entity_living', {
        entityId,
        entityUUID: uuid,
        type: ARMOR_STAND_TYPE,
        x: xRaw, y: yRaw, z: zRaw,
        yaw: yawByte, pitch: 0, headPitch: 0,
        velocityX: 0, velocityY: 0, velocityZ: 0,
        metadata: []
    })

    const meta: any[] = []
    if (!VISIBLE) meta.push({ key: 0, type: 0, value: 0x20 })
    let asFlags = 0
    asFlags |= 0x01
    if (SHOW_ARMS) asFlags |= 0x02
    if (HIDE_BASE_PLATE) asFlags |= 0x04
    if (NO_HITBOX) asFlags |= 0x08
    meta.push({ key: 10, type: 0, value: asFlags })
    if (meta.length) toClient.write('entity_metadata', { entityId, metadata: meta })

    return entityId
}

type TagData = { tags: string[]; customtag: string | null }
async function getPlayerTagData(player: string): Promise<TagData> {
    try {
        const res: any = await dataGetPlayerTags(player)
        if (res && Array.isArray(res.tags)) return { tags: res.tags, customtag: res.customtag ?? null }
        if (Array.isArray(res)) return { tags: res, customtag: null }
        return { tags: [], customtag: null }
    } catch (e) {
        logger.error('[headText] Error getting player tags via playerData:', e)
        return { tags: [], customtag: null }
    }
}

function getMinecraftColorByNumber(num: number | string) {
    const colorMap = [
        { code: '§0', rgb: [0, 0, 0] }, { code: '§1', rgb: [0, 0, 170] },
        { code: '§2', rgb: [0, 170, 0] }, { code: '§3', rgb: [0, 170, 170] },
        { code: '§4', rgb: [170, 0, 0] }, { code: '§5', rgb: [170, 0, 170] },
        { code: '§6', rgb: [255, 170, 0] }, { code: '§7', rgb: [170, 170, 170] },
        { code: '§8', rgb: [85, 85, 85] }, { code: '§9', rgb: [85, 85, 255] },
        { code: '§a', rgb: [85, 255, 85] }, { code: '§b', rgb: [85, 255, 255] },
        { code: '§c', rgb: [255, 85, 85] }, { code: '§d', rgb: [255, 85, 255] },
        { code: '§e', rgb: [255, 255, 85] }, { code: '§f', rgb: [255, 255, 255] },
    ]
    let r: number, g: number, b: number
    if (typeof num === 'string' && num.startsWith('#')) num = parseInt(num.slice(1), 16)
    if (typeof num === 'number') {
        r = (num >> 16) & 0xff; g = (num >> 8) & 0xff; b = num & 0xff
    } else return '§f'
    let min = Infinity, best = '§f'
    for (const c of colorMap) {
        const dr = r - c.rgb[0], dg = g - c.rgb[1], db = b - c.rgb[2]
        const d = dr * dr + dg * dg + db * db
        if (d < min) { min = d; best = c.code }
    }
    return best
}

const hideRadiusSq = HIDE_RADIUS_BLOCKS * HIDE_RADIUS_BLOCKS
const showRadiusSq = SHOW_RADIUS_BLOCKS * SHOW_RADIUS_BLOCKS

function distanceSqFromSelf(mgr: StandMgr, p: TrackedPlayer) {
    if (!mgr.selfPos.haveAbsPos) return Infinity
    const dx = (p.x - mgr.selfPos.x) / 32
    const dy = (p.y - mgr.selfPos.y) / 32
    const dz = (p.z - mgr.selfPos.z) / 32
    return dx * dx + dy * dy + dz * dz
}

function wantHidden(mgr: StandMgr, p: TrackedPlayer) {
    if (!PROXIMITY_HIDE) return false
    const d2 = distanceSqFromSelf(mgr, p)
    if (p.proximityHidden) return d2 <= showRadiusSq
    return d2 <= hideRadiusSq
}

export default {
    name: 'headText',
    description: 'Displays player tags above their heads.',
    version: '1.3.0',

    init: (proxy) => {
        if ((proxy as any).__headTextInstalled) {
            if (LOG) logger.debug('[headText] already installed')
            return
        }
        ; (proxy as any).__headTextInstalled = true
        logger.debug('[headText] loaded')

        const mgr: StandMgr = {
            toClient: proxy.client,
            players: new Map(),
            stands: new Map(),
            enabled: true,
            selfEid: null,
            selfPos: { x: 0, y: 0, z: 0, haveAbsPos: false }
        }

        const computeOffsetRaw = (p: TrackedPlayer) => {
            const yOffsetBlocks = (config.levelhead?.yOffset) + 1
            return worldOffsetRaw(0, yOffsetBlocks, 0)
        }

        const desiredHidden = (p: TrackedPlayer) => (p.sneaking || p.metaInvisible || p.effectInvisible)
        const setStandLabelVisible = (eid: number, visible: boolean) => {
            const standId = mgr.stands.get(eid)
            if (!standId) return
            const tp = mgr.players.get(eid)
            if (tp?.labelShown === visible) return
            mgr.toClient.write('entity_metadata', {
                entityId: standId,
                metadata: [{ key: 3, type: 0, value: visible ? 1 : 0 }]
            })
            if (tp) tp.labelShown = visible
            if (LOG) logger.debug(`[headText] label ${visible ? 'shown' : 'hidden'} for eid=${eid}`)
        }
        const applyHiddenState = (eid: number) => {
            const p = mgr.players.get(eid)
            if (!p) return
            const hidden = desiredHidden(p)
            const shouldShow = !hidden && !!p.tagString && !wantHidden(mgr, p)
            setStandLabelVisible(eid, shouldShow)
        }

        const isLobby = (): boolean => {
            const s: any = (proxy as any)?.hypixel?.server
            if (!s) return true
            if (s.status !== 'in_game') return true
            if (s.lobbyName) return true
            if (!s.map) return true
            return false
        }

        const fetchAndApplyTags = async (eid: number) => {
            const p = mgr.players.get(eid)
            if (!p || !p.uuid) return
            
            try {
                const { tags, customtag } = await getPlayerTagData(p.uuid!)
                const displayTags = [...(Array.isArray(tags) ? tags : [])]
                if (isLobby() && customtag) displayTags.unshift(customtag)
                if (displayTags.length > 0) {
                    p.tagString = displayTags.join(' §7| §r')

                    const standId = mgr.stands.get(eid)
                    if (standId) {
                        const hidden = desiredHidden(p) || wantHidden(mgr, p)
                        mgr.toClient.write('entity_metadata', {
                            entityId: standId,
                            metadata: [
                                { key: 2, type: 4, value: p.tagString },
                                { key: 3, type: 0, value: hidden ? 0 : 1 }
                            ]
                        })
                        p.labelShown = !hidden
                        if (LOG) logger.debug(`[headText] applied tags to stand ${standId} for eid=${eid}`)
                    }
                }
            } catch (err) {
                logger.error('[headText] Error fetching player tags:', err)
            }
        }
    const tryApplyCachedTags = (_eid: number) => { /* no-op; handled by playerData caching */ }

        const ensureStandFor = (eid: number) => {
            if (!mgr.enabled || mgr.stands.has(eid)) return
            const p = mgr.players.get(eid)
            if (!p || !p.haveAbsPos) return
            if (eid === mgr.selfEid) return
            if (wantHidden(mgr, p)) {
                const existing = mgr.stands.get(eid)
                if (existing) {
                    mgr.toClient.write('entity_destroy', { entityIds: [existing] })
                    mgr.stands.delete(eid)
                }
                p.proximityHidden = true
                return
            }
            const off = computeOffsetRaw(p)
            const sx = p.x + off.x, sy = p.y + off.y, sz = p.z + off.z
            const standId = spawnArmorStandRaw(mgr.toClient, sx, sy, sz, p.yaw ?? 0)
            mgr.stands.set(eid, standId)
            if (LOG) logger.debug(`[headText] spawned stand ${standId} for eid=${eid} (${p.name ?? 'unknown'})`)

            tryApplyCachedTags(eid)

            if (p.tagString) {
                const hidden = desiredHidden(p) || wantHidden(mgr, p)
                mgr.toClient.write('entity_metadata', {
                    entityId: standId,
                    metadata: [
                        { key: 2, type: 4, value: p.tagString },
                        { key: 3, type: 0, value: hidden ? 0 : 1 }
                    ]
                })
                p.labelShown = !hidden
            }

            applyHiddenState(eid)
        }

        const moveStandToPlayer = (eid: number) => {
            if (!mgr.enabled) return
            const standId = mgr.stands.get(eid)
            const p = mgr.players.get(eid)
            if (!p || !standId) return

            const off = computeOffsetRaw(p)
            mgr.toClient.write('entity_teleport', {
                entityId: standId,
                x: p.x + off.x, y: p.y + off.y, z: p.z + off.z,
                yaw: p.yaw ?? 0,
                pitch: 0
            })
        }

        const destroyStand = (eid: number) => {
            const standId = mgr.stands.get(eid)
            if (!standId) return
            mgr.toClient.write('entity_destroy', { entityIds: [standId] })
            mgr.stands.delete(eid)
            if (LOG) logger.debug(`[headText] destroyed stand ${standId} for eid=${eid}`)
        }

        const destroyAllStands = () => {
            const ids = [...mgr.stands.values()]
            if (ids.length > 0) mgr.toClient.write('entity_destroy', { entityIds: ids })
            mgr.stands.clear()
            if (LOG) logger.debug('[headText] destroyed all stands')
        }

        const enforceProximity = (eid: number) => {
            const p = mgr.players.get(eid)
            if (!p || !p.haveAbsPos) return
            const hidden = wantHidden(mgr, p)

            if (hidden) {
                if (mgr.stands.has(eid)) {
                    const standId = mgr.stands.get(eid)!
                    mgr.toClient.write('entity_destroy', { entityIds: [standId] })
                    mgr.stands.delete(eid)
                }
                p.proximityHidden = true
                return
            }

            p.proximityHidden = false
            if (!mgr.stands.has(eid)) ensureStandFor(eid)
            if (mgr.stands.has(eid)) moveStandToPlayer(eid)
            applyHiddenState(eid)
        }

        proxy.server.on('packet', (data: any, meta: any) => {
            try {
                if (!proxy.entities || !proxy.entity) return

                if (meta.name === 'player_info') {
                    if (data.action === 0 || (data.action & 1)) {
                        for (const item of data.data) {
                            const uuid = String(item.UUID || '').toLowerCase()
                            if (uuid) {
                                dataGetPlayerTags(uuid).catch(() => {})
                            }
                        }
                    }
                    return
                }

                if (meta.name === 'named_entity_spawn') {
                    const eid = data.entityId
                    const st: TrackedPlayer = mgr.players.get(eid) ?? {
                        eid, uuid: undefined, name: undefined,
                        x: 0, y: 0, z: 0, yaw: 0, pitch: 0,
                        haveAbsPos: false,
                        sneaking: false, metaInvisible: false, effectInvisible: false,
                        proximityHidden: false
                    }
                    st.uuid = String(data.playerUUID ?? data.playerUuid ?? data.uuid ?? '').toLowerCase()
                    st.name = proxy.entities?.[eid]?.username ?? st.name
                    st.x = data.x; st.y = data.y; st.z = data.z
                    if (typeof data.yaw === 'number') st.yaw = data.yaw
                    if (typeof data.pitch === 'number') st.pitch = data.pitch
                    st.haveAbsPos = true
                    mgr.players.set(eid, st)

                    if (st.uuid) {
                        tryApplyCachedTags(eid)
                    }

                    if (st.uuid && !st.tagString) {
                        fetchAndApplyTags(eid)
                    }

                    enforceProximity(eid)
                    return
                }

                if (meta.name === 'entity_teleport') {
                    const eid = data.entityId
                    const st = mgr.players.get(eid); if (!st) return
                    st.x = data.x; st.y = data.y; st.z = data.z
                    if (typeof data.yaw === 'number') st.yaw = data.yaw
                    if (typeof data.pitch === 'number') st.pitch = data.pitch
                    st.haveAbsPos = true

                    if (mgr.stands.has(eid) && !wantHidden(mgr, st)) {
                        moveStandToPlayer(eid)
                    } else {
                        enforceProximity(eid)
                    }
                    return
                }

                if (
                    meta.name === 'rel_entity_move' ||
                    meta.name === 'rel_entity_move_look' ||
                    meta.name === 'entity_move_look' ||
                    meta.name === 'entity_look_and_rel_move'
                ) {
                    const eid = data.entityId
                    const st = mgr.players.get(eid); if (!st) return
                    const dX = (data.dX ?? data.dx ?? 0), dY = (data.dY ?? data.dy ?? 0), dZ = (data.dZ ?? data.dz ?? 0)
                    st.x += dX; st.y += dY; st.z += dZ
                    if (typeof data.yaw === 'number') st.yaw = data.yaw
                    if (typeof data.pitch === 'number') st.pitch = data.pitch

                    if (st.haveAbsPos && mgr.stands.has(eid) && !wantHidden(mgr, st)) {
                        moveStandToPlayer(eid)
                    } else if (st.haveAbsPos) {
                        enforceProximity(eid)
                    }
                    return
                }

                if (meta.name === 'entity_look') {
                    const eid = data.entityId
                    const st = mgr.players.get(eid); if (!st) return
                    if (typeof data.yaw === 'number') st.yaw = data.yaw
                    if (typeof data.pitch === 'number') st.pitch = data.pitch
                    
                    if (st.haveAbsPos && mgr.stands.has(eid) && !wantHidden(mgr, st)) {
                        moveStandToPlayer(eid)
                    } else if (st.haveAbsPos) {
                        enforceProximity(eid)
                    }
                    return
                }

                if (meta.name === 'entity_metadata') {
                    const eid = data.entityId
                    const st = mgr.players.get(eid); if (!st) return
                    const list = data.metadata as Array<{ key: number, type: number, value: any }>
                    for (const m of list) {
                        if (m.key === 0 && typeof m.value === 'number') {
                            const flags = m.value as number
                            st.sneaking = (flags & 0x02) !== 0
                            st.metaInvisible = (flags & 0x20) !== 0
                        }
                    }
                    applyHiddenState(eid)
                    return
                }

                if (meta.name === 'entity_effect') {
                    const eid = data.entityId
                    const st = mgr.players.get(eid); if (!st) return
                    if (data.effectId === 14) {
                        st.effectInvisible = true
                        applyHiddenState(eid)
                    }
                    return
                }
                if (meta.name === 'remove_entity_effect') {
                    const eid = data.entityId
                    const st = mgr.players.get(eid); if (!st) return
                    if (data.effectId === 14) {
                        st.effectInvisible = false
                        applyHiddenState(eid)
                    }
                    return
                }

                if (meta.name === 'entity_destroy' && Array.isArray(data.entityIds)) {
                    for (const eid of data.entityIds) {
                        destroyStand(eid)
                        mgr.players.delete(eid)
                    }
                    return
                }

                if (meta.name === 'respawn') {
                    destroyAllStands()
                    mgr.players.clear()
                    mgr.selfEid = null
                    mgr.selfPos = { x: 0, y: 0, z: 0, haveAbsPos: false }
                    return
                }
            } catch (err) {
                logger.error('[headText] Error processing server packet:', err)
            }
        })

        const degToByte = (deg: number) => Math.round(((deg % 360 + 360) % 360) * 256 / 360)

        proxy.server.on('packet', (data: any, meta: any) => {
            if (meta.name === 'join_game') {
                mgr.selfEid = data.entityId
                if (INCLUDE_SELF) {
                    const st: TrackedPlayer = {
                        eid: mgr.selfEid!,
                        uuid: undefined,
                        name: proxy?.client?.username || 'You',
                        x: 0, y: 0, z: 0,
                        yaw: 0, pitch: 0,
                        haveAbsPos: false,
                        sneaking: false, metaInvisible: false, effectInvisible: false,
                        proximityHidden: false
                    }
                    mgr.players.set(mgr.selfEid!, st)
                    if (LOG) logger.debug(`[headText] selfEid=${mgr.selfEid}`)
                }
            }
        })

        proxy.client.on('packet', (data: any, meta: any) => {
            try {
                if (meta.name === 'position' || meta.name === 'position_look') {
                    if (typeof data.x === 'number') mgr.selfPos.x = blocksToFixed(data.x)
                    if (typeof data.y === 'number') mgr.selfPos.y = blocksToFixed(data.y)
                    if (typeof data.z === 'number') mgr.selfPos.z = blocksToFixed(data.z)
                    mgr.selfPos.haveAbsPos = true

                    if (INCLUDE_SELF && mgr.selfEid != null) {
                        const st = mgr.players.get(mgr.selfEid)
                        if (st) {
                            if (typeof data.x === 'number') st.x = blocksToFixed(data.x)
                            if (typeof data.y === 'number') st.y = blocksToFixed(data.y)
                            if (typeof data.z === 'number') st.z = blocksToFixed(data.z)
                            if (typeof data.yaw === 'number') st.yaw = degToByte(data.yaw)
                            if (typeof data.pitch === 'number') st.pitch = degToByte(data.pitch)
                            st.haveAbsPos = true
                            enforceProximity(mgr.selfEid)
                        }
                    }

                    for (const eid of mgr.players.keys()) {
                        const p = mgr.players.get(eid)
                        if (!p || !p.haveAbsPos) continue
                        
                        const standId = mgr.stands.get(eid)
                        const shouldBeHidden = wantHidden(mgr, p)
                        
                        if (shouldBeHidden && standId) {
                            mgr.toClient.write('entity_destroy', { entityIds: [standId] })
                            mgr.stands.delete(eid)
                            p.proximityHidden = true
                        } else if (!shouldBeHidden && !standId && !p.proximityHidden) {
                            ensureStandFor(eid)
                        } else if (!shouldBeHidden && standId) {
                            p.proximityHidden = false
                            moveStandToPlayer(eid)
                        }
                    }
                    return
                }

                if (meta.name === 'look') {
                    return
                }
            } catch (err) {
                logger.error('[headText] Error processing client packet (self tracking):', err)
            }
        })

        setInterval(() => {
            if (!mgr.selfPos.haveAbsPos) return

            for (const eid of mgr.players.keys()) {
                const p = mgr.players.get(eid)
                if (!p || !p.haveAbsPos) continue
                
                const standId = mgr.stands.get(eid)
                const shouldBeHidden = wantHidden(mgr, p)
                
                if (shouldBeHidden && standId) {
                    mgr.toClient.write('entity_destroy', { entityIds: [standId] })
                    mgr.stands.delete(eid)
                    p.proximityHidden = true
                } else if (!shouldBeHidden && !standId && p.proximityHidden) {
                    p.proximityHidden = false
                    ensureStandFor(eid)
                }
            }
        }, PROXIMITY_TICK_MS)

        if (MAKE_STANDS_UNCLICKABLE) {
            proxy.client.on('packet', (data: any, meta: any) => {
                try {
                    if (meta.name === 'use_entity') {
                        const target = data.target ?? data.entityId
                        for (const standId of mgr.stands.values()) {
                            if (target === standId) {
                                return
                            }
                        }
                    }
                } catch { }
            })
        }

        if (LOG) logger.debug('[headText] initialized')

        const onTagsChanged = async (changedUuid: string) => {
            try {
                for (const [eid, tracked] of mgr.players.entries()) {
                    if (!tracked.uuid) continue
                    if (String(tracked.uuid).replace(/-/g, '').toLowerCase() !== String(changedUuid).replace(/-/g, '').toLowerCase()) continue
                    await fetchAndApplyTags(eid)
                }
            } catch { /* ignore */ }
        }
        tagManager.on('tagsChanged', onTagsChanged)
    }
} as Mod
