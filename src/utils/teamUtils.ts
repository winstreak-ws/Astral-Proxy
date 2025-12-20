function getTeamName(teamName: string) {
	if (!teamName) return null;
	const spilt = teamName.match(/[A-Za-z]+/g);
	if (!spilt) return null;
	const color = spilt[0];

	return color.toLowerCase();
}

function getColorCode(color: string) {
	if (!color) return '§f';
	switch (color.toLowerCase()) {
		case 'black':
			return '§0';
		case 'dark_blue':
			return '§1';
		case 'dark_green':
			return '§2';
		case 'dark_aqua':
			return '§3';
		case 'dark_red':
			return '§4';
		case 'dark_purple':
			return '§5';
		case 'gold':
			return '§6';
		case 'gray':
			return '§7';
		case 'dark_gray':
			return '§8';
		case 'blue':
			return '§9';
		case 'green':
			return '§a';
		case 'aqua':
			return '§b';
		case 'red':
			return '§c';
		case 'light_purple':
			return '§d';
		case 'yellow':
			return '§e';
		case 'white':
			return '§f';
		default:
			return '§f';
	}
}

function getTeamPrefix(color: string) {
	switch (color.toLowerCase()) {
		case 'red':
			return 'R ';
		case 'blue':
			return 'B ';
		case 'green':
			return 'G ';
		case 'yellow':
			return 'Y ';
		case 'aqua':
			return 'A ';
		case 'white':
			return 'W ';
		case 'pink':
			return 'P ';
		case 'gray':
			return 'G ';
		default:
			return 'W ';
	}
}

function findTeam(teams, teamMap, username) {
	for (const teamName in teams) {
		if (Object.hasOwn(teams, teamName)) {
			const team = teams[teamName];
			if (team.membersMap.includes(username)) {
				return team;
			}
		}
	}

	return null;
}

export { getTeamName, getColorCode, getTeamPrefix, findTeam };
