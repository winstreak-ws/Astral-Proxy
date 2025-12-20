import fs from "node:fs/promises";
import path from "path";
import axios from "axios";
import { getDataDir } from "../utils/paths.js";
import { logger } from "../utils/logger.js";

const GAMELIST_URL = "https://api.winstreak.ws/assets/astral/gamelist.json";

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
