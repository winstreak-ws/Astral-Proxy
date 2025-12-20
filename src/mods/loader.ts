import type Player from '../player/player.js';
import { logger } from '../utils/logger.js';
import type Mod from './mod.js';
import { ModAPI } from './api/ModAPI.js';
import { getDataDir } from '../utils/paths.js';
import { MANIFEST as BUILTIN_MODS } from './_manifest.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

interface ExternalMod {
  name: string;
  version: string;
  description: string;
  author?: string;
  dependencies?: string[];
  config?: Record<string, any>;
  init(api: ModAPI): void;
  initSettings?(api: ModAPI): void;
  onDisable?(): void;
}

class ModLoader {
  private loadedMods = new Map<string, { mod: Mod | ExternalMod; type: 'built-in' | 'external' }>();
  private modAPI: ModAPI;

  constructor(private player: Player) {
    this.modAPI = new ModAPI(player);
  }

  private async safeImport(modPath: string) {
    //@ts-ignore
    if (process.pkg) {
      try {
        return require(modPath);
      } catch (err) {
        console.error("[DEBUG] require() failed:", err);
        throw err;
      }
    }

    return import(pathToFileURL(modPath).href);
  }

  private async initializeModSettings(): Promise<void> {
    // Built-in mods via manifest
    for (const mod of BUILTIN_MODS) {
      try {
        const m: Mod = (mod as any).default || mod;
        if (!m?.name) {
          logger.warn(`Built-in mod is missing a name`);
          continue;
        }
        if (typeof m.init !== 'function') {
          logger.warn(`Built-in mod ${m.name} has no init()`);
          continue;
        }

        m.init(this.player);
        this.loadedMods.set(m.name, { mod: m, type: 'built-in' });
        logger.debug(`Loaded built-in mod: ${m.name} v${m.version}`);
      } catch (err: any) {
        logger.warn(`Error loading built-in mod: ${err.message}`);
      }
    }

    // External mods via FS
    await this.initializeExternalModSettings();

    logger.info('Pre-initialized mod settings');
  }

  private async initializeExternalModSettings(): Promise<void> {
    const modsDir = path.join(getDataDir(), 'mods');
    try {
      await fs.mkdir(modsDir, { recursive: true });
      const files = await fs.readdir(modsDir);

      for (const file of files) {
        if (!(file.endsWith('.ts') || file.endsWith('.mts') || file.endsWith('.js'))) continue;

        const modPath = path.join(modsDir, file);

        try {
          console.log("[DEBUG] Trying import:", modPath);

          const modModule = await this.safeImport(modPath);
          console.log("[DEBUG] Imported module:", modModule);

          const mod = modModule.default || modModule;

          if (!this.isValidExternalMod(mod)) {
            logger.error(`Invalid external mod: ${file} ->`, mod);
            continue;
          }

          if (mod.initSettings) {
            (this.modAPI as any).__setCurrentModSource?.(mod.name);
            mod.initSettings(this.modAPI);
          }
        } catch (error: any) {
          logger.error(`Error initializing settings for external mod ${file}: ${error}`);
        }
      }
    } catch (error: any) {
      logger.debug(`Error reading external mods directory for settings: ${error.message}`);
    }
  }

  async loadAllMods(): Promise<void> {
    await this.initializeModSettings();
    await this.loadBuiltInMods();
    await this.loadExternalMods();
    logger.info(`Loaded ${this.loadedMods.size} mods total`);
  }

  private async loadBuiltInMods(): Promise<void> {
    for (const mod of BUILTIN_MODS) {
      try {
        const m: Mod = (mod as any).default;
        if (!m?.name) {
          logger.warn(`Built-in mod is missing a name`);
          continue;
        }
        if (typeof m.init !== 'function') {
          logger.warn(`Built-in mod ${m.name} has no init()`);
          continue;
        }

        m.init(this.player);
        this.loadedMods.set(m.name, { mod: m, type: 'built-in' });

        logger.debug(`Loaded built-in mod: ${m.name} v${m.version}`);
      } catch (err: any) {
        logger.warn(`Error loading built-in mod: ${err.message}`);
      }
    }
  }

  private async loadExternalMods(): Promise<void> {
    const modsDir = path.join(getDataDir(), 'mods');
    try {
      await fs.mkdir(modsDir, { recursive: true });
      const files = await fs.readdir(modsDir);

      for (const file of files) {
        if (!file.endsWith('.js')) continue;
        const modPath = path.join(modsDir, file);
        try {
          const modModule = await this.safeImport(modPath);
          const mod = modModule.default || modModule;

          if (!this.isValidExternalMod(mod)) {
            logger.warn(`Invalid external mod: ${file}`);
            continue;
          }

          if (mod.dependencies && !this.checkDependencies(mod.dependencies)) {
            logger.warn(`External mod ${mod.name} has unmet dependencies`);
            continue;
          }

          (this.modAPI as any).__setCurrentModSource?.(mod.name);
          mod.init(this.modAPI);

          this.loadedMods.set(mod.name, { mod, type: 'external' });
          logger.info(`Loaded external mod: ${mod.name} v${mod.version} by ${mod.author || 'Unknown'}`);
        } catch (error: any) {
          logger.error(`Error loading external mod ${file}: ${error.message}`);
        }
      }
    } catch (error: any) {
      logger.debug(`Mods directory not found or error reading it: ${error.message}`);
    }
  }

  private isValidExternalMod(mod: any): mod is ExternalMod {
    return (
      typeof mod === 'object' &&
      typeof mod.name === 'string' &&
      typeof mod.version === 'string' &&
      typeof mod.description === 'string' &&
      typeof mod.init === 'function'
    );
  }

  private checkDependencies(dependencies: string[]): boolean {
    for (const dep of dependencies) {
      if (!this.loadedMods.has(dep)) {
        return false;
      }
    }
    return true;
  }

  getLoadedMods(): Array<{ name: string; version: string; type: 'built-in' | 'external' }> {
    return Array.from(this.loadedMods.entries()).map(([name, { mod, type }]) => ({
      name,
      version: mod.version,
      type,
    }));
  }

  async unloadMod(name: string): Promise<boolean> {
    const modEntry = this.loadedMods.get(name);
    if (!modEntry) return false;

    if (modEntry.type === 'external') {
      const externalMod = modEntry.mod as ExternalMod;
      if (externalMod.onDisable) {
        try {
          externalMod.onDisable();
        } catch (error) {
          logger.error(`Error during mod ${name} disable: ${error}`);
        }
      }
    }

    this.loadedMods.delete(name);
    logger.info(`Unloaded mod: ${name}`);
    return true;
  }

  async reloadExternalMods(): Promise<void> {
    const externalMods = Array.from(this.loadedMods.entries())
      .filter(([, { type }]) => type === 'external')
      .map(([name]) => name);

    for (const modName of externalMods) {
      await this.unloadMod(modName);
    }

    await this.loadExternalMods();
  }
}

export default async function loadMods(player: Player): Promise<ModLoader> {
  const loader = new ModLoader(player);
  await loader.loadAllMods();
  return loader;
}
