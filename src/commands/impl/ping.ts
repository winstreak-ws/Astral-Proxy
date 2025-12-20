import { writeServerboundPacket } from '@winstreak-ws/hypixel-plugin-message'
import type Command from '../command.js';

const PING_TIMEOUT = 5_000;

export default {
	name: 'ping',
	hidden: false,
	description: 'Check your ping to Hypixel',
	version: '1.0.0',
	prefix: '§7[§5Astral§7]§r',
	enabled: true,
	run: async ({ proxy, options, reply }) => {
		if (!proxy.hypixel || proxy.hypixel.server.status === 'offline') {
			reply('You are not connected to Hypixel');
			return;
		}

		const pingPacket = writeServerboundPacket('ping', { version: 1 });
		const startTime = Date.now();

		const handlePing = (id: NodeJS.Timeout) => {
			clearTimeout(id);
			const pingDuration = Date.now() - startTime;
			reply(`Ping: ${pingDuration}ms`);
			return true;
		};

		const timeoutId = setTimeout(() => {
			proxy.removeListener('hypixel:ping', handlePing);
			reply(`Ping timed out after ${PING_TIMEOUT}ms`);
		}, PING_TIMEOUT);

		proxy.onceIncoming('hypixel:ping', handlePing.bind(null, timeoutId));

		try {
			if (!proxy.server) {
				throw new Error('Server connection not available');
			}

			proxy.server.write('custom_payload', {
				channel: 'hypixel:ping',
				data: pingPacket,
			});
		} catch (error) {
			clearTimeout(timeoutId);
			proxy.removeListener('hypixel:ping', handlePing);
			reply(`Failed to send ping: ${error.message}`);
		}
	},
} as Command;
