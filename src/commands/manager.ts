import type Player from '../player/player.js';
import { logger } from '../utils/logger.js';
import type Command from './command.js';
import discordRpc from '../discord/discordRpc.js';
import { MANIFEST as COMMANDS } from './_manifest.js';

class CommandManager {
	private currentText: string = '';
	private readonly proxy: Player;

	public constructor(proxy: Player) {
		this.currentText = '';
		this.proxy = proxy;

		void this.loadCommands();
	}

	public setTextInput(data: any): boolean {
		if (!data?.text) return false;
		this.currentText = data.text;
		return false;
	}

	public async loadCommands(): Promise<void> {
		for (const mod of COMMANDS) {
			try {
				const command: Command = (mod as any).default || mod;

				if (
					this.proxy.commands.has(command.name) ||
					command.aliases?.some((alias) => this.proxy.commands.has(alias))
				) {
					logger.warn(`Duplicate command: ${command.name}`);
					continue;
				}

				this.proxy.commands.set(command.name.toLowerCase(), command);
				logger.info(`Loaded command: ${command.name}`);
			} catch (error: any) {
				logger.warn(`Error while loading command: ${error.message}`);
			}
		}
	}

	public handleTabComplete(data: any): boolean {
		try {
			if (!data?.matches) return false;
			const suggestions: string[] = data.matches;

			const input = this.currentText.toLowerCase();
			if (!input || input.trim() === '' || !input.startsWith('/')) {
				this.proxy.client.write('tab_complete', { matches: data.matches });
				return true;
			}

			const args = input.startsWith('/a:') ? input.split('/a:').slice(1) : input.split('/').slice(1);
			const commandName = args.shift()?.trim();

			if (!commandName) {
				suggestions.unshift(...this.proxy.commands.keys().map((cmd) => `/a:${cmd}`));
				this.proxy.client.write('tab_complete', { matches: suggestions });
				return true;
			}

			const command = this.proxy.commands.get(commandName);

			if (!command) {
				logger.warn('Command not found:', commandName);

				if (input === '/a:' || input === '/a') {
					suggestions.unshift(...this.proxy.commands.keys().map((cmd) => `/a:${cmd}`));
				} else if (input.startsWith('/a:')) {
					suggestions.unshift(
						...this.proxy.commands
							.keys()
							.filter((opt) => opt.startsWith(commandName))
							.map((cmd) => `/a:${cmd}`),
					);
				}
				this.proxy.client.write('tab_complete', { matches: suggestions });
				return true;
			}
			this.proxy.client.write('tab_complete', { matches: [] });
		} catch (error) {
			logger.error('Error while handling tab_complete:', error);
		}

		return false;
	}


	public handleChat(data: any): boolean {
		if (!data?.message) return false;
		const message = data.message;
		if (message.toLowerCase().startsWith('/p')) {
			discordRpc.getPartyStatus();
		}
		if (!message.toLowerCase().startsWith('/a:')) return false;

		const split = message.split(' ');
		const commandName = split.shift()?.trim().replace(/^\/a:/, '');
		if (!commandName) return false;

		const command = this.proxy.commands.get(commandName.toLowerCase());
		if (!command?.enabled) return true;

		const args = split;

		const options = new Map<string, string>();
		if (command.options) {
			const missingOptions: string[] = [];

			for (let i = 0; i < command.options.length; i++) {
				const option = command.options[i];
				let value: string | undefined;

				if (i === command.options.length - 1) {
					value = args.slice(i).join(' ').trim();
				} else {
					value = args[i];
				}

				if (option.required && (!value || value === '')) {
					missingOptions.push(option.name);
					continue;
				}

				if (option.type === 'number' && Number.isNaN(Number(value))) {
					this.proxy.client.write('chat', {
						message: JSON.stringify({
							text: `${command.prefix || ''} §cInvalid value for option ${option.name}: ${value} (expected number)§r`,
						}),
					});
					return true;
				} else if (
					option.type === 'boolean' &&
					!['true', 'false', 't', 'f', 'y', 'n'].includes(value?.toLowerCase() ?? '')
				) {
					this.proxy.client.write('chat', {
						message: JSON.stringify({
							text: `${command.prefix || ''} §cInvalid value for option ${option.name}: ${value} (expected true or false)§r`,
						}),
					});
					return true;
				} else if (option.type === 'string' && option.options && !option.options.includes(value ?? '')) {
					const expectedValues = option.options
						.map((opt) => `"${opt}"`)
						.join(', ')
						.replace(/, (?<text>[^,]*)$/, ' or $1');

					this.proxy.client.write('chat', {
						message: JSON.stringify({
							text: `${command.prefix || ''} §cInvalid value for option ${option.name}: ${value} (expected ${expectedValues})§r`,
						}),
					});
					return true;
				}

				if (value) {
					options.set(option.name, value);
				}
			}

			if (missingOptions.length > 0) {
				const usage = command.options.map((opt) => `<${opt.name}>`).join(' ');
				this.proxy.client.write('chat', {
					message: JSON.stringify({
						text: `${command.prefix || ''} §cMissing arguments! Usage: /a:${command.name} ${usage}`,
					}),
				});
				return true;
			}
		}

		const interaction = {
			proxy: this.proxy,
			options,
			reply: (message: string) => {
				this.proxy.client.write('chat', { message: JSON.stringify({ text: `${command.prefix || ''} ${message}§r` }) });
				return true;
			},
		};

		try {
			command.run(interaction);
			return true;
		} catch (error: any) {
			logger.error(`Error executing command ${commandName}:`, error);
			this.proxy.client.write('chat', {
				message: JSON.stringify({
					text: `§cAn error occurred while executing the command: ${error.message || error}§r`,
				}),
			});
			return true;
		}
	}
	public getUniqueCommands(): Command[] {
		const uniqueCommands = new Map<string, Command>();
		for (const [name, command] of this.proxy.commands.entries()) {
			if (!uniqueCommands.has(command.name)) {
				uniqueCommands.set(command.name, command);
			}
		}
		return Array.from(uniqueCommands.values());
	}
}

export default CommandManager;
