import type { Buffer } from 'node:buffer';
import fs from 'node:fs';
import EventEmitter from 'node:events';
import bufferEqual from 'buffer-equal';
import mc, { createClient, createServer, states } from 'minecraft-protocol';
import type { Client, ServerClient, Server } from 'minecraft-protocol';
import type { EventMap } from 'typed-emitter';
import type TypedEventEmitter from 'typed-emitter';
import Player from '../player/player.js';
import { logger } from '../utils/logger.js';
import OnMSACode from './onMSACode.js';
import { getCachePath } from '../utils/paths.js';
import { getConfig } from '../config/config.js';
import wsClient from '../data/websocketClient.js';
let config = getConfig();

setInterval(() => {
	config = getConfig();
}, 5000);

type TypedEmitter<T extends EventMap> = TypedEventEmitter.default<T>;

const { ping } = mc;

type ProxyEvents = EventMap & {
	end(username: string): Promise<void> | void;
	start(client: ServerClient, server: Client): Promise<void> | void;
	login(username: string, uuid: string): Promise<void> | void;
};

class Proxy extends (EventEmitter as new () => TypedEmitter<ProxyEvents>) {
	private verMap: { [key: string]: string } = {
		'1.8': '1.8.8',
		'1.8.8': '1.8.8',
		'1.8.9': '1.8.8',
	};

	public readonly host: string;
	public readonly port: number;
	public readonly listenPort: number;
	public readonly version: string;

	public players: Map<string, Player> = new Map();
	public server: Server;

	public constructor(host: string, port: number, listenPort: number, version: string) {
		super();
		this.host = host;
		this.port = port;
		this.listenPort = listenPort;
		this.version = this.verMap[version] || version;

		this.server = createServer({
			beforePing: async (response, client, callback) => {
				let res;

				try {
					res = await ping({
						host: this.host,
						port: this.port,
						version: client.version,
					});

					if (res?.description) {
						const split = res.description.split('\n');
						split[0] = '             §8˙ §b✦ §8· §5⁕§8· ˙ §dAstral Proxy §8˚ ⁕ §e⁂  §8·';
						res.description = split.join('\n');
					}
				} catch (error) {
					logger.error('Ping failed:', error);
					res = {
						version: { name: client.version, protocol: 47 },
						players: { max: 0, online: 0, sample: [] },
						description: { text: '§cFailed to ping the server' },
					};
				}

				return callback?.(null, res);
			},
			beforeLogin: (client) => {
				if (client.protocolVersion !== 47) {
					client.end('§cPlease connect using 1.8.9');
				}
			},
			'online-mode': true,
			port: listenPort,
			keepAlive: false,
			version: '1.8.9',
			errorHandler(client, error) {
				if (error.name === 'ECONNRESET') {
					logger.warn('Connection reset by peer');
				} else {
					logger.error('Error:', error);
				}
			},
		});

		this.server.on('login', async (client) => {
			const alive = await ping({
				host: this.host,
				port: this.port,
				version: client.version,
			}).then(() => true).catch(() => false);

			if (alive) {
				this.onLogin(client);
			} else {
				client.end('§cFailed to connect to the server, please try again later.');
			}
		});
	}

	private onLogin(client: ServerClient) {
		const server = createClient({
			host: this.host,
			port: this.port,
			username: client.username,
			keepAlive: false,
			version: this.version,
			profilesFolder: pathForProfiles(),
			auth: 'microsoft',
			onMsaCode: (data) => new OnMSACode(data, client, server),
			hideErrors: true,
		});

		server.once('login', () => {
			this.emit('login', client.username, client.uuid);
		});

		server.once('session', (session) => {
			logger.debug('Session:', session.selectedProfile.name);

			if (session.selectedProfile.name !== client.username) {
				client.write('kick_disconnect', {
					reason: JSON.stringify({
						text: '§cAccount mismatch, please relog with the correct account.',
					}),
				});
				client.end();
				server.end();
				return;
			}

			try {
				const chan = config.ircSettings?.channel ?? 'global';
				const pwd = config.ircSettings?.channelPassword ?? '';
				const shouldJoin = config.ircSettings?.ircToggle ?? true;
				if (shouldJoin) setTimeout(() => wsClient.joinIrc(chan, pwd), 4000);
			} catch {}
			const player = new Player(this, client, server);
			this.players.set(client.username, player);
			logger.info(`Successfully authenticated ${client.username} with Microsoft`);

			this.emit('start', client, server);
		});

		client.on('packet', (data, meta, buffer, raw) => {
			if (meta.name === 'chat' && meta.state === states.PLAY) {
				const msg = data.message;
				const trigger = config.ircSettings?.ircPrefix || '-';

				if (typeof msg === 'string' && msg.startsWith(trigger)) {
					const cleanMessage = msg.slice(trigger.length).trim();

					if (cleanMessage.length > 0) {
						const ircKnown = typeof config.ircSettings?.ircToggle === 'boolean';
						const ircEnabled = config.ircSettings?.ircToggle === true;

						if (ircKnown && !ircEnabled) {
							try {
								client.write('chat', {
									message: JSON.stringify({
										text: '',
										extra: [
											{ text: '[', color: 'gray' },
											{ text: 'Astral', color: 'dark_purple' },
											{ text: '] ', color: 'gray' },
											{ text: 'IRC is disabled for your account. ', color: 'red' },
											{
												text: '[Enable IRC]',
												color: 'aqua',
												clickEvent: { action: 'open_url', value: 'https://winstreak.ws/discord' },
												hoverEvent: { action: 'show_text', value: { text: 'Enable IRC using the Winstreak Discord bot', color: 'yellow' } }
											}
										]
									})
								});
							} catch { }
							return;
						}

						const sender = config.ircSettings?.winstreakUsername || client.username;
						try { wsClient.sendChatMessage(cleanMessage); } catch { }
					}

					return;
				}
			}

			this.toClient(server, client, data, meta, buffer, raw);
		});

		server.on('packet', (data, meta, buffer, raw) => {
			this.toServer(server, client, data, meta, buffer, raw);
		});

		client.once('end', () => this.onEnd(client.username));

		wsClient.onIrcMessage?.((sender, message, userId) => {
			this.broadcastIRC(sender, message, userId);
		});

		wsClient.onIrcEvent?.((type, name, userId) => {
			this.broadcastIRCEvent(type, name, userId);
		});

	}

	private broadcastIRCEvent(type: "join" | "leave", name: string, userId: string) {
		const sender = name;

		let nameColor = 'gray';
		let displaySender = sender;
		const mcColorMatch = sender.match(/^§([0-9a-fk-or])/i);
		if (mcColorMatch) {
			const mcColorCode = mcColorMatch[1].toLowerCase();
			const mcColorMap: Record<string, string> = {
				'0': 'black',
				'1': 'dark_blue',
				'2': 'dark_green',
				'3': 'dark_aqua',
				'4': 'dark_red',
				'5': 'dark_purple',
				'6': 'gold',
				'7': 'gray',
				'8': 'dark_gray',
				'9': 'blue',
				'a': 'green',
				'b': 'aqua',
				'c': 'red',
				'd': 'light_purple',
				'e': 'yellow',
				'f': 'white'
			};
			nameColor = mcColorMap[mcColorCode] || 'gray';
			displaySender = sender.replace(/^§[0-9a-fk-or]/i, '');
		}

		for (const [, player] of this.players) {
			const client = player.client;
			if (client.state !== states.PLAY) continue;

			client.write('chat', {
				message: JSON.stringify({
					text: '',
					extra: [
						{ text: '[', color: 'gray' },
						{ text: 'Astral', color: 'dark_purple' },
						{ text: '] ', color: 'gray' },
						{ text: '[IRC] ', color: 'gold' },
						{
							text: displaySender,
							color: nameColor,
							hoverEvent: {
								action: 'show_text',
								value: userId
									? {
										text: '',
										extra: [
											{ text: displaySender, color: 'gold' },
											{
												text:
													' ' +
													(() => {
														const d = new Date();
														const HH = String(d.getHours()).padStart(2, '0');
														const mm = String(d.getMinutes()).padStart(2, '0');
														const ss = String(d.getSeconds()).padStart(2, '0');
														return `${HH}:${mm}:${ss}`;
													})(),
												color: 'green'
											},
											{ text: '\n', color: 'white' },
											{ text: `#${userId}`, color: 'dark_gray' }
										]
									}
									: { text: displaySender, color: 'gold' }
							}
						},
						{ text: type === 'join' ? ' Joined the channel' : ' Left the channel', color: 'white' },
					],
				}),
				position: 0,
				sender: '0',
			});
		}

		logger.info(`[IRC] ${displaySender} ${type}ed the channel`);
	}


	private broadcastIRC(_sender: string, message: string, userId?: string) {
		const sender = _sender;

		let nameColor = 'gray';
		let displaySender = sender;
		const mcColorMatch = sender.match(/^§([0-9a-fk-or])/i);
		if (mcColorMatch) {
			const mcColorCode = mcColorMatch[1].toLowerCase();
			const mcColorMap: Record<string, string> = {
				'0': 'black',
				'1': 'dark_blue',
				'2': 'dark_green',
				'3': 'dark_aqua',
				'4': 'dark_red',
				'5': 'dark_purple',
				'6': 'gold',
				'7': 'gray',
				'8': 'dark_gray',
				'9': 'blue',
				'a': 'green',
				'b': 'aqua',
				'c': 'red',
				'd': 'light_purple',
				'e': 'yellow',
				'f': 'white'
			};
			nameColor = mcColorMap[mcColorCode] || 'gray';
			displaySender = sender.replace(/^§[0-9a-fk-or]/i, '');
		}

		for (const [, player] of this.players) {
			const client = player.client;
			if (client.state !== states.PLAY) continue;

			client.write('chat', {
				message: JSON.stringify({
					text: '',
					extra: [
						{ text: '[', color: 'gray' },
						{ text: 'Astral', color: 'dark_purple' },
						{ text: '] ', color: 'gray' },
						{ text: '[IRC] ', color: 'gold' },
						{
							text: displaySender,
							color: nameColor,
							hoverEvent: {
								action: 'show_text',
								value: userId
									? {
										text: '',
										extra: [
											{ text: displaySender, color: 'gold' },
											{
												text:
													' ' +
													(() => {
														const d = new Date();
														const HH = String(d.getHours()).padStart(2, '0');
														const mm = String(d.getMinutes()).padStart(2, '0');
														const ss = String(d.getSeconds()).padStart(2, '0');
														return `${HH}:${mm}:${ss}`;
													})(),
												color: 'green'
											},
											{ text: '\n', color: 'white' },
											{ text: `#${userId}`, color: 'dark_gray' }
										]
									}
									: { text: displaySender, color: 'gold' }
							}
						},
						{ text: ': ', color: 'white' },
						{ text: message, color: 'white' },
					],
				}),
				position: 0,
				sender: '0',
			});
		}

		logger.info(`[IRC] ${displaySender}: ${message}`);
	}

	private toServer(server: Client, client: ServerClient, data: any, meta: any, buffer: Buffer, raw: Buffer) {
		if (meta.state === states.PLAY && client.state === states.PLAY) {
			const player = this.players.get(client.username);
			if (!player) return;

			if (meta.name === 'custom_payload') {
				if (config.clientBypass?.enabled) {
					const blockedChannels: string[] = [];
					if (config.clientBypass.enableBadlionMods) blockedChannels.push('badlion:mods');
					if (config.clientBypass.enableLunarMods) blockedChannels.push('MC|Brand');

					if (blockedChannels.includes(data.channel)) {
						return;
					}
				}
			}

			if (meta.name === 'set_compression') {
				client.compressionThreshold = data.threshold;
				return;
			}

			player.handlePacket('incoming', server, client, data, meta, buffer, raw);
		}
	}

	private toClient(server: Client, client: ServerClient, data: any, meta: any, buffer: Buffer, raw: Buffer) {
		if (meta.state === states.PLAY && server.state === states.PLAY) {
			const player = this.players.get(client.username);
			if (!player) return;

			if (meta.name === 'custom_payload') {
				if (config.clientBypass?.enabled) {
					const blockedChannels: string[] = [];
					if (config.clientBypass.enableBadlionMods) blockedChannels.push('badlion:mods');
					if (config.clientBypass.enableLunarMods) blockedChannels.push('MC|Brand');

					if (blockedChannels.includes(data.channel)) {
						return;
					}
				}
			}

			player.handlePacket('outgoing', server, client, data, meta, buffer, raw);
		}
	}


	private onEnd(username: string) {
		logger.info('Connection ended for', username);
		const player = this.players.get(username);
		if (player) {
			player.disconnect();
			this.players.delete(username);
		}

		if (this.players.size === 0) {
			try {
				const chan = config.ircSettings?.channel ?? 'global';
				const pwd = config.ircSettings?.channelPassword ?? '';
				wsClient.leaveIrc(chan, pwd);
			} catch {}
		}

		this.emit('end', username);
	}

	public on<K extends keyof ProxyEvents>(event: K, listener: ProxyEvents[K]): this {
		return super.on(event, listener as (...args: any[]) => void);
	}

	public once<K extends keyof ProxyEvents>(event: K, listener: ProxyEvents[K]): this {
		return super.once(event, listener as (...args: any[]) => void);
	}

	public emit<K extends keyof ProxyEvents>(event: K, ...args: Parameters<ProxyEvents[K]>): boolean {
		return super.emit(event, ...args);
	}
}

function pathForProfiles(): string {
	const p = getCachePath('profiles');
	const dir = p.endsWith('profiles') ? p : p.replace(/\\?[^\\/]+$/, 'profiles');
	try { fs.mkdirSync(dir, { recursive: true }); } catch { }
	return dir;
}

export default Proxy;
