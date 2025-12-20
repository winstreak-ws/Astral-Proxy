import type { Buffer } from 'node:buffer';
import EventEmitter from 'node:events';
import type { Client, ServerClient } from 'minecraft-protocol';
import type { ChatMessage } from 'prismarine-chat';
import ChatLoader from 'prismarine-chat';
import EntityLoader from 'prismarine-entity';
import ItemLoader from 'prismarine-item';
import RegistryLoader from 'prismarine-registry';
import type Command from '../commands/command.js';
import CommandManager from '../commands/manager.js';
import loadMods from '../mods/loader.js';
import type Proxy from '../proxy/createProxy.js';
import { logger } from '../utils/logger.js';
import ScoreboardLoader from '../utils/scoreboard.js';
import TeamLoader from '../utils/teams.js';
import { events as hypixelEvents, handleHypixel } from './events/hypixel.js';
import { events as playerEvents, handlePlayers } from './events/player.js';
import { events as scoreboardEvents, handleScoreboards } from './events/scoreboard.js';
import { handlePlayerlistHeader } from './events/tab.js';
import { events as teamEvents, handleTeam } from './events/teams.js';
import discordRpc from '../discord/discordRpc.js';


type EventHandler = (
	client: ServerClient,
	server: Client,
	data: any,
	meta: any,
	buffer: Buffer,
	raw: Buffer,
) => boolean | undefined;

type EventOptions = {
	once?: boolean;
};

type HandlerEntry = {
	handler: EventHandler;
	options: EventOptions;
};

type PacketHandlerMap = Map<string, HandlerEntry[]>;

export default class Player extends EventEmitter {
	private readonly incomingHandlers: PacketHandlerMap;

	private readonly outgoingHandlers: PacketHandlerMap;

	public rawProxy: Proxy;

	public client: ServerClient;

	public server: Client;

	public Registry: ReturnType<typeof RegistryLoader>;

	public Entity: ReturnType<typeof EntityLoader>;

	public Item: ReturnType<typeof ItemLoader>;

	public Chat: ReturnType<typeof ChatLoader>;

	public Team: ReturnType<typeof TeamLoader>;

	public Scoreboard: ReturnType<typeof ScoreboardLoader>;

	public commands: Map<string, Command>;

	public commandManager: CommandManager;

	public self: any;

	public entity: any;

	public players: object;

	public entities: object;

	public uuidToUsername: object;

	public entityDataByInternalId: object;

	public tablist: { footer: ChatMessage; header: ChatMessage };

	public teams: object;

	public teamMap: object;

	public scoreboards: object;

	public hypixel: {
		login: boolean;
		party: {
			inParty: boolean;
			members?: Map<
				string,
				{
					role: string;
					uuid: string;
				}
			>;
		};
		server: {
			lobbyName?: string;
			map?: string;
			mode?: string;
			serverName?: string;
			serverType?: string;
			status: 'in_game' | 'lobby' | 'offline' | 'waiting';
		};
	};

	public constructor(proxy: Proxy, client: ServerClient, server: Client) {
		super();
		this.incomingHandlers = new Map();
		this.outgoingHandlers = new Map();

		this.rawProxy = proxy;
		this.client = client;
		this.server = server;

		void loadMods(this);
		discordRpc.setProxy(this);

		this.Registry = RegistryLoader(proxy.version);
		this.Entity = EntityLoader(proxy.version);
		this.Item = ItemLoader(proxy.version);
		this.Chat = ChatLoader(proxy.version);

		this.Team = TeamLoader(this);
		this.Scoreboard = ScoreboardLoader(this);

		this.commands = new Map();
		this.commandManager = new CommandManager(this);

		this.players = {};
		this.entities = {};
		this.uuidToUsername = {};
		this.entityDataByInternalId = Object.fromEntries(this.Registry.entitiesArray.map((ent) => [ent.internalId, ent]));

		this.tablist = {
			header: new this.Chat(''),
			footer: new this.Chat(''),
		};

		this.teams = {};
		this.teamMap = {};

		this.scoreboards = {};

		this.hypixel = {
			login: false,
			server: {
				status: 'offline',
			},
			party: {
				inParty: false,
			},
		};
	}

	public onIncoming(event: string, handler: EventHandler, options: EventOptions = {}): this {
		if (!this.incomingHandlers.has(event)) {
			this.incomingHandlers.set(event, []);
		}

		this.incomingHandlers.get(event)!.push({ handler, options });
		return this;
	}

	public onOutgoing(event: string, handler: EventHandler, options: EventOptions = {}): this {
		if (!this.outgoingHandlers.has(event)) {
			this.outgoingHandlers.set(event, []);
		}

		this.outgoingHandlers.get(event)!.push({ handler, options });
		return this;
	}

	public onceIncoming(event: string, handler: EventHandler): this {
		return this.onIncoming(event, handler, { once: true });
	}

	public onceOutgoing(event: string, handler: EventHandler): this {
		return this.onOutgoing(event, handler, { once: true });
	}

	private executeHandlers(
		handlers: Map<string, { handler: EventHandler; options: EventOptions }[]>,
		packetName: string,
		client: ServerClient,
		server: Client,
		data: any,
		meta: any,
		buffer: Buffer,
		raw: Buffer
	): boolean {
		if (!handlers.has(packetName)) return false;

		let isEdited = false;
		const handlerList = handlers.get(packetName)!;

		for (let i = 0; i < handlerList.length; i++) {
			const { handler, options } = handlerList[i];
			try {
				isEdited = handler(client, server, data, meta, buffer, raw) ?? isEdited;
				if (options.once) {
					handlerList.splice(i--, 1);
				}
			} catch (error) {
				logger.error('Error while handling packet:', error);
			}
		}

		if (handlerList.length === 0) {
			handlers.delete(packetName);
		}

		return isEdited;
	}

	public handlePacket(
		direction: 'incoming' | 'outgoing',
		server: Client,
		client: ServerClient,
		data: any,
		meta: any,
		buffer: Buffer,
		raw: Buffer,
	) {
		if (direction === 'incoming') {
			this.handleIncoming(server, client, data, meta, buffer, raw);
		} else {
			this.handleOutgoing(server, client, data, meta, buffer, raw);
		}
	}

	private handleIncoming(server: Client, client: ServerClient, data: any, meta: any, buffer: Buffer, raw: Buffer) {
		const packetName = meta.name === 'custom_payload' ? data.channel : meta.name;
		let isEdited = false;

		if (meta.name === packetName) handlePlayerlistHeader(this, data, meta);
		if (playerEvents.player[packetName]) handlePlayers(this, data, meta);
		if (teamEvents.teams[packetName]) handleTeam(this, data, meta);
		if (scoreboardEvents.scoreboard[packetName]) handleScoreboards(this, data, meta);
		if (hypixelEvents.hypixel[packetName]) handleHypixel(this, data, meta);

		if (packetName === 'tab_complete') {
			isEdited = this.commandManager.handleTabComplete(data);
		} else {
			isEdited = this.executeHandlers(this.incomingHandlers, packetName, client, server, data, meta, buffer, raw);
		}

		if (!isEdited) client.writeRaw(raw);
	}

	private handleOutgoing(server: Client, client: ServerClient, data: any, meta: any, buffer: Buffer, raw: Buffer) {
		const packetName = meta.name === 'custom_payload' ? data.channel : meta.name;
		let isEdited = false;

		if (meta.name === 'tab_complete') {
			isEdited = this.commandManager.setTextInput(data);
		} else if (meta.name === 'chat') {
			isEdited = this.commandManager.handleChat(data);
		}

		isEdited = this.executeHandlers(this.outgoingHandlers, packetName, client, server, data, meta, buffer, raw) || isEdited;

		if (!isEdited) server.writeRaw(raw);
	}

	public disconnect() {
		if (this.client) this.client.end();
		if (this.server) this.server.end();
	}

	public registerChatHandler(handler: (data: any) => boolean): void {
		this.onOutgoing('chat', (client, server, data) => {
			const shouldCancel = handler(data);
			if (shouldCancel) {
				return true;
			}
			return false;
		});
	}
}
