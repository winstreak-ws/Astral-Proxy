import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

function ensureDirExists(dirPath: string): void {
    if (!fs.existsSync(dirPath)) {
        fs.mkdirSync(dirPath, { recursive: true });
    }
}

function isPkg(): boolean {
    // process.pkg is defined when running inside a pkg-built executable
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return typeof (process as any).pkg !== 'undefined';
}

function getProdBaseDir(): string {
    const platform = process.platform;

    if (platform === 'win32') {
        const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        return path.join(appData, 'Astral');
    }

    if (platform === 'darwin') {
        return path.join(os.homedir(), 'Library', 'Application Support', 'Astral');
    }

    // linux and others – follow XDG-ish convention
    return path.join(os.homedir(), '.config', 'astral');
}

export function getDataDir(): string {
    const base = isPkg() ? getProdBaseDir() : path.resolve(process.cwd(), 'data');
    ensureDirExists(base);
    return base;
}

function getSubPath(subdir: string, filename: string): string {
    const base = getDataDir();
    const dir = path.join(base, subdir);
    ensureDirExists(dir);
    return path.join(dir, filename);
}

export function getConfigPath(filename: string): string {
    return getSubPath('config', filename);
}

export function getLogPath(filename: string): string {
    return getSubPath('logs', filename);
}

export function getCachePath(filename: string): string {
    return getSubPath('cache', filename);
}

export const _internal = { ensureDirExists, isPkg, getProdBaseDir };
