import type Player from '../../player/player.js';
import { logger } from '../../utils/logger.js';
import { EventEmitter } from 'events';
import { getConfig, setConfig } from '../../config/config.js';
import { ModCommandSystem, type ModCommandOptions, type ModCommandContext } from './ModCommandSystem.js';
import tagManager, { type TagInput } from '../../data/tagManager.js';

export interface PlayerState {
  ticksExisted: number;
  lastSwingTick: number;
  lastCrouchedTick: number;
  lastStopCrouchingTick: number;
  lastOnGroundTick: number;
  pitch: number;
  moveYaw: number;
  block: string;
  server: string;
  username: string;
  onGround: boolean;
  previousPositions: Vec3[];
  position: Vec3;
  using: boolean;
  riding: boolean;
  sprinting: boolean;
  lastUsingTick: number;
  lastStopUsingTick: number;
  lastItemChangeTick: number;
  heldItem?: ItemStack;
  lastStopUsingItem?: ItemStack;
  swingProgress: number;
  sneakState: boolean;
  velocity: Vec3;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ItemStack {
  type: string;
  name: string;
  meta: number;
  count?: number;
  nbt?: any;
}

export interface PacketInfo {
  name: string;
  data: any;
  entityId?: number;
  direction: 'incoming' | 'outgoing';
  timestamp: number;
}

export interface ChatMessage {
  text: string;
  username?: string;
  formatted: string;
  timestamp: number;
  position: number;
}

export interface TabPlayer {
  uuid: string;
  username: string;
  displayName?: string;
  ping: number;
  gamemode: number;
  properties?: any[];
}

export interface TeamInfo {
  name: string;
  color: string;
  prefix: string;
  suffix: string;
  members: string[];
}

export interface ModConfig {
  [key: string]: any;
  settings?: {
    subsections: {
      [key: string]: {
        title: string;
        settings: {
          [key: string]: {
            type: 'button' | 'slider' | 'field';
            value: any;
            style?: 'check' | 'slider';
            min?: number;
            max?: number;
            title?: string;
          }
        }
      }
    }
  }
}

export class ModAPI extends EventEmitter {
  private player: Player;
  private packetListeners = new Map<string, Set<Function>>();
  private chatHandlers = new Set<(message: ChatMessage) => boolean>();
  private scheduledTasks = new Map<number, NodeJS.Timeout>();
  private taskIdCounter = 0;
  private modConfigs = new Map<string, ModConfig>();
  private interceptedPackets = new Set<string>();
  private chatFilters = new Set<(message: string) => string>();
  private commandSystem: ModCommandSystem;

  private initializeModConfig(modName: string) {
    const config = getConfig();
    const existingSettings = config.externalMods?.[modName];

    if (!this.modConfigs.has(modName)) {
      this.modConfigs.set(modName, existingSettings || {
        settings: {
          subsections: {}
        }
      });
    } else if (!this.modConfigs.get(modName)!.settings) {
      const config = this.modConfigs.get(modName)!;
      config.settings = { subsections: {} };
      this.modConfigs.set(modName, config);
    }

    this.saveModConfig(modName);
  }

  createSubsection(modName: string, title: string): string {
    this.initializeModConfig(modName);
    const config = this.modConfigs.get(modName)!;

    const key = title.toLowerCase().replace(/[^a-z0-9]/g, '_');
    if (!config.settings!.subsections[key]) {
      config.settings!.subsections[key] = {
        title,
        settings: {}
      };
    }
    return key;
  }

  addButton(modName: string, subsectionKey: string, settingName: string, defaultValue: boolean, style: 'check' | 'slider' = 'check'): void {
    this.initializeModConfig(modName);
    const config = this.modConfigs.get(modName)!;
    
    if (config.settings!.subsections[subsectionKey]) {
      config.settings!.subsections[subsectionKey].settings[settingName] = {
        type: 'button',
        value: defaultValue,
        style: style || 'check'
      };

      this.saveModConfig(modName);
    }
  }

  addSlider(modName: string, subsectionKey: string, settingName: string, minValue: number, maxValue: number, defaultValue: number): void {
    this.initializeModConfig(modName);
    const config = this.modConfigs.get(modName)!;
    
    if (config.settings!.subsections[subsectionKey]) {
      config.settings!.subsections[subsectionKey].settings[settingName] = {
        type: 'slider',
        value: defaultValue,
        min: minValue,
        max: maxValue
      };
    }
  }

  addField(modName: string, subsectionKey: string, settingName: string, defaultValue: string = ''): void {
    this.initializeModConfig(modName);
    const config = this.modConfigs.get(modName)!;
    
    if (config.settings!.subsections[subsectionKey]) {
      if (!config.settings!.subsections[subsectionKey].settings[settingName]) {
        config.settings!.subsections[subsectionKey].settings[settingName] = {
          type: 'field',
          value: defaultValue
        };
        this.saveModConfig(modName);
      }
    }
  }

  getSetting(modName: string, subsectionKey: string, settingName: string): any | undefined {
    const config = this.modConfigs.get(modName);
    if(!config) return undefined;
    if (config.settings?.subsections[subsectionKey]?.settings[settingName]) {
      const setting = config.settings.subsections[subsectionKey].settings[settingName];
      return setting.value;
    }
    return undefined;
  }

  setSetting(modName: string, subsectionKey: string, settingName: string, value: any): void {
    const config = this.modConfigs.get(modName);
    if(!config) return;
    if (config.settings?.subsections[subsectionKey]?.settings[settingName]) {
      config.settings.subsections[subsectionKey].settings[settingName].value = value;
      this.saveModConfig(modName);
    }
  }

  private saveModConfig(modName: string): void {
    const config = getConfig();
    if (!config.externalMods) {
      config.externalMods = {};
    }
    const modConfig = this.modConfigs.get(modName);
    config.externalMods[modName] = modConfig;
    setConfig(config);
  }

  constructor(player: Player) {
    super();
    this.player = player;
    this.commandSystem = new ModCommandSystem(player);
    this.setupPacketForwarding();
    this.setupChatHandling();
  }

  private currentModSource?: string

  __setCurrentModSource(name: string) {
    this.currentModSource = name;
  }

  addPlayerTag(uuid: string, tag: TagInput): void {
    try {
      if (!this.currentModSource) throw new Error('Mod source not set');
      tagManager.addTag(uuid, tag, this.currentModSource);
    } catch (e) { logger.error('addPlayerTag error:', e); }
  }
  addPlayerTags(uuid: string, tags: TagInput[]): void {
    try {
      if (!this.currentModSource) throw new Error('Mod source not set');
      tagManager.addTags(uuid, tags, this.currentModSource);
    } catch (e) { logger.error('addPlayerTags error:', e); }
  }
  clearPlayerTags(uuid: string): void {
    if (!this.currentModSource) return;
    tagManager.clearTags(uuid, this.currentModSource);
  }
  removePlayerTags(uuid: string, predicate: (rawTag: string, plain: string) => boolean): void {
    if (!this.currentModSource) return;
    tagManager.removeTag(uuid, predicate, this.currentModSource);
  }

  private setupPacketForwarding(): void {
    this.player.server.on('packet', (data: any, meta: any) => {
      const packetInfo: PacketInfo = {
        name: meta.name,
        data,
        entityId: data.entityId,
        direction: 'incoming',
        timestamp: Date.now()
      };

      this.emit('packet', packetInfo);
      this.emit(`packet:${meta.name}`, packetInfo);
      this.emit('packet:incoming', packetInfo);

      const listeners = this.packetListeners.get(meta.name);
      if (listeners) {
        for (const listener of listeners) {
          try {
            listener(packetInfo);
          } catch (error) {
            logger.error(`Error in packet listener for ${meta.name}:`, error);
          }
        }
      }
    });

    const originalWrite = this.player.server.write.bind(this.player.server);
    this.player.server.write = (name: string, data: any) => {
      const packetInfo: PacketInfo = {
        name,
        data,
        direction: 'outgoing',
        timestamp: Date.now()
      };

      this.emit('packet', packetInfo);
      this.emit(`packet:${name}`, packetInfo);
      this.emit('packet:outgoing', packetInfo);

      if (!this.interceptedPackets.has(name)) {
        return originalWrite(name, data);
      }
    };
  }

  private setupChatHandling(): void {
    this.onPacket('chat', (packet) => {
      if (packet.direction === 'incoming') {
        const chatMessage = this.parseChatMessage(packet.data.message);
        chatMessage.position = packet.data.position || 0;

        for (const handler of this.chatHandlers) {
          try {
            if (handler(chatMessage)) {
              return;
            }
          } catch (error) {
            logger.error('Error in chat handler:', error);
          }
        }

        this.emit('chat', chatMessage);
      }
    });
  }

  onPacket(packetName: string, callback: (packet: PacketInfo) => void, options?: {
    direction?: 'incoming' | 'outgoing' | 'both';
    priority?: number;
  }): void {
    if (!this.packetListeners.has(packetName)) {
      this.packetListeners.set(packetName, new Set());
    }

    const wrappedCallback = (packet: PacketInfo) => {
      if (options?.direction && options.direction !== 'both' && packet.direction !== options.direction) {
        return;
      }
      callback(packet);
    };

    this.packetListeners.get(packetName)!.add(wrappedCallback);
  }

  interceptPacket(packetName: string, modifier: (data: any) => any | null): void {
    this.interceptedPackets.add(packetName);
    this.onPacket(packetName, (packet) => {
      if (packet.direction === 'outgoing') {
        const modifiedData = modifier(packet.data);
        if (modifiedData !== null) {
          this.player.server.write(packetName, modifiedData);
        }
      }
    });
  }

  cancelPacket(packetName: string, condition?: (data: any) => boolean): void {
    this.interceptedPackets.add(packetName);
    if (condition) {
      this.onPacket(packetName, (packet) => {
        if (packet.direction === 'outgoing' && !condition(packet.data)) {
          this.player.server.write(packetName, packet.data);
        }
      });
    }
  }

  registerChatHandler(handler: (message: ChatMessage) => boolean, priority: number = 0): void {
    this.chatHandlers.add(handler);
  }

  addChatFilter(filter: (message: string) => string): void {
    this.chatFilters.add(filter);
  }

  sendClickableMessage(text: string, clickAction: 'run_command' | 'suggest_command' | 'open_url', value: string): void {
    const message = {
      text,
      clickEvent: {
        action: clickAction,
        value
      }
    };

    this.player.client.write('chat', {
      message: JSON.stringify(message),
      position: 0
    });
  }

  sendHoverClickableMessage(text: string, clickAction: 'run_command' | 'suggest_command' | 'open_url', value: string, hoverText: string): void {
    const message = {
      text,
      color: 'yellow',
      bold: true,
      clickEvent: {
        action: clickAction,
        value
      },
      hoverEvent: {
        action: 'show_text',
        value: {
          text: hoverText,
          color: 'green'
        }
      }
    };

    this.player.client.write('chat', {
      message: JSON.stringify(message),
      position: 0
    });
  }


  sendHoverMessage(text: string, hoverText: string): void {
    const message = {
      text,
      hoverEvent: {
        action: 'show_text',
        value: { text: hoverText }
      }
    };

    this.player.client.write('chat', {
      message: JSON.stringify(message),
      position: 0
    });
  }

  private useFormatCode(format: string): string {
    const formatMap: Record<string, string> = {
      'bold': '§l',
      'italic': '§o',
      'underlined': '§n',
      'strikethrough': '§m',
      'obfuscated': '§k',
      'reset': '§r'
    };
    return formatMap[format.toLowerCase()] || '';
  }

  private useColorCode(color: string): string {
    const colorMap: Record<string, string> = {
      'black': '§0', 'dark_blue': '§1', 'dark_green': '§2', 'dark_aqua': '§3',
      'dark_red': '§4', 'dark_purple': '§5', 'gold': '§6', 'gray': '§7',
      'dark_gray': '§8', 'blue': '§9', 'green': '§a', 'aqua': '§b',
      'red': '§c', 'light_purple': '§d', 'yellow': '§e', 'white': '§f'
    };
    return colorMap[color.toLowerCase()] || '§f';
  }
  

  private getColorCode(color: string): string {
    const colorMap: Record<string, string> = {
      'black': '0', 'dark_blue': '1', 'dark_green': '2', 'dark_aqua': '3',
      'dark_red': '4', 'dark_purple': '5', 'gold': '6', 'gray': '7',
      'dark_gray': '8', 'blue': '9', 'green': 'a', 'aqua': 'b',
      'red': 'c', 'light_purple': 'd', 'yellow': 'e', 'white': 'f'
    };
    return colorMap[color.toLowerCase()] || 'f';
  }
  

  getEntities(filter?: {
    type?: string;
    distance?: number;
    fromPosition?: Vec3;
  }): Record<number, any> {
    const entities = this.player.entities;
    if (!entities || typeof entities !== 'object') {
      return {};
    }

    let result = Array.isArray(entities) 
      ? entities.reduce((acc, entity, index) => ({ ...acc, [index]: entity }), {})
      : entities as Record<number, any>;

    if (filter) {
      const playerPos = filter.fromPosition || this.getPosition();
      
      result = Object.fromEntries(
        Object.entries(result).filter(([id, entity]) => {
          const typedEntity = entity as { type?: string; position?: Vec3 };
          if (filter.type && typedEntity.type !== filter.type) return false;
          if (filter.distance && playerPos && typedEntity.position) {
            const distance = this.distance(playerPos, typedEntity.position);
            if (distance > filter.distance) return false;
          }
          return true;
        })
      );
    }

    return result;
  }

  getNearbyPlayers(radius: number = 10): any[] {
    const entities = this.getEntities({ type: 'player', distance: radius });
    return Object.values(entities);
  }

  getTabPlayers(): Record<string, TabPlayer> {
    const players: Record<string, TabPlayer> = {};
    
    for (const [username, playerData] of Object.entries(this.player.players || {})) {
      players[username] = {
        uuid: (playerData as any).uuid,
        username,
        displayName: (playerData as any).displayName,
        ping: (playerData as any).ping || 0,
        gamemode: (playerData as any).gamemode || 0,
        properties: (playerData as any).properties
      };
    }

    return players;
  }

  getTeamInfo(teamName: string): TeamInfo | null {
    const team = this.player.teams?.[teamName];
    if (!team) return null;

    return {
      name: teamName,
      color: team.color || 'white',
      prefix: team.prefix || '',
      suffix: team.suffix || '',
      members: team.members || []
    };
  }

  getAllTeams(): Record<string, TeamInfo> {
    const teams: Record<string, TeamInfo> = {};
    
    for (const [name, team] of Object.entries(this.player.teams || {})) {
      teams[name] = {
        name,
        color: (team as any).color || 'white',
        prefix: (team as any).prefix || '',
        suffix: (team as any).suffix || '',
        members: (team as any).members || []
      };
    }

    return teams;
  }

  

  createCooldownManager(): CooldownManager {
    return new CooldownManager();
  }

  createCommandProcessor(prefix: string = '!'): CommandProcessor {
    return new CommandProcessor(this, prefix);
  }

  registerCommand(options: ModCommandOptions, handler: (context: ModCommandContext) => void): void {
    const modName = this.getUsername();
    
    const proxyCommand = {
      name: options.name,
      description: options.description,
      enabled: true,
      hidden: options.hidden || false,
      options: options.options,
      prefix: options.prefix || '§7[§bMod§7]§r',
      aliases: options.aliases,
      version: '1.0.0',
      run: (interaction: any) => {
        handler({
          options: interaction.options,
          proxy: interaction.proxy,
          reply: interaction.reply,
          sender: this.getUsername()
        });
      }
    };

    this.player.commands.set(options.name.toLowerCase(), proxyCommand);
    if (options.aliases) {
      for (const alias of options.aliases) {
        this.player.commands.set(alias.toLowerCase(), proxyCommand);
      }
    };
  }

  unregisterCommand(commandName: string): boolean {
    return this.commandSystem.unregisterCommand(this.getUsername(), commandName);
  }
  getCommands(modName?: string) {
    return this.commandSystem.getCommands(modName);
  }

  calculateAngle(from: Vec3, to: Vec3): { yaw: number; pitch: number } {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    
    const yaw = Math.atan2(-dx, dz) * (180 / Math.PI);
    const distance = Math.sqrt(dx * dx + dz * dz);
    const pitch = Math.atan2(-dy, distance) * (180 / Math.PI);
    
    return { yaw, pitch };
  }

  isWithinBounds(position: Vec3, min: Vec3, max: Vec3): boolean {
    return position.x >= min.x && position.x <= max.x &&
           position.y >= min.y && position.y <= max.y &&
           position.z >= min.z && position.z <= max.z;
  }

  getPerformanceStats(): {
    packetsPerSecond: number;
    memoryUsage: NodeJS.MemoryUsage;
    uptime: number;
  } {
    return {
      packetsPerSecond: 0,
      memoryUsage: process.memoryUsage(),
      uptime: process.uptime()
    };
  }

  sendMessage(message: string): void {
    let filtered = message;
    for (const filter of this.chatFilters) {
      try {
        filtered = filter(filtered);
      } catch (error) {
        logger.error('Error in chat filter:', error);
      }
    }

    try {
      this.player.client.write('chat', {
        message: JSON.stringify({ text: filtered }),
        position: 0
      });
    } catch (error) {
      logger.error('Error sending message:', error);
    }
  }

  sendToServer(message: string): void {
    try {
      this.player.server.write('chat', { message });
    } catch (error) {
      logger.error('Error sending message to server:', error);
    }
  }

  getUsername(): string {
    return this.player.entity?.username || this.player.server?.username || 'Unknown';
  }

  getServer(): string {
    return this.player.hypixel?.server?.serverType || 'lobby';
  }

  getPosition(): Vec3 | null {
    const entity = this.player.entity;
    if (!entity) return null;
    
    return {
      x: entity.position?.x || 0,
      y: entity.position?.y || 0,
      z: entity.position?.z || 0
    };
  }

  getEntity(entityId: number): any {
    return this.player.entities?.[entityId];
  }

  scheduleTask(callback: () => void, delayMs: number): number {
    const taskId = this.taskIdCounter++;
    const timeout = setTimeout(() => {
      try {
        callback();
      } catch (error) {
        logger.error(`Error in scheduled task ${taskId}:`, error);
      } finally {
        this.scheduledTasks.delete(taskId);
      }
    }, delayMs);

    this.scheduledTasks.set(taskId, timeout);
    return taskId;
  }

  scheduleRepeatingTask(callback: () => void, intervalMs: number): number {
    const taskId = this.taskIdCounter++;
    const interval = setInterval(() => {
      try {
        callback();
      } catch (error) {
        logger.error(`Error in repeating task ${taskId}:`, error);
      }
    }, intervalMs);

    this.scheduledTasks.set(taskId, interval as any);
    return taskId;
  }

  cancelTask(taskId: number): boolean {
    const task = this.scheduledTasks.get(taskId);
    if (task) {
      clearTimeout(task);
      clearInterval(task as any);
      this.scheduledTasks.delete(taskId);
      return true;
    }
    return false;
  }

  log(level: 'debug' | 'info' | 'warn' | 'error', message: string, ...args: any[]): void {
    logger[level](`[MOD] ${message}`, ...args);
  }

  distance(pos1: Vec3, pos2: Vec3): number {
    const dx = pos1.x - pos2.x;
    const dy = pos1.y - pos2.y;
    const dz = pos1.z - pos2.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  distance2D(pos1: Vec3, pos2: Vec3): number {
    const dx = pos1.x - pos2.x;
    const dz = pos1.z - pos2.z;
    return Math.sqrt(dx * dx + dz * dz);
  }

  convertPitch(pitchByte: number): number {
    return pitchByte * (180 / 256) * 2;
  }

  convertYaw(yawByte: number): number {
    return yawByte * (180 / 256) * 2;
  }

  isInGameMode(gameMode: string): boolean {
    const server = this.getServer();
    if (!server || typeof server !== 'string') {
      return false;
    }
    return server.toLowerCase().includes(gameMode.toLowerCase());
  }

  getHypixelInfo(): any {
    return this.player.hypixel || null;
  }

  getServerType(): string {
    return this.player.hypixel?.server?.serverType || 'UNKNOWN';
  }

  getServerStatus(): string {
    return this.player.hypixel?.server?.status || 'offline';
  }

  isInGame(): boolean {
    return this.getServerStatus() === 'in_game';
  }

  isInQueue(): boolean {
    return this.getServerStatus() === 'waiting' || (this.isInGame() && !this.getMap());
  }

  getMap(): string | null {
    return this.player.hypixel?.server?.map || null;
  }

  getLobbyName(): string | null {
    return this.player.hypixel?.server?.lobbyName || null;
  }

  getTeams(): any {
    return this.player.teams || {};
  }

  getTeamMap(): any {
    return this.player.teamMap || {};
  }

  findPlayerTeam(username: string): any {
    const teams = this.getTeams();
    for (const teamName in teams) {
      if (Object.hasOwnProperty.call(teams, teamName)) {
        const team = teams[teamName];
        if (team?.membersMap && team.membersMap.includes(username)) {
          return team;
        }
      }
    }
    return null;
  }

  getTeamColorCode(teamName: string): string {
    if (!teamName) return '§f';
    const color = teamName.match(/[A-Za-z]+/g)?.[0]?.toLowerCase();
    
    const colorMap: Record<string, string> = {
      'black': '§0', 'dark_blue': '§1', 'dark_green': '§2', 'dark_aqua': '§3',
      'dark_red': '§4', 'dark_purple': '§5', 'gold': '§6', 'gray': '§7',
      'dark_gray': '§8', 'blue': '§9', 'green': '§a', 'aqua': '§b',
      'red': '§c', 'light_purple': '§d', 'yellow': '§e', 'white': '§f'
    };
    
    return colorMap[color || 'white'] || '§f';
  }

  updatePlayerDisplay(uuid: string, username: string, displayName: string): void {
    try {
      this.player.client.write('player_info', {
        action: 3,
        data: [{
          UUID: uuid,
          name: username,
          hasDisplayName: true,
          displayName: displayName
        }]
      });
    } catch (error) {
      logger.error('Error updating player display:', error);
    }
  }

  updateTabHeader(header: string, footer: string): void {
    try {
      this.player.client.write('playerlist_header', {
        header: JSON.stringify({ text: header }),
        footer: JSON.stringify({ text: footer })
      });
    } catch (error) {
      logger.error('Error updating tab header:', error);
    }
  }

  parseChatMessage(messageData: any): ChatMessage {
    try {
      let text = '';
      let username = null;
      let formatted = '';
      
      const msgObj = typeof messageData === 'string' ? JSON.parse(messageData) : messageData;
      
      if (typeof msgObj.text === 'string') {
        text = msgObj.text;
        formatted = msgObj.text;
      }
      
      if (msgObj.extra && Array.isArray(msgObj.extra)) {
        const extraText = msgObj.extra.map((e: any) => e.text || '').join('');
        text += extraText;
        formatted += extraText;
        
        if (msgObj.extra.length >= 3) {
          const match = msgObj.extra[2]?.text?.match(/\] ([^:]+)/);
          if (match) {
            username = match[1];
          } else {
            username = msgObj.extra[0]?.text;
          }
        }
      }
      
      if (!username && typeof msgObj.text === 'string') {
        const textMatch = msgObj.text.match(/§7([\w_]+)§7/);
        if (textMatch) {
          username = textMatch[1];
        } else if (msgObj.text.match(/^[\w_]+$/)) {
          username = msgObj.text;
        }
      }
      
      return { 
        text: text.replace(/§./g, ''), 
        username: username || undefined, 
        formatted,
        timestamp: Date.now(),
        position: 0
      };
    } catch (error) {
      logger.error('Error parsing chat message:', error);
      return { text: '', formatted: '', timestamp: Date.now(), position: 0 };
    }
  }

  replaceEmojis(text: string, emojiMap: Record<string, string>): string {
    let result = text;
    for (const [key, value] of Object.entries(emojiMap)) {
      const regex = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
      result = result.replace(regex, value);
    }
    return result;
  }

  getDefaultEmojis(): Record<string, string> {
    return {
      "<3": "❤", ":star:": "✮", ":yes:": "✔", ":no:": "✖", ":java:": "☕",
      ":arrow:": "➜", ":shrug:": "¯\\_(ツ)_/¯", ":tableflip": "(╯°□°）╯︵ ┻━┻",
      "o/": "( ﾟ◡ﾟ)/", ":123:": "123", ":totem:": "☉_☉", ":typing:": "✎...",
      ":maths:": "√(π+x)=L", ":snail:": "@'-'", ":thinking:": "(0.o?)",
      ":gimme:": "༼つ◕_◕༽つ", ":wizard:": "('-')⊃━☆ﾟ.*･｡ﾟ", ":pvp:": "⚔",
      ":peace:": "✌", ":oof:": "OOF", ":puffer:": "<('O')>", ":yey:": "ヽ (◕◡◕) ﾉ",
      ":cat:": "= ＾● ⋏ ●＾ =", ":dab:": "<o/", ":dj:": "ヽ(⌐■_■)ノ♬",
      ":snow:": "☃", "^_^": "^_^", "h/": "ヽ(^◇^*)/", "^-^": "^-^",
      ":sloth:": "(・⊝・)", ":cute:": "(✿◠‿◠)", ":dog:": "(ᵔᴥᴥ)"
    };
  }

  createPlayerTracker(entityId?: number): PlayerStateTracker {
    return new PlayerStateTracker(this, entityId || this.player.entity?.id);
  }

  getPlayerProxy(): Player {
    return this.player;
  }

  /**
   * Get configuration values from config.json
   * @param key - Configuration key to retrieve
   * @param section - Optional section name (defaults to searching all sections)
   * @returns The configuration value or undefined if not found
   * 
   * Usage examples:
   * - api.getConfig('hypixelKey') - searches all sections for hypixelKey
   * - api.getConfig('General', 'hypixelKey') - gets hypixelKey from General section
   * - api.getConfig('tabStatsSettings', 'enabled') - gets enabled from tabStatsSettings section
   */
  getConfig(keyOrSection: string, key?: string): any {
    const config = getConfig();
    
    if (key !== undefined) {
      const section = config[keyOrSection];
      if (section && typeof section === 'object') {
        return section[key];
      }
      return undefined;
    } else {
      const searchKey = keyOrSection;
      
      if (config.hasOwnProperty(searchKey)) {
        return config[searchKey];
      }
      
      for (const [sectionName, sectionValue] of Object.entries(config)) {
        if (sectionValue && typeof sectionValue === 'object') {
          const section = sectionValue as Record<string, any>;
          if (section.hasOwnProperty(searchKey)) {
            return section[searchKey];
          }
        }
      }
      
      return undefined;
    }
  }

  cleanup(): void {
    for (const [taskId, task] of this.scheduledTasks) {
      clearTimeout(task);
      clearInterval(task as any);
    }
    this.scheduledTasks.clear();
    this.packetListeners.clear();
    this.chatHandlers.clear();
    this.chatFilters.clear();
    this.removeAllListeners();
  }
}


export class CooldownManager {
  private cooldowns = new Map<string, number>();

  setCooldown(key: string, durationMs: number): void {
    this.cooldowns.set(key, Date.now() + durationMs);
  }

  isOnCooldown(key: string): boolean {
    const expiry = this.cooldowns.get(key);
    if (!expiry) return false;
    if (Date.now() >= expiry) {
      this.cooldowns.delete(key);
      return false;
    }
    return true;
  }

  getRemainingCooldown(key: string): number {
    const expiry = this.cooldowns.get(key);
    if (!expiry) return 0;
    return Math.max(0, expiry - Date.now());
  }
}

export class CommandProcessor {
  private commands = new Map<string, {
    handler: (args: string[], sender: string) => void;
    permission?: string;
    description?: string;
  }>();

  constructor(private api: ModAPI, private prefix: string) {
    this.api.registerChatHandler((message) => {
      if (message.text.startsWith(this.prefix) && message.username) {
        const parts = message.text.slice(this.prefix.length).trim().split(' ');
        const command = parts[0].toLowerCase();
        const args = parts.slice(1);

        if (this.commands.has(command)) {
          const cmd = this.commands.get(command)!;
          try {
            cmd.handler(args, message.username);
            return true;
          } catch (error) {
            this.api.log('error', `Error executing command ${command}:`, error);
          }
        }
      }
      return false;
    });
  }

  registerCommand(name: string, handler: (args: string[], sender: string) => void, options?: {
    permission?: string;
    description?: string;
  }): void {
    this.commands.set(name.toLowerCase(), {
      handler,
      permission: options?.permission,
      description: options?.description
    });
  }

  unregisterCommand(name: string): boolean {
    return this.commands.delete(name.toLowerCase());
  }

  listCommands(): string[] {
    return Array.from(this.commands.keys());
  }

  getCommandInfo(name: string): { permission?: string; description?: string } | null {
    const cmd = this.commands.get(name.toLowerCase());
    return cmd ? { permission: cmd.permission, description: cmd.description } : null;
  }
}

export class PlayerStateTracker {
  private api: ModAPI;
  private entityId: number;
  private state: Partial<PlayerState> = {};
  private stateHistory: Partial<PlayerState>[] = [];
  private maxHistoryLength = 100;

  constructor(api: ModAPI, entityId: number) {
    this.api = api;
    this.entityId = entityId;
    this.initializeTracking();
  }

  private initializeTracking(): void {
    this.api.onPacket('animation', (packet) => {
      if (packet.entityId === this.entityId && packet.data.animation === 0) {
        this.updateState({ lastSwingTick: (this.state.ticksExisted || 0) + 1 });
      }
    });

    this.api.onPacket('entity_metadata', (packet) => {
      if (packet.entityId === this.entityId) {
        this.updateMetadata(packet.data.metadata);
      }
    });

    this.api.onPacket('entity_teleport', (packet) => {
      if (packet.entityId === this.entityId) {
        this.updatePosition({ x: packet.data.x, y: packet.data.y, z: packet.data.z });
      }
    });

    this.api.onPacket('rel_entity_move', (packet) => {
      if (packet.entityId === this.entityId && this.state.position) {
        this.updatePosition({
          x: this.state.position.x + packet.data.dX,
          y: this.state.position.y + packet.data.dY,
          z: this.state.position.z + packet.data.dZ
        });
      }
    });

    this.api.onPacket('entity_velocity', (packet) => {
      if (packet.entityId === this.entityId) {
        this.updateState({
          velocity: {
            x: packet.data.velocityX / 8000,
            y: packet.data.velocityY / 8000,
            z: packet.data.velocityZ / 8000
          }
        });
      }
    });

    this.api.scheduleRepeatingTask(() => {
      this.updateState({ ticksExisted: (this.state.ticksExisted || 0) + 1 });
    }, 50);
  }

  private updateState(updates: Partial<PlayerState>): void {
    const oldState = { ...this.state };
    this.state = { ...this.state, ...updates };
    
    this.stateHistory.push(oldState);
    if (this.stateHistory.length > this.maxHistoryLength) {
      this.stateHistory.shift();
    }

    this.api.emit('playerStateChange', {
      entityId: this.entityId,
      oldState,
      newState: this.state,
      changes: updates
    });
  }

  private updateMetadata(metadata: any[]): void {
    const updates: Partial<PlayerState> = {};

    for (const metaEntry of metadata) {
      if (metaEntry.key === 0 && typeof metaEntry.value === 'number') {
        const flags = metaEntry.value;
        const isSneaking = (flags & 0x02) !== 0;
        const wasSneaking = this.state.sneakState;
        
        if (isSneaking !== wasSneaking) {
          if (isSneaking) {
            updates.lastCrouchedTick = this.state.ticksExisted || 0;
          } else {
            updates.lastStopCrouchingTick = this.state.ticksExisted || 0;
          }
        }
        
        updates.sneakState = isSneaking;
        updates.sprinting = (flags & 0x08) !== 0;
        updates.riding = (flags & 0x40) !== 0;
        
        const usingItem = (flags & 0x10) !== 0;
        if (usingItem !== this.state.using) {
          if (usingItem) {
            updates.lastUsingTick = this.state.ticksExisted || 0;
            updates.using = true;
          } else {
            updates.lastStopUsingTick = this.state.ticksExisted || 0;
            updates.lastStopUsingItem = this.state.heldItem;
            updates.using = false;
          }
        }
      }
    }

    if (Object.keys(updates).length > 0) {
      this.updateState(updates);
    }
  }

  private updatePosition(newPos: Vec3): void {
    const updates: Partial<PlayerState> = { position: newPos };

    if (!this.state.previousPositions) {
      updates.previousPositions = [];
    } else {
      updates.previousPositions = [this.state.position!, ...this.state.previousPositions];
      if (updates.previousPositions.length > 20) {
        updates.previousPositions = updates.previousPositions.slice(0, 20);
      }
    }
    
    this.updateState(updates);
  }

  getState(): Partial<PlayerState> {
    return { ...this.state };
  }

  getStateHistory(count?: number): Partial<PlayerState>[] {
    const history = [...this.stateHistory];
    return count ? history.slice(-count) : history;
  }

  getPosition(): Vec3 | undefined {
    return this.state.position ? { ...this.state.position } : undefined;
  }

  getPreviousPositions(count: number = 5): Vec3[] {
    return this.state.previousPositions?.slice(0, count) || [];
  }

  getVelocity(): Vec3 | undefined {
    return this.state.velocity ? { ...this.state.velocity } : undefined;
  }

  getSpeed(): number {
    const velocity = this.getVelocity();
    if (!velocity) return 0;
    return Math.sqrt(velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z);
  }

  getHorizontalSpeed(): number {
    const velocity = this.getVelocity();
    if (!velocity) return 0;
    return Math.sqrt(velocity.x * velocity.x + velocity.z * velocity.z);
  }

  isSneaking(): boolean {
    return this.state.sneakState || false;
  }

  isSprinting(): boolean {
    return this.state.sprinting || false;
  }

  isUsingItem(): boolean {
    return this.state.using || false;
  }

  isRiding(): boolean {
    return this.state.riding || false;
  }

  getTicksExisted(): number {
    return this.state.ticksExisted || 0;
  }

  getTicksSinceLastSwing(): number {
    return (this.state.ticksExisted || 0) - (this.state.lastSwingTick || 0);
  }

  getTicksSinceLastCrouch(): number {
    return (this.state.ticksExisted || 0) - (this.state.lastCrouchedTick || 0);
  }

  getTicksSinceLastItemUse(): number {
    return (this.state.ticksExisted || 0) - (this.state.lastUsingTick || 0);
  }

  hasMovedRecently(ticks: number = 5): boolean {
    const positions = this.getPreviousPositions(ticks + 1);
    if (positions.length < 2) return false;

    const currentPos = this.getPosition();
    if (!currentPos) return false;

    return positions.some(pos => 
      this.api.distance(currentPos, pos) > 0.1
    );
  }

  getAverageSpeed(ticks: number = 10): number {
    const positions = this.getPreviousPositions(ticks);
    if (positions.length < 2) return 0;

    let totalDistance = 0;
    for (let i = 0; i < positions.length - 1; i++) {
      totalDistance += this.api.distance(positions[i], positions[i + 1]);
    }

    return totalDistance / (positions.length - 1) * 20;
  }

  isLikelyOnGround(): boolean {
    const velocity = this.getVelocity();
    return !velocity || Math.abs(velocity.y) < 0.1;
  }

  detectSuspiciousMovement(): {
    speedHacking: boolean;
    flying: boolean;
    teleporting: boolean;
    details: string[];
  } {
    const details: string[] = [];
    let speedHacking = false;
    let flying = false;
    let teleporting = false;

    const horizontalSpeed = this.getHorizontalSpeed();
    const averageSpeed = this.getAverageSpeed();
    
    if (horizontalSpeed > 0.8 || averageSpeed > 12) {
      speedHacking = true;
      details.push(`Excessive speed: ${horizontalSpeed.toFixed(2)} blocks/tick (avg: ${averageSpeed.toFixed(2)} blocks/s)`);
    }

    const velocity = this.getVelocity();
    if (velocity && velocity.y > 0 && !this.hasMovedRecently(20)) {
      flying = true;
      details.push(`Sustained upward velocity without movement: ${velocity.y.toFixed(3)}`);
    }

    const positions = this.getPreviousPositions(3);
    if (positions.length >= 2) {
      const distance = this.api.distance(positions[0], positions[1]);
      if (distance > 8) {
        teleporting = true;
        details.push(`Large position change: ${distance.toFixed(2)} blocks in one tick`);
      }
    }

    return { speedHacking, flying, teleporting, details };
  }
}

export class StateMachine<T extends string> {
  private currentState: T;
  private transitions = new Map<T, Map<string, T>>();
  private stateHandlers = new Map<T, () => void>();
  private transitionHandlers = new Map<string, (from: T, to: T) => void>();

  constructor(initialState: T) {
    this.currentState = initialState;
  }

  addTransition(from: T, event: string, to: T): void {
    if (!this.transitions.has(from)) {
      this.transitions.set(from, new Map());
    }
    this.transitions.get(from)!.set(event, to);
  }

  onState(state: T, handler: () => void): void {
    this.stateHandlers.set(state, handler);
  }

  onTransition(event: string, handler: (from: T, to: T) => void): void {
    this.transitionHandlers.set(event, handler);
  }

  trigger(event: string): boolean {
    const stateTransitions = this.transitions.get(this.currentState);
    if (!stateTransitions || !stateTransitions.has(event)) {
      return false;
    }

    const newState = stateTransitions.get(event)!;
    const oldState = this.currentState;
    this.currentState = newState;

    const transitionHandler = this.transitionHandlers.get(event);
    if (transitionHandler) {
      transitionHandler(oldState, newState);
    }

    const stateHandler = this.stateHandlers.get(newState);
    if (stateHandler) {
      stateHandler();
    }

    return true;
  }

  getCurrentState(): T {
    return this.currentState;
  }

  canTransition(event: string): boolean {
    const stateTransitions = this.transitions.get(this.currentState);
    return stateTransitions ? stateTransitions.has(event) : false;
  }  
}