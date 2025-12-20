import { TextEncoder, TextDecoder } from "util";

const enc = new TextEncoder();
const dec = new TextDecoder();

export enum Opcode {
    AUTH = 0x00,
    EVENT_PUSH = 0x01,
    API_REQUEST = 0x02,
    API_RESPONSE = 0x03,
    USER_ASTRAL_SET = 0x04,
    USER_ASTRAL_REQUEST = 0x05,
    USER_ASTRAL_RESPONSE = 0x06,
    CONFIG_REQUEST = 0x08,
    CONFIG_DOWNLOAD = 0x09,
    CONFIG_UPLOAD = 0x10,
    CONFIG_CHANGE = 0x11,
    CHAT_MESSAGE = 0x12,
    CHAT_BROADCAST = 0x13,
    USER_LIST = 0x14,
    USER_PRESENCE = 0x15,
    IRC_EVENT = 0x16,
    ERROR = 0xFF
}

export enum HttpMethod {
    GET = 0x01,
    POST = 0x02,
    DELETE = 0x03,
    PUT = 0x04
}

// -------------------- UTILS --------------------
function writeString(str: string): Uint8Array {
    const buf = enc.encode(str);
    const out = new Uint8Array(1 + buf.length);
    out[0] = buf.length;
    out.set(buf, 1);
    return out;
}

function readString(view: DataView, offset: number): [string, number] {
    const len = view.getUint8(offset);
    offset++;
    const bytes = new Uint8Array(view.buffer, offset, len);
    const str = dec.decode(bytes);
    return [str, offset + len];
}

// -------------------- AUTH --------------------
export function encodeAuth(apiKey: Uint8Array): Uint8Array {
    if (apiKey.length !== 16) throw new Error("API key must be 16 bytes");
    const out = new Uint8Array(1 + 2 + 16);
    const dv = new DataView(out.buffer);
    dv.setUint8(0, Opcode.AUTH);
    dv.setUint16(1, 16);
    out.set(apiKey, 3);
    return out;
}

// -------------------- API REQUEST --------------------
export interface ApiParam {
    key: string;
    value: string;
}

export interface ApiRequest {
    requestId: number;
    method: HttpMethod;
    path: string;
    query: ApiParam[];
    body: ApiParam[];
}

export function encodeApiRequest(req: ApiRequest): Uint8Array {
    const parts: Uint8Array[] = [];
    const head = new Uint8Array(4 + 1);
    const dv = new DataView(head.buffer);
    dv.setUint32(0, req.requestId);
    dv.setUint8(4, req.method);
    parts.push(head);
    parts.push(writeString(req.path));
    const queryCount = new Uint8Array(2);
    new DataView(queryCount.buffer).setUint16(0, req.query.length);
    parts.push(queryCount);
    req.query.forEach(p => {
        parts.push(writeString(p.key));
        const val = enc.encode(p.value);
        const len = new Uint8Array(2);
        new DataView(len.buffer).setUint16(0, val.length);
        parts.push(len, val);
    });
    const bodyCount = new Uint8Array(2);
    new DataView(bodyCount.buffer).setUint16(0, req.body.length);
    parts.push(bodyCount);
    req.body.forEach(p => {
        parts.push(writeString(p.key));
        const val = enc.encode(p.value);
        const len = new Uint8Array(2);
        new DataView(len.buffer).setUint16(0, val.length);
        parts.push(len, val);
    });
    const payload = concat(parts);
    const out = new Uint8Array(1 + 2 + payload.length);
    const dv2 = new DataView(out.buffer);
    dv2.setUint8(0, Opcode.API_REQUEST);
    dv2.setUint16(1, payload.length);
    out.set(payload, 3);
    return out;
}

// -------------------- API RESPONSE --------------------
export interface ApiResponse {
    requestId: number;
    status: number;
    data: Uint8Array;
}

export function decodeApiResponse(buf: Uint8Array): ApiResponse {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const requestId = dv.getUint32(0);
    const status = dv.getUint16(4);
    const data = buf.slice(6);
    return { requestId, status, data };
}

// -------------------- CONFIG --------------------

export function encodeConfigUpload(configData: Object): Uint8Array {
    const json = JSON.stringify(configData);
    const jsonBytes = enc.encode(json);
    const payload = new Uint8Array(2 + jsonBytes.length);
    new DataView(payload.buffer).setUint16(0, jsonBytes.length);
    payload.set(jsonBytes, 2);

    const out = new Uint8Array(1 + 2 + payload.length);
    const dv = new DataView(out.buffer);
    dv.setUint8(0, Opcode.CONFIG_UPLOAD);
    dv.setUint16(1, payload.length);
    out.set(payload, 3);
    return out;
}

export function decodeConfigDownload(buf: Uint8Array): Object | null {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const jsonLen = dv.getUint16(0);
    const jsonBytes = buf.slice(2, 2 + jsonLen);
    const jsonStr = dec.decode(jsonBytes);
    try {
        return JSON.parse(jsonStr);
    } catch {
        return null;
    }
}

export function decodeConfigChange(buf: Uint8Array): { key: string, value: any } | null {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const jsonLen = dv.getUint16(0);
    const jsonBytes = buf.slice(2, 2 + jsonLen);
    const jsonStr = dec.decode(jsonBytes);
    try {
        return JSON.parse(jsonStr);
    } catch {
        return null;
    }
}

// -------------------- IRC --------------------
export function encodeChatMessage(msg: string): Uint8Array {
    const msgBytes = enc.encode(msg);
    const payload = new Uint8Array(2 + msgBytes.length);
    new DataView(payload.buffer).setUint16(0, msgBytes.length);
    payload.set(msgBytes, 2);

    const out = new Uint8Array(1 + 2 + payload.length);
    const dv = new DataView(out.buffer);
    dv.setUint8(0, Opcode.CHAT_MESSAGE);
    dv.setUint16(1, payload.length);
    out.set(payload, 3);
    return out;
}

// -------------------- USER PRESENCE --------------------
export type PresenceAction = 'join' | 'leave';
export function encodeUserPresence(action: PresenceAction, channel: string, channelPassword: string = ''): Uint8Array {
    const actionByte = action === 'join' ? 1 : 0;
    const chanBytes = enc.encode(channel || '');
    const pwdBytes = enc.encode(channelPassword || '');

    const payload = new Uint8Array(1 + 1 + chanBytes.length + 1 + pwdBytes.length);
    let off = 0;
    payload[off++] = actionByte;
    payload[off++] = chanBytes.length;
    payload.set(chanBytes, off); off += chanBytes.length;
    payload[off++] = pwdBytes.length;
    payload.set(pwdBytes, off);

    const out = new Uint8Array(1 + 2 + payload.length);
    const dv = new DataView(out.buffer);
    dv.setUint8(0, Opcode.USER_PRESENCE);
    dv.setUint16(1, payload.length);
    out.set(payload, 3);
    return out;
}

interface ChatBroadcast {
    ircID: string;
    ircName: string;
    message: string;
}

export function decodeChatBroadcast(buf: Uint8Array): ChatBroadcast {
    let off = 0;

    const idBuf = buf.slice(off, off + 8); off += 8;
    const ircID = Buffer.from(idBuf).toString("hex").toUpperCase();

    const nameLen = buf[off++];
    const ircName = Buffer.from(buf.slice(off, off + nameLen)).toString("utf8");
    off += nameLen;

    const dv = new DataView(buf.buffer, buf.byteOffset + off);
    const msgLen = dv.getUint16(0); off += 2;
    const msgBytes = buf.slice(off, off + msgLen);
    const message = new TextDecoder().decode(msgBytes);

    return { ircID, ircName, message };
}

// -------------------- USER LIST --------------------
export interface IrcUserEntry {
    id: string;
    name: string;
}

export interface DecodedUserList {
    opcode: number;
    users: IrcUserEntry[];
}

export function decodeUserListPayload(payload: Uint8Array): DecodedUserList {
    let off = 0;
    if (payload.length === 0) return { opcode: Opcode.USER_LIST, users: [] };
    const count = payload[off++];
    const users: IrcUserEntry[] = [];
    for (let i = 0; i < count; i++) {
        if (off >= payload.length) break;
        const idLen = payload[off++];
        if (off + idLen > payload.length) break;
        const id = new TextDecoder().decode(payload.subarray(off, off + idLen));
        off += idLen;
        if (off >= payload.length) break;
        const nameLen = payload[off++];
        if (off + nameLen > payload.length) break;
        const name = new TextDecoder().decode(payload.subarray(off, off + nameLen));
        off += nameLen;
        users.push({ id, name });
    }
    const seen = new Set<string>();
    const deduped: IrcUserEntry[] = [];
    for (const u of users) {
        const key = u.id + '\u0000' + u.name;
        if (!seen.has(key)) { seen.add(key); deduped.push(u); }
    }
    return { opcode: Opcode.USER_LIST, users: deduped };
}

// ------------------ ASTRAL USERS -------------------

export function encodeSendConnectedUser(uuid: string): Uint8Array {
    const uuidBytes = Buffer.from(uuid.replace(/-/g, ''), 'hex');
    const payload = new Uint8Array(uuidBytes.length);
    payload.set(uuidBytes, 0);

    const frame = new Uint8Array(1 + 2 + payload.length);
    frame[0] = Opcode.USER_ASTRAL_SET;
    frame[1] = 0;
    frame[2] = uuidBytes.length;
    frame.set(payload, 3);
    return frame;
}

export function encodeRequestAstralUser(uuid: string): Uint8Array {
    const uuidBytes = Buffer.from(uuid.replace(/-/g, ''), 'hex');
    const payload = new Uint8Array(uuidBytes.length);
    payload.set(uuidBytes, 0);

    const frame = new Uint8Array(1 + 2 + payload.length);
    frame[0] = Opcode.USER_ASTRAL_REQUEST;
    frame[1] = 0;
    frame[2] = uuidBytes.length;
    frame.set(payload, 3);
    return frame;
}

export function decodeAstralUserResponse(payload: Uint8Array): { uuid: string, isOnAstral: boolean } | null {
    if (payload.length !== 17) return null;

    const uuidHex = Buffer.from(payload.subarray(0, 16)).toString('hex');
    const isOnAstral = payload[16] === 1;

    return { uuid: uuidHex, isOnAstral };
}

export function buildUserListRequestFrame(): Uint8Array {
    const frame = new Uint8Array(3);
    frame[0] = Opcode.USER_LIST;
    frame[1] = 0;
    frame[2] = 0;
    return frame;
}

// -------------------- HELPERS --------------------
function concat(arrays: Uint8Array[]): Uint8Array {
    let len = 0;
    arrays.forEach(a => len += a.length);
    const out = new Uint8Array(len);
    let offset = 0;
    arrays.forEach(a => { out.set(a, offset); offset += a.length; });
    return out;
}
