import path from "path";
import { fileURLToPath } from "url";

export function getFilename(metaUrl?: string) {
    if (metaUrl && typeof metaUrl === "string") {
        return fileURLToPath(metaUrl);
    }
    return __filename; // fallback when import.meta.url is undefined
}

export const getDirname = (metaUrl?: string) => {
    if (metaUrl) {
        const __filename = fileURLToPath(metaUrl);
        return path.dirname(__filename);
    }
    return __dirname; // fallback in CJS
};