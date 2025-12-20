import fs from 'fs';
import { logger } from "../utils/logger.js";
import { getConfigPath } from '../utils/paths.js';
import pkg from '../../package.json' with { type: 'json' };
const CONFIG_PATH = getConfigPath('config.json');

if (!fs.existsSync(CONFIG_PATH)) {
  const defaultConfig = {
    "General": {
      "useWinstreakWsKey": false,
      "hypixelKey": "",
      "winstreakKey": "",
      "remoteServerIp": "mc.hypixel.net",
      "remoteServerPort": "25565",
      "localServerIp": "127.0.0.1",
      "localServerPort": "25566",
    },
    "clientBypass": {
      "enabled": true,
      "enableLunarMods": true,
      "enableBadlionMods": true
    },
    "ircSettings": {
      "ircPrefix": "-",
      "winstreakUsername": null,
      "ircToggle": false,
      "ircId": null,
    },
    "tabStatsSettings": {
      "format": "- %%ping%% ms - %%gap%% - %%winstreak%% ws - %%fkdr%% fkdr - %%wlr%% wlr",
      "tags": true,
      "showSelf": true,
      "showSelfInLobby": false,
      "enabled": true,
      "showSuffix": true,
      "useTeamColorUsernames": true,
      "enableIdentity": true
    },
    "bedwarsUtil": {
      "enableTeamSummary": true,
      "teamSummaryTeamFormat": "%%teamName%% (%%stars_total%% | %%fkdr%% fkdr | %%wlr%% wlr)",
      "teamSummaryPlayerFormat": "%%tags%% %%stars%% %%name%%: %%fkdr%% fkdr | %%wlr%% wlr",
    },
    "anticheatSettings": {
      "autoblock": true,
      "noslow": true,
      "legitScaffold": true,
      "scaffold": false,
      "alertSelf": true,
      "alertParty": false,
      "detectSelf": false,
      "detectParty": false,
      "showVL": false,
      "showWDR": true,
      "cooldown": 10
    },
    "violationLevels": {
      "autoblock": 5,
      "noslow": 5,
      "legitScaffold": 5,
      "scaffold": 5
    },
    "nickBot": {
      "cooldown": 3,
      "switchLobby": 10
    },
    "levelhead": {
      "yOffset": 0.4,
      "enabled": true
    },
    "freeEmojis": {
      "enabled": false
    },
    "tagSettings": {
      "blacklist": true,
      "gaps": true,
      "nacc": false,
      "ping": true,
      "radar": false,
      "rnc": true,
      "statacc": true,
      "unverified": true,
      "urchin": false
    }
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultConfig, null, 2));
  logger.debug('[Config] Created default config.json');
}

let config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

function migrateConfig(obj: any) {
  let mutated = false;

  // ---- General (migrate legacy top-level fields) ---- BETA1 -> BETA2
  const defaultGeneral = {
    useWinstreakWsKey: false,
    hypixelKey: '',
    winstreakKey: '',
    remoteServerIp: 'mc.hypixel.net',
    remoteServerPort: '25565',
    localServerIp: '127.0.0.1',
    localServerPort: '25566',
  };
  if (!obj.General || typeof obj.General !== 'object') {
    obj.General = {
      useWinstreakWsKey: obj.useWinstreakWsKey ?? defaultGeneral.useWinstreakWsKey,
      hypixelKey: obj.hypixelKey ?? defaultGeneral.hypixelKey,
      winstreakKey: obj.winstreakKey ?? defaultGeneral.winstreakKey,
      remoteServerIp: obj.remoteServerIp ?? defaultGeneral.remoteServerIp,
      remoteServerPort: obj.remoteServerPort ?? defaultGeneral.remoteServerPort,
      localServerIp: obj.localServerIp ?? defaultGeneral.localServerIp,
      localServerPort: obj.localServerPort ?? defaultGeneral.localServerPort,
    };
    mutated = true;

    delete (obj as any).useWinstreakWsKey;
    delete (obj as any).hypixelKey;
    delete (obj as any).winstreakKey;
    delete (obj as any).remoteServerIp;
    delete (obj as any).remoteServerPort;
    delete (obj as any).localServerIp;
    delete (obj as any).localServerPort;

  } else {
    obj.General = Object.assign({}, defaultGeneral, obj.General);
  }

  // Ensure "General" is the first key in the root object for nicer UX
  const ensureGeneralFirst = (root: any) => {
    if (!root || typeof root !== 'object' || !('General' in root)) return false;
    const keys = Object.keys(root);
    if (keys[0] === 'General') return false;
    const ordered: any = { General: root.General };
    for (const k of keys) if (k !== 'General') ordered[k] = root[k];
    for (const k of keys) delete root[k];
    Object.assign(root, ordered);
    return true;
  };

  if (ensureGeneralFirst(obj)) mutated = true;

  // BETA2 -> BETA2.1
  if (obj.tabStatsSettings) {
    if (obj.tabStatsSettings.stats) {
      if (obj.tabStatsSettings.stats.tags !== undefined) {
        obj.tabStatsSettings.tags = obj.tabStatsSettings.stats.tags;
      }
      delete obj.tabStatsSettings.stats;
      mutated = true;
    }
    if (!obj.tabStatsSettings.format) {
      obj.tabStatsSettings.format = "- %%ping%% ms - %%gap%% - %%winstreak%% ws - %%fkdr%% fkdr - %%wlr%% wlr";
      mutated = true;
    }
  }


  return mutated;
}

try {
  const migrated = migrateConfig(config);
  if (migrated) {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
    logger.debug('[Config] Migrated and normalized config.json');
  }
} catch (e) {
  logger.error('[Config] Migration failed:', e);
}

function applyDefaults(obj: any) {
  if (!obj.General || typeof obj.General !== 'object') obj.General = {};
  if (typeof obj.General.useWinstreakWsKey !== 'boolean') obj.General.useWinstreakWsKey = true
  const defaultTagSettings = {
    blacklist: true,
    gaps: true,
    nacc: false,
    ping: true,
    radar: false,
    rnc: true,
    statacc: true,
    unverified: true,
    urchin: false,
  }
  obj.tagSettings = Object.assign({}, defaultTagSettings, obj.tagSettings || {})

  const defaultTabStats = {
    format: "- %%ping%% ms - %%gap%% - %%winstreak%% ws - %%fkdr%% fkdr - %%wlr%% wlr",
    tags: true,
    showSelf: true,
    showSelfInLobby: false,
    enabled: true,
    showSuffix: true,
    useTeamColorUsernames: true,
    enableIdentity: true,
  }
  obj.tabStatsSettings = Object.assign({}, defaultTabStats, obj.tabStatsSettings || {})

  const defaultBedwarsUtil = {
    enableTeamSummary: true,
    teamSummaryTeamFormat: "%%teamName%% (%%stars_total%% | %%fkdr%% fkdr | %%wlr%% wlr)",
    teamSummaryPlayerFormat: "%%label%% %%tags%% %%stars%% %%name%%: %%fkdr%% fkdr | %%wlr%% wlr",
  }
  obj.bedwarsUtil = Object.assign({}, defaultBedwarsUtil, obj.bedwarsUtil || {});

}

applyDefaults(config)


fs.watchFile(CONFIG_PATH, () => {
  try {
    config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    try {
      const migrated = migrateConfig(config);
      if (migrated) {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
        logger.debug('[Config] Migrated and normalized config.json');
      }
    } catch (e) {
      logger.error('[Config] Migration failed during reload:', e);
    }
    applyDefaults(config)
    logger.debug('[Config] Reloaded config.json');
  } catch (err) {
    logger.error('[Config] Failed to reload config:', err);
  }
});

export function getConfig() {
  return config;
}

export function setConfig(newConfig: any) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2));
  config = newConfig;
}

export const APP_VERSION: string = (pkg as any).version;
