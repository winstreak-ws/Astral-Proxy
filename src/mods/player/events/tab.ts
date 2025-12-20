import { escapeValueNewlines } from '../../../utils/other.js';
import type Player from '../player.js';

const handlePlayerlistHeader = (player: Player, packet: any, meta: any) => {
	if (packet.header) {
		console.log(packet.header)
		const header = escapeValueNewlines(packet.header);
		player.tablist.header = player.Chat.fromNotch(header);
	}

	if (packet.footer) {
		console.log(packet.footer)
		const footer = escapeValueNewlines(packet.footer);
		player.tablist.footer = player.Chat.fromNotch(footer);
	}
};

export { handlePlayerlistHeader };
