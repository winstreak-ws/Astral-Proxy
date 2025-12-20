class CacheMaster {
    private cache: Map<string, { value: string; expiresAt?: number }>;

    constructor() {
        this.cache = new Map();
    }

    setJson(key: string, value: object, ttlMs?: number): void {
        const expiresAt = ttlMs ? Date.now() + ttlMs : undefined;
        this.cache.set(key, { value: JSON.stringify(value), expiresAt });
    }

    getJson(key: string): object | null {
        const entry = this.cache.get(key);
        if (!entry) return null;
        if (entry.expiresAt && entry.expiresAt < Date.now()) {
            this.cache.delete(key);
            return null;
        }
        return JSON.parse(entry.value);
    }

    hasKey(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry) return false;
        if (entry.expiresAt && entry.expiresAt < Date.now()) {
            this.cache.delete(key);
            return false;
        }
        return true;
    }

    deleteKey(key: string): boolean {
        return this.cache.delete(key);
    }

    clearCache(): void {
        this.cache.clear();
    }

    getAllKeys(): string[] {
        this.cleanupExpired();
        return Array.from(this.cache.keys());
    }

    getCacheSize(): number {
        this.cleanupExpired();
        return this.cache.size;
    }

    getCacheMb(): number {
        this.cleanupExpired();
        let totalBytes = 0;
        for (const entry of this.cache.values()) {
            totalBytes += new Blob([entry.value]).size;
        }
        return totalBytes / (1024 * 1024);
    }

    private cleanupExpired(): void {
        const now = Date.now();
        for (const [key, entry] of this.cache.entries()) {
            if (entry.expiresAt && entry.expiresAt < now) {
                this.cache.delete(key);
            }
        }
    }
}

const cacheMaster = new CacheMaster();
export default cacheMaster;