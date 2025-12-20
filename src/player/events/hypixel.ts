import { writeServerboundPacket, readClientboundPacket } from '@winstreak-ws/hypixel-plugin-message'
import { logger } from '../../utils/logger.js';
import type Player from '../player.js';

const events = {
	hypixel: {
		'hypixel:hello': 'hypixel:hello',
		'hypixel:party_info': 'hypixel:party_info',
		'hyevent:location': 'hyevent:location',
	},
};

const handleHypixel = (player: Player, packet: any, meta: any) => {
	if (packet.channel === 'hypixel:hello') {
		player.hypixel = {
			login: true,
			server: {
				status: 'waiting',
			},
			party: {
				inParty: false,
			},
		};

		const registerPacket = writeServerboundPacket('register', {
			version: 1,
			subscribedEvents: new Map([['hyevent:location', 1]]),
		});

		player.server?.write('custom_payload', {
			channel: 'hypixel:register',
			data: registerPacket,
		});

		const partyPacket = writeServerboundPacket('party_info', {
			version: 2,
		});

		player.server?.write('custom_payload', {
			channel: 'hypixel:party_info',
			data: partyPacket,
		});
	}

	if (packet.channel === 'hypixel:party_info') {
		const partyPacket = readClientboundPacket('party_info', packet.data);
	}

	if (packet.channel === 'hyevent:location') {
		const locationPacket = readClientboundPacket('location', packet.data);
		if (!locationPacket.success) return;

		player.hypixel.server = {
			status: locationPacket.lobbyName ? 'lobby' : 'in_game',
			serverName: locationPacket.serverName,
			serverType: locationPacket.serverType,
			lobbyName: locationPacket.lobbyName,
			mode: locationPacket.mode,
			map: locationPacket.map,
		};
	}
};

export { events, handleHypixel };
