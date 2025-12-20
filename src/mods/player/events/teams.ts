import type Player from '../player.js';

const events = {
	teams: {
		scoreboard_team: 'scoreboard_team',
		teams: 'teams',
	},
};

const teamHandler = (player: Player, packet: any) => {
	const { team: teamName, mode } = packet;
	let team = player.teams[teamName];

	if (mode === 0) {
		team = new player.Team(
			packet.team,
			packet.name,
			packet.friendlyFire,
			packet.nameTagVisibility,
			packet.collisionRule,
			packet.formatting,
			packet.prefix,
			packet.suffix,
		);

		if (Array.isArray(packet.players)) {
			for (const member of packet.players) {
				team.add(member);
				player.teamMap[member] = team;
			}
		}

		player.teams[teamName] = team;
	}

	if (team !== undefined) {
		if (mode === 1) {
			for (const member of team.members) {
				player.teamMap[member] = undefined;
			}

			player.teams[teamName] = undefined;
		}

		if (mode === 2) {
			team.update(
				packet.name,
				packet.friendlyFire,
				packet.nameTagVisibility,
				packet.collisionRule,
				packet.formatting,
				packet.prefix,
				packet.suffix,
			);
		}

		if (Array.isArray(packet.players)) {
			if (mode === 3) {
				for (const member of packet.players) {
					team.add(member);
					player.teamMap[member] = team;
				}
			}

			if (mode === 4) {
				for (const member of packet.players) {
					team.remove(member);
					player.teamMap[member] = undefined;
				}
			}
		}
	}
};

const handleTeam = (player: Player, packet: any, meta: any) => {
	if (meta.name === events.teams.scoreboard_team && player.Registry.supportFeature('teamUsesScoreboard'))
		teamHandler(player, packet);

	if (meta.name === events.teams.teams) {
		teamHandler(player, packet);
	}
};

export { handleTeam, events };
