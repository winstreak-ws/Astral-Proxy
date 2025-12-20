
import WebSocket from 'ws';
import * as astralProtocol from './astralProtocol.js';
import { HttpMethod, ApiParam, ApiResponse } from './astralProtocol.js';
import { getConfig, setConfig } from '../config/config.js';
import { logger, parseMinecraftColors } from '../utils/logger.js';
import { RawData } from 'ws';
import rateLimiter from './rateLimiter.js';
import { getFullConfig, updateFullConfig, updateSingleConfigField } from './configTools.js';

// Want to see the beautiful raw bytecode sent and received from winstreak's servers?
// Just set this to true !
const LOG_RAW_WEBSOCKET = false;
const SOCKET_URL = 'wss://astral.winstreak.ws/socket';

function uuidToBytes(uuid: string): Uint8Array {
    const hex = uuid.replace(/-/g, '');
    if (hex.length !== 32) throw new Error('Invalid UUID format for API key');
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
        bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    }
    return bytes;
}

export function decodeIrcEvent(buf: Uint8Array): { type: "join" | "leave", id: string, name: string } {
    let off = 0;
    const type = buf[off++] === 1 ? "join" : "leave";
    const idLen = buf[off++];
    const id = buf.slice(off, off + idLen).toString(); off += idLen;
    const nameLen = buf[off++];
    const name = buf.slice(off, off + nameLen).toString();
    return { type, id, name };
}

class Client {
    private keepaliveInterval: NodeJS.Timeout | null = null;
    client: WebSocket | null = null;
    connected: boolean = false;
    shouldBeConnected: boolean = false;
    static API_KEY: string | null = null;
    private token: string | null = null;
    private nextRequestId = 1;
    private pending: Map<number, (res: astralProtocol.ApiResponse) => void> = new Map();
    private userAstralPending: Map<string, { resolves: Array<(v: boolean | string | { prefix?: string; identity?: string }) => void>; rejects: Array<(err: any) => void>; timer: NodeJS.Timeout }> = new Map();
    private inflight: Map<string, Promise<astralProtocol.ApiResponse>> = new Map();
    private ircListener: ((sender: string, message: string, userId: string) => void) | null = null;
    private ircEventListener: ((type: "join" | "leave", name: string, userId: string) => void) | null = null;
    private userNames: Map<string, string> = new Map();
    private ircSelfId?: string;
    private ircSelfName?: string;
    private userListResolvers: Set<(users: astralProtocol.IrcUserEntry[]) => void> = new Set();
    private lastPresence: { joined: boolean; channel: string; password: string } = {
        joined: false,
        channel: 'global',
        password: ''
    };

    constructor() {
        const config = getConfig();
        const apiKey = config.General.winstreakKey;
        if (!apiKey || String(apiKey).trim() === '') {
            logger.error('[API] No winstreakKey set in config');
        }
        Client.API_KEY = String(apiKey).trim() || null;
        this.shouldBeConnected = true;
        try {
            this.client = new WebSocket(SOCKET_URL);
            this.internalConnect();
        } catch (e) {
            logger.error('Failed to initialize WebSocket on start:', e);
        }
    }

    private buildRequestKey(
        method: astralProtocol.HttpMethod,
        path: string,
        query: astralProtocol.ApiParam[] = [],
        body: astralProtocol.ApiParam[] = []
    ): string {
        const norm = (arr: astralProtocol.ApiParam[]) =>
            arr
                .slice()
                .sort((a, b) => {
                    const k = a.key.localeCompare(b.key);
                    if (k !== 0) return k;
                    return String(a.value).localeCompare(String(b.value));
                })
                .map(p => `${p.key}=${p.value}`)
                .join('&');
        return `${method}|${path}|q:${norm(query)}|b:${norm(body)}`;
    }

    private internalConnect(): void {
        const ws = this.client;
        if (!ws) return;

        const startKeepalive = () => {
            if (this.keepaliveInterval) clearInterval(this.keepaliveInterval);
            this.keepaliveInterval = setInterval(() => {
                if (this.connected && this.client && this.client.readyState === WebSocket.OPEN) {
                    if (LOG_RAW_WEBSOCKET) logger.irc('[WS SEND] <ping>');
                    this.client.ping?.();
                }
            }, 30000); // 30 seconds
        };

        ws.addEventListener('open', () => {
            this.connected = true;
            this.shouldBeConnected = true;
            startKeepalive();
            try {
                // Refresh API key from config on each connection
                const cfg = getConfig();
                Client.API_KEY = String(cfg.General.winstreakKey || '').trim() || null;
                // Initialize rate limiter when we have a key
                rateLimiter.init();
                const keyBytes = uuidToBytes(Client.API_KEY!);
                const frame = astralProtocol.encodeAuth(keyBytes);
                if (LOG_RAW_WEBSOCKET) {
                    logger.info(`[WS SEND] ${Buffer.from(frame).toString('hex')}`);
                }
                ws.send(frame);
            } catch (e) {
                logger.error('Failed to encode API key:', e);
                this.shouldBeConnected = false;
                this.safeClose();
            }
        });

        ws.on('message', (data: RawData) => {
            let buf: Uint8Array;
            if (data instanceof Uint8Array) {
                buf = data;
            } else if (data instanceof ArrayBuffer) {
                buf = new Uint8Array(data);
            } else if (data instanceof Buffer) {
                buf = new Uint8Array(data);
            } else {
                logger.error("Unsupported message type:", typeof data);
                return;
            }
            if (LOG_RAW_WEBSOCKET) {
                logger.info(`[WS RECV] ${Buffer.from(buf).toString('hex')}`);
            }
            if (buf.length < 3) return;
            const opcode = buf[0];
            const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
            const length = dv.getUint16(1);
            const payload = buf.slice(3, 3 + length);

            switch (opcode) {
                case astralProtocol.Opcode.API_RESPONSE: {
                    const res = astralProtocol.decodeApiResponse(payload);
                    const handler = this.pending.get(res.requestId);
                    if (handler) {
                        handler(res);
                        this.pending.delete(res.requestId);
                    }
                    break;
                }
                case astralProtocol.Opcode.CHAT_BROADCAST: {
                    const msg = astralProtocol.decodeChatBroadcast(payload);
                    const idStr = msg.ircID;
                    const sender = msg.ircName || this.userNames.get(idStr.replace(/-/g, '')) || idStr;
                    if (this.ircListener) this.ircListener(sender, msg.message, idStr);
                    break;
                }
                case astralProtocol.Opcode.IRC_EVENT: {
                    const evt = decodeIrcEvent(payload);
                    if (evt.id === this.ircSelfId) break;
                    if (this.ircEventListener) this.ircEventListener(evt.type, evt.name, evt.id);

                    break;
                }
                case astralProtocol.Opcode.USER_LIST: {
                    try {
                        const decoded = astralProtocol.decodeUserListPayload(payload);
                        // Cache the names
                        decoded.users.forEach(u => {
                            if (u.id && u.name) this.userNames.set(u.id.replace(/-/g, ''), u.name);
                        });
                        for (const resolve of this.userListResolvers) {
                            try { resolve(decoded.users); } catch { }
                        }
                        this.userListResolvers.clear();
                    } catch (e) {
                        logger.error('Failed to decode USER_LIST payload:', e);
                    }
                    break;
                }
                case astralProtocol.Opcode.AUTH: {
                    let off = 0;
                    const success = payload[off++] === 1;

                    if (!success) {
                        logger.error('Authentication failed, closing WebSocket connection');
                        this.shouldBeConnected = false;
                        this.safeClose();
                        this.connected = false;
                        break;
                    }

                    const idLen = payload[off++];
                    const ircID = Buffer.from(payload.slice(off, off + idLen)).toString('utf8');
                    off += idLen;

                    const nameLen = payload[off++];
                    const ircName = Buffer.from(payload.slice(off, off + nameLen)).toString('utf8');
                    off += nameLen;

                    const ircEnabled = payload[off++] === 1;

                    // Persist IRC settings to config if changed
                    try {
                        const cfg = getConfig();
                        const irc = cfg.ircSettings || {};
                        const next = {
                            ...cfg,
                            ircSettings: {
                                ...irc,
                                winstreakUsername: ircName,
                                ircId: ircID,
                            },
                        };
                        const changed = irc.winstreakUsername !== ircName
                            || irc.winstreakUsername !== ircName
                            || irc.ircId !== ircID;
                        if (changed) setConfig(next);
                    } catch (e) {
                        logger.error('Failed to persist IRC info to config:', e);
                    }

                    // Cache self id/name mapping for display
                    this.ircSelfId = ircID;
                    this.ircSelfName = ircName;
                    if (ircID && ircName) this.userNames.set(ircID.replace(/-/g, ''), ircName);

                    logger.irc(`OK -> IRC { id=${ircID}, name=${parseMinecraftColors(ircName)}, enabled=${ircEnabled} }`);
                    // After successful auth, refresh rate limit info
                    rateLimiter.init();
                    // If we were previously in a channel, re-send presence join now
                    try {
                        if (this.lastPresence.joined) {
                            const frame = astralProtocol.encodeUserPresence('join', this.lastPresence.channel, this.lastPresence.password);
                            if (LOG_RAW_WEBSOCKET) logger.info(`[WS SEND] ${Buffer.from(frame).toString('hex')}`);
                            ws.send(frame);
                            logger.debug(`[IRC] Re-sent presence join for channel '${this.lastPresence.channel}' after reconnect.`);
                        }
                        if(this.token) {
                            this.resendAccessToken();
                        }
                    } catch (e) {
                        logger.error('Failed to re-send IRC presence on auth:', e);
                    }
                    break;
                }
                case astralProtocol.Opcode.CONFIG_REQUEST: {
                    const config = getFullConfig();
                    const frame = astralProtocol.encodeConfigUpload(config);
                    ws.send(frame);
                    break;
                }
                case astralProtocol.Opcode.CONFIG_DOWNLOAD: {
                    const config = astralProtocol.decodeConfigDownload(payload);

                    if (!config || typeof config !== 'object') {
                        logger.error('Invalid CONFIG_DOWNLOAD payload:', payload);
                        break;
                    }

                    updateFullConfig(config);
                    break;
                }
                case astralProtocol.Opcode.CONFIG_CHANGE: {
                    const change = astralProtocol.decodeConfigChange(payload);

                    if (!change || typeof change !== 'object') {
                        logger.error('Invalid CONFIG_CHANGE payload:', payload);
                        break;
                    }

                    updateSingleConfigField(change.key, change.value);
                    break;
                }
                case astralProtocol.Opcode.USER_ASTRAL_RESPONSE: {
                    const result = astralProtocol.decodeAstralUserResponse(payload);
                    if (result && result.uuid) {
                        const pending = this.userAstralPending.get(result.uuid);
                        if (pending) {
                            try { clearTimeout(pending.timer); } catch { }
                            for (const res of pending.resolves) {
                                try {
                                    // Prefer identity if present, else prefix; fallback to boolean
                                    if (typeof result.identity === 'string' && result.identity.length > 0) {
                                        res({ identity: result.identity, prefix: result.prefix });
                                    } else if (typeof result.prefix === 'string' && result.prefix.length > 0) {
                                        res(result.prefix);
                                    } else {
                                        res(!!result.isOnAstral);
                                    }
                                } catch { }
                            }
                            this.userAstralPending.delete(result.uuid);
                        }
                    }
                    break;
                }
            }
        });

        ws.addEventListener('close', () => {
            this.connected = false;
            if (this.keepaliveInterval) {
                clearInterval(this.keepaliveInterval);
                this.keepaliveInterval = null;
            }

            // Reopen connection after a short delay
            setTimeout(() => {
                if (!this.connected && this.shouldBeConnected) {
                    logger.irc('Reconnecting to WebSocket...');
                    this.client = new WebSocket(SOCKET_URL);
                    this.internalConnect();
                }
            }, 5000); // 5 seconds

        });
        ws.addEventListener('error', (error) => {
            logger.error('WebSocket error: ', error);
            if (this.keepaliveInterval) {
                clearInterval(this.keepaliveInterval);
                this.keepaliveInterval = null;
            }
        });
    }

    private safeClose(code?: number, reason?: string): void {
        if (!this.client) return;
        try {
            if (this.client.readyState === WebSocket.OPEN) {
                this.client.close(code, reason);
            } else {
                // Avoid throwing "WebSocket was closed before the connection was established"
                (this.client as any).terminate?.();
            }
        } catch { /* ignore */ }
    }

    restart(): boolean {
        this.shouldBeConnected = true;
        if (!this.connected) {
            // Just ensure connect
            this.ensureConnected();
            return true;
        }
        try {
            this.safeClose();
        } catch (e) {
            logger.error('Error while closing WebSocket:', e);
            return false;
        }
        this.connected = false;
        if (this.keepaliveInterval) {
            clearInterval(this.keepaliveInterval);
            this.keepaliveInterval = null;
        }
        this.pending.clear();
        this.client = new WebSocket(SOCKET_URL);
        this.internalConnect();
        return true;
    }

    ensureConnected(): void {
        this.shouldBeConnected = true;
        if (this.connected) return;
        // Create a new websocket if previous one was closed or doesn't exist
        if (!this.client || this.client.readyState === WebSocket.CLOSED || this.client.readyState === WebSocket.CLOSING) {
            this.client = new WebSocket(SOCKET_URL);
        }
        this.internalConnect();
    }

    shutdown(): void {
        this.shouldBeConnected = false;
        if (this.keepaliveInterval) {
            clearInterval(this.keepaliveInterval);
            this.keepaliveInterval = null;
        }
        this.safeClose();
        this.connected = false;
        this.pending.clear();
    }


    // ----------------------
    // SEND API REQUEST
    // ----------------------
    async sendApiRequest(
        method: astralProtocol.HttpMethod,
        path: string,
        query: astralProtocol.ApiParam[] = [],
        body: astralProtocol.ApiParam[] = []
    ): Promise<astralProtocol.ApiResponse> {
        if (!this.connected) throw new Error('WebSocket not connected');

        const dedupeKey = this.buildRequestKey(method, path, query, body);
        const existing = this.inflight.get(dedupeKey);
        if (existing) return existing;

        const acquireP = rateLimiter.acquire(1);

        const requestId = this.nextRequestId++;
        const frame = astralProtocol.encodeApiRequest({
            requestId,
            method,
            path,
            query,
            body,
        });

        if (LOG_RAW_WEBSOCKET) {
            logger.info(`[WS SEND] ${Buffer.from(frame).toString('hex')}`);
        }

        const promise = new Promise<astralProtocol.ApiResponse>(async (resolve, reject) => {
            try {
                await acquireP;
            } catch (e) {
                this.inflight.delete(dedupeKey);
                return reject(e);
            }
            this.pending.set(requestId, (res) => {
                if (res.status >= 200 && res.status < 300) {
                    this.inflight.delete(dedupeKey);
                    return resolve(res);
                } else {
                    this.inflight.delete(dedupeKey);
                    return reject(new Error(`API Error ${res.status}`));
                }
            });
            try {
                this.client!.send(frame);
            } catch (e) {
                this.inflight.delete(dedupeKey);
                this.pending.delete(requestId);
                return reject(e);
            }
        });

        this.inflight.set(dedupeKey, promise);
        return promise;
    }

    async callApi(
        method: "GET" | "POST" | "DELETE" | "PUT",
        path: string,
        params: Record<string, string> = {},
        body: Record<string, string> = {}
    ): Promise<ApiResponse> {
        if (!this.connected) throw new Error('WebSocket not connected');

        let methodEnum: HttpMethod;
        switch (method.toUpperCase()) {
            case "GET": methodEnum = HttpMethod.GET; break;
            case "POST": methodEnum = HttpMethod.POST; break;
            case "DELETE": methodEnum = HttpMethod.DELETE; break;
            case "PUT": methodEnum = HttpMethod.PUT; break;
            default: throw new Error(`Unknown HTTP method: ${method}`);
        }

        const query: ApiParam[] = Object.entries(params).map(([k, v]) => ({ key: k, value: v }));
        const bodyArr: ApiParam[] = Object.entries(body).map(([k, v]) => ({ key: k, value: v }));

        return this.sendApiRequest(methodEnum, path, query, bodyArr);
    }

    // ----------------------
    // SEND CHAT MESSAGE
    // ----------------------
    sendChatMessage(msg: string): void {
        if (!this.connected) throw new Error('WebSocket not connected');
        const frame = astralProtocol.encodeChatMessage(msg);
        this.client!.send(frame);
    }

    // ----------------------
    // USER PRESENCE (IRC join/leave)
    // ----------------------
    joinIrc(channel?: string, channelPassword?: string): void {
        if (!this.connected) {
            // try to connect and skip if still not ready
            try { this.ensureConnected(); } catch { }
            if (!this.connected) return;
        }
        const cfg = getConfig();
        const chan = channel ?? cfg.ircSettings.channel ?? 'General';
        const pwd = channelPassword ?? cfg.ircSettings.channelPassword ?? '';

        cfg.ircSettings.channel = chan;
        cfg.ircSettings.channelPassword = pwd;
        cfg.ircSettings.ircToggle = true;
        setConfig(cfg);

        try {
            this.lastPresence.joined = true;
            this.lastPresence.channel = chan;
            this.lastPresence.password = pwd;
            const frame = astralProtocol.encodeUserPresence('join', chan, pwd);
            if (LOG_RAW_WEBSOCKET) logger.info(`[WS SEND] ${Buffer.from(frame).toString('hex')}`);
            this.client!.send(frame);
        } catch (e) {
            logger.error('Failed to send USER_PRESENCE join:', e);
        }
    }

    leaveIrc(channel?: string, channelPassword?: string): void {
        if (!this.connected) {
            try { this.ensureConnected(); } catch { }
            if (!this.connected) return;
        }
        const cfg = getConfig();
        const chan = channel ?? cfg.ircSettings?.channel ?? 'General';
        const pwd = channelPassword ?? cfg.ircSettings?.channelPassword ?? '';

        cfg.ircSettings.ircToggle = false;
        setConfig(cfg);

        try {
            this.lastPresence.joined = false;
            this.lastPresence.channel = chan;
            this.lastPresence.password = pwd;
            const frame = astralProtocol.encodeUserPresence('leave', chan, pwd);
            if (LOG_RAW_WEBSOCKET) logger.info(`[WS SEND] ${Buffer.from(frame).toString('hex')}`);
            this.client!.send(frame);
        } catch (e) {
            logger.error('Failed to send USER_PRESENCE leave:', e);
        }
    }

    onIrcMessage(listener: (sender: string, message: string, userId: string) => void): void {
        this.ircListener = listener;
    }

    onIrcEvent(listener: (type: "join" | "leave", name: string, userId: string) => void): void {
        this.ircEventListener = listener;
    }

    // ----------------------
    // USER LIST
    // ----------------------
    async requestUserList(timeoutMs = 3000): Promise<astralProtocol.IrcUserEntry[]> {
        if (!this.connected) throw new Error('WebSocket not connected');
        const frame = astralProtocol.buildUserListRequestFrame();
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.userListResolvers.delete(resolve);
                reject(new Error('USER_LIST request timed out'));
            }, timeoutMs);
            this.userListResolvers.add((users) => {
                clearTimeout(timer);
                resolve(users);
            });
            try {
                if (LOG_RAW_WEBSOCKET) logger.info(`[WS SEND] ${Buffer.from(frame).toString('hex')}`);
                this.client!.send(frame);
            } catch (e) {
                clearTimeout(timer);
                this.userListResolvers.delete(resolve);
                reject(e);
            }
        });
    }

    // CONFIG
    async uploadConfig(): Promise<void> {
        if (!this.connected) throw new Error('WebSocket not connected');
        const cfg = getConfig();
        const frame = astralProtocol.encodeConfigUpload(cfg);
        if (LOG_RAW_WEBSOCKET) logger.info(`[WS SEND] ${Buffer.from(frame).toString('hex')}`);
        this.client!.send(frame);
    }

    async sendAccessToken(token: string): Promise<void> {
        this.token = token;
        const frame = astralProtocol.encodeSendConnectedUser(token);
        if (LOG_RAW_WEBSOCKET) logger.info(`[WS SEND] ${Buffer.from(frame).toString('hex')}`);
        this.client!.send(frame);
    }

    async resendAccessToken(): Promise<void> {
        if (!this.token) return;
        const frame = astralProtocol.encodeSendConnectedUser(this.token);
        if (LOG_RAW_WEBSOCKET) logger.info(`[WS SEND] ${Buffer.from(frame).toString('hex')}`);
        this.client!.send(frame);
    }

    async requestIsUserOnAstral(uuid: string): Promise<boolean | string | { prefix?: string; identity?: string }> {

        uuid = uuid.replace(/-/g, '').toLowerCase();

        if (!this.connected) throw new Error('WebSocket not connected');
        const frame = astralProtocol.encodeRequestAstralUser(uuid);
        if (LOG_RAW_WEBSOCKET) logger.info(`[WS SEND] ${Buffer.from(frame).toString('hex')}`);

        const existing = this.userAstralPending.get(uuid);
        if (existing) {
            return new Promise<boolean | string | { prefix?: string; identity?: string }>((resolve, reject) => {
                existing.resolves.push(resolve);
                existing.rejects.push(reject);
            });
        }

        return new Promise<boolean | string | { prefix?: string; identity?: string }>((resolve, reject) => {
            const timer = setTimeout(() => {
                const pending = this.userAstralPending.get(uuid);
                if (!pending) return;
                for (const rej of pending.rejects) {
                    try { rej(new Error('USER_ASTRAL_RESPONSE timed out')); } catch { }
                }
                this.userAstralPending.delete(uuid);
            }, 5000);

            this.userAstralPending.set(uuid, { resolves: [resolve], rejects: [reject], timer });

            try {
                this.client!.send(frame);
            } catch (e) {
                try { clearTimeout(timer); } catch { }
                this.userAstralPending.delete(uuid);
                reject(e);
            }
        });
    }
}
const wsClient = new Client();
export default wsClient;
