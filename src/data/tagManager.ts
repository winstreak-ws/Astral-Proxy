// Centralized TagManager to merge cached/API tags with mod-provided tags
// Tags are pre-formatted Minecraft strings, e.g., "§cCheater§r" (no brackets, no separators)

type TagInput = string | { name: string; color?: number | string; description?: string };

function normalizeUUID(uuid: string): string {
  return String(uuid).toLowerCase().replace(/-/g, '');
}

function stripFormattingCodes(s: string): string {
  return s.replace(/§[0-9a-fk-or]/gi, '');
}

function getMinecraftColorByNumber(num: number | string | undefined): string {
  const colorMap = [
    { code: '§0', rgb: [0, 0, 0] }, { code: '§1', rgb: [0, 0, 170] },
    { code: '§2', rgb: [0, 170, 0] }, { code: '§3', rgb: [0, 170, 170] },
    { code: '§4', rgb: [170, 0, 0] }, { code: '§5', rgb: [170, 0, 170] },
    { code: '§6', rgb: [255, 170, 0] }, { code: '§7', rgb: [170, 170, 170] },
    { code: '§8', rgb: [85, 85, 85] }, { code: '§9', rgb: [85, 85, 255] },
    { code: '§a', rgb: [85, 255, 85] }, { code: '§b', rgb: [85, 255, 255] },
    { code: '§c', rgb: [255, 85, 85] }, { code: '§d', rgb: [255, 85, 255] },
    { code: '§e', rgb: [255, 255, 85] }, { code: '§f', rgb: [255, 255, 255] },
  ];
  if (typeof num === 'string') {
    if (num.startsWith('#')) {
      const v = parseInt(num.slice(1), 16);
      if (!Number.isNaN(v)) num = v as any;
    } else if (/^§[0-9a-f]$/i.test(num)) {
      // Already a MC color code
      return num;
    } else {
      return '§f';
    }
  }
  if (typeof num === 'number') {
    const r = (num >> 16) & 0xff, g = (num >> 8) & 0xff, b = num & 0xff;
    let min = Infinity, best = '§f';
    for (const c of colorMap) {
      const dr = r - c.rgb[0], dg = g - c.rgb[1], db = b - c.rgb[2];
      const d = dr * dr + dg * dg + db * db;
      if (d < min) { min = d; best = c.code; }
    }
    return best;
  }
  return '§f';
}

function formatTag(input: TagInput): string {
  if (typeof input === 'string') {
    const s = input.trim();
    if (!s) throw new Error('Tag string cannot be empty');
    if (/[\[\]|]/.test(s)) throw new Error('Tag string must not include brackets or separators');
    return s.endsWith('§r') ? s : s + '§r';
  }
  const name = String(input.name ?? '').trim();
  if (!name) throw new Error('Tag name is required');
  if (/[\[\]|]/.test(name)) throw new Error('Tag name must not include brackets or separators');
  const colorCode = getMinecraftColorByNumber(input.color);
  return `${colorCode}${name}§r`;
}

import { EventEmitter } from 'events'

type TagEvents = {
  tagsChanged: (uuid: string) => void
}

class TagManager extends EventEmitter {
  private modTags = new Map<string, Map<string, Set<string>>>();

  private getSourceSet(id: string, source: string): Set<string> {
    if (!source) throw new Error('Tag source is required');
    let bySource = this.modTags.get(id);
    if (!bySource) {
      bySource = new Map();
      this.modTags.set(id, bySource);
    }
    let set = bySource.get(source);
    if (!set) {
      set = new Set();
      bySource.set(source, set);
    }
    return set;
  }

  addTag(uuid: string, tag: TagInput, source: string): void {
    const id = normalizeUUID(uuid);
    const formatted = formatTag(tag);
    const set = this.getSourceSet(id, source);
    set.add(formatted);
    this.emit('tagsChanged', id)
  }

  addTags(uuid: string, tags: TagInput[], source: string): void {
    let changed = false
    for (const t of tags) {
      const before = this.getModTags(uuid).length
      this.addTag(uuid, t, source)
      const after = this.getModTags(uuid).length
      if (after !== before) changed = true
    }
    if (changed) this.emit('tagsChanged', normalizeUUID(uuid))
  }

  clearTags(uuid: string, source?: string): void {
    const id = normalizeUUID(uuid);
    if (!this.modTags.has(id)) return;
    if (!source) {
      this.modTags.delete(id);
      this.emit('tagsChanged', id)
      return;
    }
    const bySource = this.modTags.get(id)!;
    bySource.delete(source);
    if (bySource.size === 0) this.modTags.delete(id);
    this.emit('tagsChanged', id)
  }

  removeTag(uuid: string, predicate: (rawTag: string, plain: string) => boolean, source?: string): void {
    const id = normalizeUUID(uuid);
    const bySource = this.modTags.get(id);
    if (!bySource) return;
    const sources = source ? [source] : Array.from(bySource.keys());
    let removed = false
    for (const s of sources) {
      const set = bySource.get(s);
      if (!set) continue;
      for (const t of Array.from(set)) {
        const plain = stripFormattingCodes(t);
        if (predicate(t, plain)) { set.delete(t); removed = true }
      }
      if (set.size === 0) bySource.delete(s);
    }
    if (bySource.size === 0) this.modTags.delete(id);
    if (removed) this.emit('tagsChanged', id)
  }

  getModTags(uuid: string): string[] {
    const id = normalizeUUID(uuid);
    const bySource = this.modTags.get(id);
    if (!bySource) return [];
    const out: string[] = [];
    for (const set of bySource.values()) for (const t of set) out.push(t);
    return out;
  }

  getModTagsBySource(uuid: string, source: string): string[] {
    const id = normalizeUUID(uuid);
    return Array.from(this.modTags.get(id)?.get(source) ?? []);
  }

  combine(uuid: string, base: string[] | undefined | null): string[] {
    const baseArr = Array.isArray(base) ? base : [];
    const mods = this.getModTags(uuid);
    if (mods.length === 0) return baseArr;
    const out: string[] = [];
    const seen = new Set<string>();
    for (const list of [baseArr, mods]) {
      for (const tag of list) {
        const plain = stripFormattingCodes(tag).toLowerCase();
        if (plain && !seen.has(plain)) {
          seen.add(plain);
          out.push(tag.endsWith('§r') ? tag : tag + '§r');
        }
      }
    }
    return out;
  }

  notifyChanged(uuid: string) {
    this.emit('tagsChanged', normalizeUUID(uuid))
  }
}

const tagManager = new TagManager();
export default tagManager;
export type { TagInput };
