import { logger } from '../../utils/logger.js';
import { removeFormattingCodes } from '../../utils/other.js';
import type Player from '../player.js';

const events = {
	scoreboard: {
		scoreboard_objective: 'scoreboard_objective',
		scoreboard_score: 'scoreboard_score',
		scoreboard_display_objective: 'scoreboard_display_objective',
	},
};

const handleScoreboards = (player: Player, packet: any, meta: any) => {
	if (meta.name === 'scoreboard_objective') {
		if (packet.action === 0) {
			const { name } = packet;
			const scoreboard = new player.Scoreboard(packet);
			player.scoreboards[name] = scoreboard;
		}

		if (packet.action === 1) {
			player.scoreboards[packet.name] = undefined;

			for (const position in player.Scoreboard.positions) {
				if (!player.Scoreboard.positions[position]) continue;
				const scoreboard = player.Scoreboard.positions[position];

				if (scoreboard && scoreboard.name === packet.name) {
					player.Scoreboard.positions[position] = undefined;
					break;
				}
			}
		}

		if (packet.action === 2) {
			if (!Object.hasOwn(player.scoreboards, packet.name)) {
				logger.error(new Error(`Received update for unknown objective ${packet.name}`).message);
				return;
			}

			player.scoreboards[packet.name].setTitle(packet.displayText);
		}
	}

	if (meta.name === 'scoreboard_score') {
		const scoreboard = player.scoreboards[packet.scoreName];
		if (scoreboard !== undefined && packet.action === 0) {
			scoreboard.addItem(packet.itemName, packet.value);
		}
		
		if (packet.action === 1) {
			if (scoreboard !== undefined) {
				scoreboard.removeItem(packet.itemName);
			}
		
			for (const sb of Object.values(player.scoreboards)) {
				if (sb?.items?.[packet.itemName]) {
					sb.removeItem(packet.itemName);
				}
			}
		}
	}

	if (meta.name === 'scoreboard_display_objective') {
		const { name, position } = packet;
		const scoreboard = player.scoreboards[name];

		if (scoreboard !== undefined) {
			player.Scoreboard.positions[position] = scoreboard;
		}
	}
};

export { events, handleScoreboards };
