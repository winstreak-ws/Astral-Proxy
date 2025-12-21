import fs from "node:fs/promises";
import path from "path";
import axios from "axios";
import { getDataDir } from "../utils/paths.js";
import { logger } from "../utils/logger.js";

const GAMELIST_URL = "https://api.winstreak.ws/assets/astral/gamelist.json";
const VERSION_URL = "https://api.winstreak.ws/assets/astral/versions.json";

export async function ensureAssets(): Promise<void> {
  try {
    const gamelistRes = await axios.get(GAMELIST_URL, { timeout: 15000 });
    if (typeof gamelistRes.data === "object" && gamelistRes.data) {
      const dataDir = getDataDir();
      const gamelistPath = path.join(dataDir, "gamelist.json");
      await fs.writeFile(gamelistPath, JSON.stringify(gamelistRes.data, null, 2), "utf8");
      logger.debug(`[Assets] Updated gamelist (${Object.keys(gamelistRes.data).length} keys)`);
    } else {
      logger.warn("[Assets] Gamelist response not JSON object");
    }
  } catch (err) {
    logger.warn("[Assets] Failed to update gamelist:", err);
  }

}

type astralVersion = {
  id: string;
  published: string;
  deprecated: boolean;
  downloadUrl: string | null;
  changelogUrl: string | null;
}

type astralVersionInfo = {
  latest: string;
  versions: astralVersion[];
}

export async function getAstralVersionInfo(): Promise<astralVersionInfo | null> {
  try {
    const versionRes = await axios.get(VERSION_URL, { timeout: 10000 });
    if (typeof versionRes.data === "object" && versionRes.data) {
      return versionRes.data as astralVersionInfo;
    } else {
      logger.warn("[Assets] Version response not string");
      return null;
    }
  } catch (err) {
    logger.warn("[Assets] Failed to get version:", err);
    return null;
  }
}