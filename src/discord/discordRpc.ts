import DiscordRPC from 'discord-rpc';
import crypto from 'crypto';

import { logger } from '../utils/logger.js';
import Player from '../player/player.js';
import { HypixelParty } from './party/HypixelParty.js';
import { HypixelPartyHost } from './party/HypixelPartyHost.js';
import { HypixelPartyMember } from './party/HypixelPartyMember.js';

import EventEmitter from 'events';
export const discordEvents = new EventEmitter();

import fs from 'fs';
import path from 'path';
import { getConfigPath } from '../utils/paths.js';
import { getDataDir } from '../utils/paths.js';

const clientId = '1392485661730148433';

let interval0: NodeJS.Timeout | null = null;
let interval1: NodeJS.Timeout | null = null;

let RPC: DiscordRPC.Client | null = null;

let startupTimestamp: number = Date.now();
let playStartTimestamp: number | null = null;
let party: { size: number; max: number } | null = null;
let details: string = 'Idle';
let state: string | null = null
let partyId: string | null = null;
let joinSecret: string | null = null;

let currentParty: HypixelParty | null = null;

let proxy: Player | null = null; // Needs to be called after the proxy is created

let proxyConnected: boolean = false;

async function init() {

    if (RPC) {
        logger.warn('Discord RPC is already initialized.');
        return;
    }

    RPC = new DiscordRPC.Client({ transport: 'ipc' });

    DiscordRPC.register(clientId);

    RPC.on('ready', async () => {
        const discordUserPath = getConfigPath('discord-user.json');
        try {
            fs.writeFileSync(discordUserPath, JSON.stringify(RPC.user, null, 2), 'utf8');
        } catch (e) {
            logger.error('Failed to write user.json:', e);
        }
        logger.rpc('Discord RPC connected successfully!');
        updateDiscordActivity();

        discordEvents.emit('ready');

        RPC.subscribe('ACTIVITY_JOIN');
        RPC.subscribe('ACTIVITY_JOIN_REQUEST');
        interval0 = setInterval(updateDiscordActivity, 15000);
        // Register party loop

        interval1 = setInterval(() => {
            if (!RPC || !proxy) return;

            //logger.debug(JSON.stringify(proxy.hypixel.server));

            if (currentParty && currentParty instanceof HypixelPartyHost) {
                runHostLoop();
            }
            getPartyStatus();

        }, 30000);
    })

    RPC.on('disconnected', async () => {
        logger.warn('Discord RPC disconnected, attempting to reconnect...');
        RPC = null;
        setTimeout(() => {
            init(); // Reinitialize the RPC client after a short delay
        }, 60000);
    });

    RPC.on('error', (error) => {
        logger.error('Discord RPC error:', error);
    });

    RPC.on('ACTIVITY_JOIN_REQUEST', onActivityJoinRequest);
    RPC.on('ACTIVITY_JOIN', onActivityJoin);

    RPC.login({ clientId })
        .catch((err) => {
            if (err.message && err.message.includes("RPC_CONNECTION_TIMEOUT")) {
                logger.error("Discord RPC Timed out, please try again in ~30 seconds");
            } else {
                logger.error("Discord RPC error:", err);
            }
        });
}

type GamemodeConfig = Record<string, Record<string, { details: string; state: string | null }>>;
let dynamicConfig: GamemodeConfig | null = null;
let lastConfigLoad = 0;
const CONFIG_TTL_MS = 60_000; // reload at most once per minute

function loadDynamicConfig(): GamemodeConfig | null {
    const now = Date.now();
    if (dynamicConfig && now - lastConfigLoad < CONFIG_TTL_MS) return dynamicConfig;
    try {
        const p = path.join(getDataDir(), 'gamelist.json');
        if (fs.existsSync(p)) {
            const raw = fs.readFileSync(p, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === 'object') {
                dynamicConfig = parsed as GamemodeConfig;
                lastConfigLoad = now;
                return dynamicConfig;
            }
        }
    } catch (err) {
        logger.warn('Failed to load gamelist.json:', err);
    }
    return dynamicConfig;
}

function resolveActivity(gamemode: string | undefined, mode: string | undefined): { details: string; state: string | null } {
    if (!gamemode) return { details: details, state: state };
    const cfg = loadDynamicConfig();
    if (!cfg) return { details: `Playing ${gamemode}`, state: mode || null };
    const gmEntry = cfg[gamemode] || cfg['*'];
    if (!gmEntry) return { details: `Playing ${gamemode}`, state: mode || null };
    const modeEntry = (mode && gmEntry[mode]) ? gmEntry[mode] : (gmEntry['*'] || null);
    if (modeEntry) return { details: modeEntry.details, state: modeEntry.state === undefined ? null : modeEntry.state };
    return { details: `Playing ${gamemode}`, state: mode || null };
}

async function updateDiscordActivity() {
    if (!RPC) return;

    const status = proxy ? proxy.hypixel.server.status : 'offline';
    const gamemode = proxy ? proxy.hypixel.server.serverType : undefined;
    const mode = proxy ? proxy.hypixel.server.mode : undefined;
    const server = proxy ? proxy.hypixel.server.serverName : undefined;

    if (status === 'lobby') {
        details = 'In Hypixel Lobby';
        state = null;
    } else if (status === 'in_game') {
        if (server === 'limbo') {
            details = 'In Limbo';
            state = null;
        } else if (gamemode) {
            const resolved = resolveActivity(gamemode, mode);
            details = resolved.details.includes('Playing') || resolved.details.includes('Watching') ? resolved.details : `Playing ${gamemode}`;
            details = resolved.details;
            state = resolved.state;
            if (!resolved.state && mode) {
                state = mode || null;
            }
        }
    }

    if (!proxyConnected) {
        details = 'Idle';
        state = null;
    }

    const mcUsername = proxy && proxy.client && proxy.client.username ? proxy.client.username : undefined;

    RPC.setActivity({
        details: details,
        largeImageKey: 'logo_astral',
        smallImageKey: mcUsername ? `https://minotar.net/helm/${mcUsername}/100.png` : undefined,
        partySize: party !== null ? party.size : undefined,
        partyMax: party !== null ? party.max : undefined,
        largeImageText: 'Playing on Hypixel',
        smallImageText: mcUsername ? `Playing as ${mcUsername}` : undefined,
        state: state !== null ? state : undefined,
        startTimestamp: !playStartTimestamp ? playStartTimestamp : startupTimestamp,
        instance: false,
        partyId: partyId !== null ? partyId : undefined,
        joinSecret: joinSecret !== null ? joinSecret : undefined,
    }).catch((err) => {
        logger.error('Failed to set Discord activity:', err);
    });
}

async function registerProxyListeners() {
    if (!proxy) return;

    proxy.server.on('custom_payload', (packet) => {
        if (
            packet.channel === 'hypixel:party_info' &&
            packet.data &&
            typeof packet.data === 'object'
        ) {
            let buffer: Buffer | null = null;
            const keys = Object.keys(packet.data);
            if (keys.every(k => !isNaN(Number(k)))) {
                const bytes = keys
                    .sort((a, b) => Number(a) - Number(b))
                    .map(k => packet.data[k] as number);
                buffer = Buffer.from(bytes);
            } else if (Array.isArray((packet.data as any).data)) {
                buffer = Buffer.from((packet.data as any).data);
            }

            if (buffer) {
                const uuids: string[] = [];
                let offset = 4;
                while (offset + 16 <= buffer.length) {
                    const uuidBytes = buffer.subarray(offset, offset + 16);
                    if (uuidBytes.every(b => b === 0)) break;
                    const hex = uuidBytes.toString('hex');
                    const uuid = [
                        hex.slice(0, 8),
                        hex.slice(8, 12),
                        hex.slice(12, 16),
                        hex.slice(16, 20),
                        hex.slice(20, 32)
                    ].join('-');
                    uuids.push(uuid);
                    offset += 16;
                }

                if (!proxy) return;

                if (uuids.length !== 0) {

                    setPartySize(uuids.length, uuids.length + 1);
                    setPartyId(uuids);
                } else {
                    setPartyId([proxy.client.uuid]);
                    if (!currentParty) createParty();
                }

            } else {
                logger.warn('Uknown party_info buffer:', packet.data);
            }
        }
    });
}

async function onActivityJoinRequest(request: DiscordRPC.ActivityJoinRequest) {
    logger.info(`Received join request from ${request.user.username}#${request.user.discriminator} (${request.user.id})`);

    if (proxy && currentParty) {

        proxy.client.write('chat', {
            message: JSON.stringify({
                text: '',
                strikethrough: false,
                extra: [
                    {
                        text: `\n§9§l[Discord] §e${request.user.username} §rwants to join your party `,
                        strikethrough: false,
                    },
                    {
                        text: `\n§b§l[Send Invite]\n`,
                        strikethrough: false,
                        clickEvent: {
                            action: 'run_command',
                            value: `/a:discordrpc invite ${request.user.id}`,
                        },
                    },
                ],
            }),
        });

    } else {
        logger.warn('No current party to confirm invite for.');
    }
}


async function onActivityJoin(request: DiscordRPC.ActivityJoin) {

    if (!proxy || !RPC) return;
    logger.info(`Sending join party event to Winstreak server...`)

    console.log(JSON.stringify(request));

    // Reset party data
    currentParty = new HypixelPartyMember(request.secret, RPC.user.id, proxy.client.uuid);
    joinSecret = request.secret;
    updateDiscordActivity();

    proxy.client.write('chat', {
        message: JSON.stringify({
            text: '',
            strikethrough: false,
            extra: [
                {
                    text: `\n§9§l[Discord] §rRequesting Hypixel party invite... This may take 30 seconds.`,
                    strikethrough: false,
                }
            ],
        }),
    });

    (currentParty as HypixelPartyMember).sendJoinRequest();
}

async function createParty() {
    if (!proxy) return;

    const party = new HypixelPartyHost(RPC.user.id, proxy.client.uuid);
    currentParty = party;

    joinSecret = party.join_secret;
    updateDiscordActivity();

    return party;
}

async function getPartyStatus() {
    if (!proxy) return;
    proxy.server.write('custom_payload', {
        channel: 'hypixel:party_info',
        data: Buffer.from([2])
    });
}

function setProxy(newProxy: Player) {
    if (newProxy) {
        proxy = newProxy;
        registerProxyListeners();
    } else {
        logger.warn('No proxy provided to Discord RPC.');
    }
}

function setDetails(newDetails: string) {
    details = newDetails;
    if (RPC) {
        updateDiscordActivity();
    }
}

function setState(newState: string | null) {
    state = newState;
    if (RPC) {
        updateDiscordActivity();
    }
}

function setPartySize(size: number, max: number) {
    party = { size, max };
    if (RPC) {
        updateDiscordActivity();
    }
}

function setPlayStartTimestamp(timestamp: number) {
    playStartTimestamp = timestamp;
    if (RPC) {
        updateDiscordActivity();
    }
}

function setPartyId(uuids: string[]) {
    const anchor = uuids[0];

    party = { size: uuids.length, max: uuids.length + 1 };

    const hash = crypto.createHash('md5').update(`hypxl:${anchor}`).digest('hex');

    if (partyId !== hash) {
        partyId = hash;
        if (RPC) {
            updateDiscordActivity();
        }
    }
}

async function sendInvite(userId: string): Promise<boolean | undefined> {
    if (!RPC || !proxy) return;

    if (!currentParty) createParty();

    try {
        await RPC.sendJoinInvite(userId);
        logger.info(`Invite sent to user ${userId}`);
        return true
    } catch (error) {
        logger.error(`Failed to send invite to user ${userId}:`, error);
        return false;
    }
}

async function runHostLoop() {
    if (!RPC || !proxy) return;
    if (!currentParty) {
        logger.error('No current party to host.');
        return;
    }

    const pending = await (currentParty as HypixelPartyHost).getPendingJoins();

    if (pending.length === 0) {
        return;
    }

    logger.info(`Pending join requests: ${pending.length}`);
    for (const request of pending) {
        logger.info(`Processing join request from ${request.discord} (${request.uuid})`);

        const confirmed = await (currentParty as HypixelPartyHost).confirmInvite(request.discord);
        if (confirmed) {
            logger.info(`Invite confirmed for ${request.discord}`);
            proxy.server.write('chat', {
                message: `/party invite ${request.uuid}`,
            })
        } else {
            logger.warn(`Failed to confirm invite for ${request.discord}`);
        }
    }
}

function setProxyConnected(connected: boolean) {
    proxyConnected = connected;
    if (RPC) {
        updateDiscordActivity();
    }

    if (!connected) {
        details = 'Idle';
        state = null;
        party = null;
        partyId = null;
        joinSecret = null;
        playStartTimestamp = null;
        currentParty = null;
    }
}

export default {
    init,
    setDetails,
    setState,
    setPartySize,
    setPlayStartTimestamp,
    updateDiscordActivity: updateDiscordActivity,
    setPartyId,
    setProxy,
    sendInvite,
    createParty,
    getPartyStatus,
    setProxyConnected,
};