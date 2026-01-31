const assignedChatUUIDs = new Map<string, { tablistUUID: string, displayName: string }>();
import type Mod from '../mod.js';
import { logger } from '../../utils/logger.js';
import { parseSkinData } from '../../utils/nickUtil.js';
import axios from 'axios';
import { hypixelRateLimiter } from '../../data/rateLimiter.js'
import { getPlayerPingInfo as dataGetPlayerPingInfo, getBlacklistTagMessages as dataGetBlacklistTagMessages, getBedwarsTabstats as dataGetBedwarsTabstats, getPlayerTags as dataGetPlayerTags } from '../../data/playerData.js'
import tagManager from '../../data/tagManager.js'
import discordRpc from '../../discord/discordRpc.js';
import { getConfig, APP_VERSION } from '../../config/config.js';
import fs from 'fs';
import { getConfigPath } from '../../utils/paths.js';
import wsClient from '../../data/websocketClient.js';
import { getUUIDVersion } from '../../utils/uuid.js';


let config = getConfig()

setInterval(async () => {
	config = getConfig();
}, 5000);

let ownUuid = '';
let ownTeamPrefixColor = '';

type QueuedTask = {
	priority: number;
	task(): Promise<void>;
};

let ownInterval: NodeJS.Timeout | undefined
let otherInterval: NodeJS.Timeout | undefined
let teamAnnounceTimeout: NodeJS.Timeout | null = null
let announcedThisGame = false
let denickerActivateTimeout: NodeJS.Timeout | null = null
let denickerActive = false

async function getNadeshikoStats(uuid: string) {
	try {
		const url = `https://nadeshiko.io/player/${uuid}/network`;
		const res = await axios.get(url, {
			headers: {
				'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
			},
			timeout: 10000
		});

		const html = res.data;

		const pattern = /playerData = JSON\.parse\(decodeURIComponent\("(.*?)"\)\)/;
		const match = html.match(pattern);

		if (!match || !match[1]) {
			throw new Error('Could not extract player data from Nadeshiko response');
		}

		const playerDataEncoded = match[1];
		const playerDataJson = decodeURIComponent(playerDataEncoded);
		const playerData = JSON.parse(playerDataJson);

		if (!playerData || !playerData.stats || !playerData.stats.Bedwars) {
			throw new Error('No BedWars stats found in Nadeshiko data');
		}

		// Nadeshiko returns rank data at top level, no need to copy from nested structure
		// The rank fields (rank, monthlyPackageRank, newPackageRank, packageRank, rankPlusColor, etc.)
		// should already be at the top level of playerData

		return playerData;
	} catch (error) {
		throw new Error('Error fetching stats from Nadeshiko: ' + (error as Error).message);
	}
}

async function getHypixelStats(uuid: string) {
	try {
		if (config.General.hypixelKey && String(config.General.hypixelKey).trim() !== '') {
			await hypixelRateLimiter.acquire(1)
		}
		const res = await axios.get(`https://api.hypixel.net/player`, {
			params: { key: config.General.hypixelKey, uuid },
		});

		if (config.General.hypixelKey && String(config.General.hypixelKey).trim() !== '') {
			hypixelRateLimiter.updateFromHeaders(res.headers)
		}

		//@ts-ignore
		const data = res.data
		if (!data.success || !data.player || !data.player.stats || !data.player.stats.Bedwars) {
			throw new Error('No BedWars stats found for this player.');
		}

		//@ts-ignore
		return data.player;
	} catch (error) {
		const headers = (error as any)?.response?.headers
		if (headers && config.General.hypixelKey && String(config.General.hypixelKey).trim() !== '') {
			hypixelRateLimiter.updateFromHeaders(headers)
		}
		throw new Error('Error fetching BedWars stats');
	}
}

function getStarColor(level: number): string {
	let colorFormatted = `§7[*✫]`;

	if (level < 10) {
		colorFormatted = `§7[*✫]§7`;
	} else if (level < 100) {
		colorFormatted = `§7[**✫]§7`;
	} else if (level >= 100 && level < 200) {
		colorFormatted = `§f[***✫]§7`;
	} else if (level >= 200 && level < 300) {
		colorFormatted = `§6[***✫]§7`;
	} else if (level >= 300 && level < 400) {
		colorFormatted = `§b[***✫]§7`;
	} else if (level >= 400 && level < 500) {
		colorFormatted = `§2[***✫]§7`;
	} else if (level >= 500 && level < 600) {
		colorFormatted = `§3[***✫]§7`;
	} else if (level >= 600 && level < 700) {
		colorFormatted = `§4[***✫]§7`;
	} else if (level >= 700 && level < 800) {
		colorFormatted = `§d[***✫]§7`;
	} else if (level >= 800 && level < 900) {
		colorFormatted = `§9[***✫]§7`;
	} else if (level >= 900 && level < 1000) {
		colorFormatted = `§5[***✫]§7`;
	} else if (level >= 1000 && level < 1100) {
		colorFormatted = `§c[§6*§e*§a*§b*§d✫§5]§7`;
	} else if (level >= 1100 && level < 1200) {
		colorFormatted = `§7[§f****§7✪]§7`;
	} else if (level >= 1200 && level < 1300) {
		colorFormatted = `§7[§e****§6✪§7]§7`;
	} else if (level >= 1300 && level < 1400) {
		colorFormatted = `§7[§b****§3✪§7]§7`;
	} else if (level >= 1400 && level < 1500) {
		colorFormatted = `§7[§a****§2✪§7]§7`;
	} else if (level >= 1500 && level < 1600) {
		colorFormatted = `§7[§3****§9✪§7]§7`;
	} else if (level >= 1600 && level < 1700) {
		colorFormatted = `§7[§c****§4✪§7]§7`;
	} else if (level >= 1700 && level < 1800) {
		colorFormatted = `§7[§d****§5✪§7]§7`;
	} else if (level >= 1800 && level < 1900) {
		colorFormatted = `§7[§9****§1✪§7]§7`;
	} else if (level >= 1900 && level < 2000) {
		colorFormatted = `§7[§5****§8✪§7]§7`;
	} else if (level >= 2000 && level < 2100) {
		colorFormatted = `§8[§7*§f**§7*✪§8]§7`;
	} else if (level >= 2100 && level < 2200) {
		colorFormatted = `§f[*§e**§6*❀]§7`;
	} else if (level >= 2200 && level < 2300) {
		colorFormatted = `§6[*§f**§b*§3❀]§7`;
	} else if (level >= 2300 && level < 2400) {
		colorFormatted = `§5[*§d**§6*§e❀]§7`;
	} else if (level >= 2400 && level < 2500) {
		colorFormatted = `§b[*§f**§7*§8❀]§7`;
	} else if (level >= 2500 && level < 2600) {
		colorFormatted = `§f[*§a**§2*❀]§7`;
	} else if (level >= 2600 && level < 2700) {
		colorFormatted = `§4[*§c**§d*❀]§7`;
	} else if (level >= 2700 && level < 2800) {
		colorFormatted = `§e[*§f**§8*❀]§7`;
	} else if (level >= 2800 && level < 2900) {
		colorFormatted = `§a[*§2**§6*❀§e]§7`;
	} else if (level >= 2900 && level < 3000) {
		colorFormatted = `§b[*§3**§9*❀§1]§7`;
	} else if (level >= 3000 && level < 3100) {
		colorFormatted = `§e[*§6**§c*❀§4]§7`;
	} else if (level >= 3100 && level < 3200) {
		colorFormatted = `§9[*§3**§6*✥§e]§7`;
	} else if (level >= 3200 && level < 3300) {
		colorFormatted = `§c[§4*§7**§4*§c✥]§7`;
	} else if (level >= 3300 && level < 3400) {
		colorFormatted = `§9[**§d*§c*✥§4]§7`;
	} else if (level >= 3400 && level < 3500) {
		colorFormatted = `§2[§a*§d**§5*✥§2]§7`;
	} else if (level >= 3500 && level < 3600) {
		colorFormatted = `§c[*§4**§2*§a✥]§7`;
	} else if (level >= 3600 && level < 3700) {
		colorFormatted = `§a[**§b*§9*✥§1]§7`;
	} else if (level >= 3700 && level < 3800) {
		colorFormatted = `§4[*§c**§b*§3✥]§7`;
	} else if (level >= 3800 && level < 3900) {
		colorFormatted = `§1[*§9*§5**§d✥§1]§7`;
	} else if (level >= 3900 && level < 4000) {
		colorFormatted = `§c[*§a**§3*§9✥]§7`;
	} else if (level >= 4000 && level < 4100) {
		colorFormatted = `§5[*§c**§6*✥§e]§7`;
	} else if (level >= 4100 && level < 4200) {
		colorFormatted = `§e[*§6*§c*§d*✥§5]§7`;
	} else if (level >= 4200 && level < 4300) {
		colorFormatted = `§1[§9*§3*§b*§f*§7✥]§7`;
	} else if (level >= 4300 && level < 4400) {
		colorFormatted = `§0[§5*§8**§5*✥§0]§7`;
	} else if (level >= 4400 && level < 4500) {
		colorFormatted = `§2[*§a*§e*§6*§5✥§d]§7`;
	} else if (level >= 4500 && level < 4600) {
		colorFormatted = `§f[*§b**§3*✥]§7`;
	} else if (level >= 4600 && level < 4700) {
		colorFormatted = `§3[§b*§e**§6*§d✥§5]§7`;
	} else if (level >= 4700 && level < 4800) {
		colorFormatted = `§f[§4*§c**§9*§1✥§9]§7`;
	} else if (level >= 4800 && level < 4900) {
		colorFormatted = `§5[*§c*§6*§e*§b✥§3]§7`;
	} else if (level >= 4900 && level < 5000) {
		colorFormatted = `§2[§a*§f**§a*✥§2]§7`;
	} else if (level >= 5000) {
		colorFormatted = `§4[*§5*§9**§1✥§0]§7`;
	}

	const levelStr = level.toString();
	let levelIndex = 0;
	colorFormatted = colorFormatted.replace(/\*/g, () => levelStr[levelIndex++] || '*');

	return colorFormatted;
}

function getRankColor(rank: string): string {
	switch (rank) {
		case 'VIP':
		case 'VIP+':
			return '§a';
		case 'MVP':
		case 'MVP+':
			return '§b';
		case 'MVP++':
			type DisplayStats = {
				level: number
				wins: number
				losses: number
				kills: number
				deaths: number
				finals: number
				beds: number
				fkdr: number
				wlr: number
				bblr: number
				winstreak: number | string
				rank: string
				rankPlusColor: string
			}

			return '§6';
		case 'ADMIN':
			return '§c';
		case 'None':
			return '§7';
		case 'NONE':
			return '§7';
		default:
			return '§7';
	}
}

function getPlusColor(color: string): string {
	const colorMap: Record<string, string> = {
		'GREEN': '§a',
		'AQUA': '§b',
		'GOLD': '§6',
		'RED': '§c',
		'BLUE': '§9',
		'WHITE': '§f',
		'GRAY': '§7',
		'DARK_GREEN': '§2',
		'DARK_AQUA': '§3',
		'DARK_RED': '§4',
		'DARK_BLUE': '§1',
		'BLACK': '§0',
		'DARK_GRAY': '§8',
		'LIGHT_PURPLE': '§d',
		'DARK_PURPLE': '§5',
		'YELLOW': '§e'
	};

	return colorMap[color] || '§7';
}

function formatRankWithPlusColor(rank: string, rankPlusColor: string): string {
	const colorCode = rank === 'VIP+' ? '§6' : getPlusColor(rankPlusColor);
	const rankColor = getRankColor(rank);

	if (rank === "None") return " ";

	let coloredRank = ` ${rankColor}[${rank}] `;

	if (coloredRank.includes('+')) {
		let plusIndex = coloredRank.indexOf('+');
		coloredRank = coloredRank.substring(0, plusIndex) + colorCode + coloredRank.substring(plusIndex);

		let lastPlusIndex = coloredRank.lastIndexOf('+');
		if (lastPlusIndex !== -1) {
			coloredRank = coloredRank.substring(0, lastPlusIndex + 1) + rankColor + coloredRank.substring(lastPlusIndex + 1);
		}
	}

	return coloredRank;
}
function resolveRankData(player: any): { rank: string, plusColor: string } {
	let rank: string = 'None';
	if (player?.rank && player.rank !== 'NORMAL') {
		rank = player.rank;
	} else if (player?.monthlyPackageRank && player.monthlyPackageRank !== 'NONE') {
		rank = player.monthlyPackageRank;
	} else if (player?.newPackageRank) {
		rank = player.newPackageRank;
	} else if (player?.packageRank) {
		rank = player.packageRank;
	} else if (player?.prefix) {
	}

	switch (rank) {
		case 'VIP_PLUS':
			rank = 'VIP+';
			break;
		case 'MVP_PLUS':
			rank = 'MVP+';
			break;
		case 'SUPERSTAR':
			rank = 'MVP++';
			break;
		case 'NONE':
			rank = 'None';
			break;
	}

	const plusColor: string = player?.rankPlusColor || 'RED';
	return { rank, plusColor };
}

function getWlrColor(wlr: number): string {
	if (wlr >= 30) return `§5${wlr.toFixed(2)}`;
	if (wlr >= 15) return `§d${wlr.toFixed(2)}`;
	if (wlr >= 9) return `§4${wlr.toFixed(2)}`;
	if (wlr >= 6) return `§c${wlr.toFixed(2)}`;
	if (wlr >= 3) return `§6${wlr.toFixed(2)}`;
	if (wlr >= 2.1) return `§e${wlr.toFixed(2)}`;
	if (wlr >= 1.5) return `§2${wlr.toFixed(2)}`;
	if (wlr >= 0.9) return `§a${wlr.toFixed(2)}`;
	if (wlr >= 0.3) return `§f${wlr.toFixed(2)}`;
	return `§7${wlr.toFixed(2)}`;
}

function getFkdrColor(fkdr: number): string {
	if (fkdr >= 100) return `§5${fkdr.toFixed(2)}`;
	if (fkdr >= 50) return `§d${fkdr.toFixed(2)}`;
	if (fkdr >= 30) return `§4${fkdr.toFixed(2)}`;
	if (fkdr >= 20) return `§c${fkdr.toFixed(2)}`;
	if (fkdr >= 10) return `§6${fkdr.toFixed(2)}`;
	if (fkdr >= 7) return `§e${fkdr.toFixed(2)}`;
	if (fkdr >= 5) return `§2${fkdr.toFixed(2)}`;
	if (fkdr >= 3) return `§a${fkdr.toFixed(2)}`;
	if (fkdr >= 1) return `§f${fkdr.toFixed(2)}`;
	return `§7${fkdr.toFixed(2)}`;
}

function getBblrColor(bblr: number): string {
	if (bblr >= 3) return `§5${bblr.toFixed(2)}`;
	if (bblr >= 2.5) return `§d${bblr.toFixed(2)}`;
	if (bblr >= 2) return `§4${bblr.toFixed(2)}`;
	if (bblr >= 1.5) return `§c${bblr.toFixed(2)}`;
	if (bblr >= 1.2) return `§6${bblr.toFixed(2)}`;
	if (bblr >= 1) return `§e${bblr.toFixed(2)}`;
	if (bblr >= 0.8) return `§2${bblr.toFixed(2)}`;
	if (bblr >= 0.5) return `§a${bblr.toFixed(2)}`;
	if (bblr >= 0.2) return `§f${bblr.toFixed(2)}`;
	return `§7${bblr.toFixed(2)}`;
}

function getWsColor(ws: number | string): string {
	if (ws === "?") return `§a?`;

	if (typeof ws === "number") {
		if (ws >= 100) return `§4${ws}`;
		if (ws >= 75) return `§c${ws}`;
		if (ws >= 50) return `§e${ws}`;
		if (ws >= 25) return `§a${ws}`;
		return `§7${ws}`;
	}
	return `§7${ws}`;
}

function getPingColor(avgPing: number): string {
	if (avgPing >= 300) return `§4${avgPing}`;
	if (avgPing >= 200) return `§c${avgPing}`;
	if (avgPing >= 150) return `§6${avgPing}`;
	if (avgPing >= 100) return `§e${avgPing}`;
	if (avgPing >= 80) return `§a${avgPing}`;
	return `§2${avgPing}`;
}

async function getUUID(playerName: string): Promise<{ id: string; name: string }> {
	try {
		const { data } = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${playerName}`);
		//@ts-ignore
		return { id: data.id, name: data.name };
	} catch (error) {
		throw new Error('Failed to fetch UUID');
	}
}

function stripMcCodes(s: string): string {
	return String(s).replace(/§[0-9a-fk-or]/gi, '')
}


async function getPingInfo(uuid: string): Promise<{ averagePing: number | null; lastPingFormatted: string | null }> {
	try {
		const data = await dataGetPlayerPingInfo(uuid)
		return { averagePing: data.averagePing, lastPingFormatted: data.lastPingFormatted }
	} catch (error) {
		return { averagePing: null, lastPingFormatted: null }
	}
}

function buildStatsFromFormat(format: string, opts: { averagePing: number | null; lastPingFormatted: string | null; ds: DisplayStats | null }) {
	if (!format) return '';
	const { averagePing, lastPingFormatted, ds } = opts;

	const replacements: Record<string, string> = {
		ping: (averagePing !== null ? getPingColor(averagePing) : '§7?') + '§7',
		gap: (lastPingFormatted ?? '?') + '§7',
		winstreak: (ds && (ds.winstreak !== undefined && ds.winstreak !== null) ? getWsColor(ds.winstreak) : (ds && ds.winstreak === '?' ? getWsColor('?') : '?')) + '§7',
		fkdr: (ds && (ds.fkdr !== undefined && ds.fkdr !== null) ? getFkdrColor(ds.fkdr) : '§7?') + '§7',
		wlr: (ds && (ds.wlr !== undefined && ds.wlr !== null) ? getWlrColor(ds.wlr) : '§7?') + '§7',
		finals: (ds && (ds.finals !== undefined && ds.finals !== null) ? ds.finals.toLocaleString() : '?') + '§7',
		wins: (ds && (ds.wins !== undefined && ds.wins !== null) ? ds.wins.toLocaleString() : '?') + '§7',
		kills: (ds && (ds.kills !== undefined && ds.kills !== null) ? ds.kills.toLocaleString() : '?') + '§7',
		kdr: (ds && (ds.kills !== undefined && ds.deaths !== undefined) ? (ds.kills / Math.max(1, ds.deaths)).toFixed(2) : '?') + '§7',
		beds: (ds && (ds.beds !== undefined && ds.beds !== null) ? ds.beds.toLocaleString() : '?') + '§7',
		bblr: (ds && (ds.bblr !== undefined && ds.bblr !== null) ? getBblrColor(ds.bblr) : '?') + '§7',
	};

	const replaced = String(format).replace(/%%([a-zA-Z]+)%%/g, (_, key) => {
		const k = key.toLowerCase();
		return replacements[k] ?? ('?' + '§7');
	});

	if (replaced.trim().length === 0) return '';
	return ' §7' + replaced;
}

function buildTeamSummaryTeamLine(format: string, ctx: {
	teamName: string | null
	teamColor: string | null
	label: string
	members: DisplayStats[]
}) {
	if (!format) return ''
	const { teamName, teamColor, label, members } = ctx
	const color = teamColor || '§7'
	const count = members.length

	const sum = (arr: number[]) => arr.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)
	const levels = members.map(m => m.level || 0)
	const finals = members.map(m => m.finals || 0)
	const wins = members.map(m => m.wins || 0)
	const losses = members.map(m => m.losses || 0)
	const kills = members.map(m => m.kills || 0)
	const deaths = members.map(m => m.deaths || 0)
	const beds = members.map(m => m.beds || 0)
	const bedsLost = members.map(m => m.bedsLost || 0)
	const fkdrs = members.map(m => (typeof m.fkdr === 'number' ? m.fkdr : 0))
	const wlrs = members.map(m => (typeof m.wlr === 'number' ? m.wlr : 0))
	const bblrs = members.map(m => (typeof m.bblr === 'number' ? m.bblr : 0))

	const levelTotal = sum(levels)
	const levelAvg = count ? levelTotal / count : 0
	const finalsTotal = sum(finals)
	const winsTotal = sum(wins)
	const lossesTotal = sum(losses)
	const killsTotal = sum(kills)
	const deathsTotal = sum(deaths)
	const bedsTotal = sum(beds)
	const bedsLostTotal = sum(bedsLost)
	const fkdrAvg = count ? sum(fkdrs) / count : 0
	const wlrAvg = count ? sum(wlrs) / count : 0
	const kdrAvg = deathsTotal > 0 ? (killsTotal / Math.max(1, deathsTotal)) : (count ? sum(kills.map((k, i) => k / Math.max(1, deaths[i]))) / count : 0)
	const bblrAvg = bedsLostTotal > 0 ? (bedsTotal / Math.max(1, bedsLostTotal)) : (count ? sum(bblrs) / count : 0)

	const replacements: Record<string, string> = {
		teamname: `${color}${teamName ?? '?'}§7`,
		name: `${color}${teamName ?? '?'}§7`,
		label: `${label}§7`,
		players: `${count}§7`,
		color: `${color}§7`,
		sep: ` ${color}| §7`,
		stars: `${getStarColor(Math.round(levelAvg))}§7`,
		stars_total: `${getStarColor(Math.round(levelTotal))}§7`,
		fkdr: `${getFkdrColor(fkdrAvg)}§7`,
		wlr: `${getWlrColor(wlrAvg)}§7`,
		kdr: `${kdrAvg.toFixed(2)}§7`,
		bblr: `${getBblrColor(bblrAvg)}§7`,
		finals_total: `${finalsTotal.toLocaleString()}§7`,
		wins_total: `${winsTotal.toLocaleString()}§7`,
		losses_total: `${lossesTotal.toLocaleString()}§7`,
		kills_total: `${killsTotal.toLocaleString()}§7`,
		deaths_total: `${deathsTotal.toLocaleString()}§7`,
		beds_total: `${bedsTotal.toLocaleString()}§7`,
		fkdr_avg: `${getFkdrColor(fkdrAvg)}§7`,
		wlr_avg: `${getWlrColor(wlrAvg)}§7`,
		kdr_avg: `${kdrAvg.toFixed(2)}§7`,
		bblr_avg: `${getBblrColor(bblrAvg)}§7`,
	}

	const result = format.replace(/%%([a-zA-Z_]+)%%/g, (_, key) => {
		const k = key.toLowerCase()
		return replacements[k] ?? ('?' + '§7')
	})
	return result
}

function buildTeamSummaryPlayerLine(format: string, ctx: {
	tags: string
	ds: DisplayStats | null
	teamColor: string | null
	username: string
	label?: string
	averagePing?: number | null
	lastPingFormatted?: string | null
}) {
	if (!format) return ''
	const { tags, ds, teamColor, username, label = '', averagePing = null, lastPingFormatted = null } = ctx
	const color = teamColor || '§7'

	const name = `${color}${username}§7`
	const star = ds ? getStarColor(ds.level) : '§7?'
	const fkdr = ds && typeof ds.fkdr === 'number' ? `${getFkdrColor(ds.fkdr)}§7` : '§7?'
	const wlr = ds && typeof ds.wlr === 'number' ? `${getWlrColor(ds.wlr)}§7` : '§7?'
	const finals = ds && typeof ds.finals === 'number' ? `${ds.finals.toLocaleString()}§7` : '§7?'
	const beds = ds && typeof ds.beds === 'number' ? `${ds.beds.toLocaleString()}§7` : '§7?'
	const bblr = ds && typeof ds.bblr === 'number' ? `${getBblrColor(ds.bblr)}§7` : '§7?'
	const kdr = ds && typeof ds.kills === 'number' && typeof ds.deaths === 'number' ? `${(ds.kills / Math.max(1, ds.deaths)).toFixed(2)}§7` : '§7?'
	const winstreak = ds && ds.winstreak != null ? `${getWsColor(ds.winstreak)}§7` : '§7?'
	const ping = averagePing != null ? `${getPingColor(averagePing)}§7` : '§7?'
	const gap = (lastPingFormatted ?? '?') + '§7'

	const replacements: Record<string, string> = {
		tags: tags,
		stars: star,
		name: name,
		label: (label || '') + '§7',
		team_label: (label || '') + '§7',
		fkdr: fkdr,
		wlr: wlr,
		finals: finals,
		beds: beds,
		bblr: bblr,
		kdr: kdr,
		winstreak: winstreak,
		ping: ping,
		gap: gap,
	}

	const result = format.replace(/%%([a-zA-Z_]+)%%/g, (_, key) => {
		const k = key.toLowerCase()
		return replacements[k] ?? ('?' + '§7')
	})
	return result
}

function buildTeamStatsFromFormat(
	format: string,
	opts: {
		label: string
		colorCode: string | null
		name: string | null
		members: DisplayStats[]
	}
) {
	if (!format) return ''
	const { label, colorCode, name, members } = opts
	const count = members.length

	const sum = (arr: number[]) => arr.reduce((a, b) => a + (Number.isFinite(b) ? b : 0), 0)
	const to2 = (n: number) => n.toFixed(2)
	const to1 = (n: number) => n.toFixed(1)

	const levels = members.map(m => m.level || 0)
	const finals = members.map(m => m.finals || 0)
	const wins = members.map(m => m.wins || 0)
	const losses = members.map(m => m.losses || 0)
	const kills = members.map(m => m.kills || 0)
	const deaths = members.map(m => m.deaths || 0)
	const beds = members.map(m => m.beds || 0)
	const bedsLost = members.map(m => m.bedsLost || 0)
	const fkdrs = members.map(m => (typeof m.fkdr === 'number' ? m.fkdr : 0))
	const wlrs = members.map(m => (typeof m.wlr === 'number' ? m.wlr : 0))
	const bblrs = members.map(m => (typeof m.bblr === 'number' ? m.bblr : 0))

	const levelTotal = sum(levels)
	const levelAvg = count ? levelTotal / count : 0
	const finalsTotal = sum(finals)
	const winsTotal = sum(wins)
	const lossesTotal = sum(losses)
	const killsTotal = sum(kills)
	const deathsTotal = sum(deaths)
	const bedsTotal = sum(beds)
	const bedsLostTotal = sum(bedsLost)
	const fkdrAvg = count ? sum(fkdrs) / count : 0
	const wlrAvg = count ? sum(wlrs) / count : 0
	const kdrAvg = deathsTotal > 0 ? (killsTotal / Math.max(1, deathsTotal)) : (count ? sum(kills.map((k, i) => k / Math.max(1, deaths[i]))) / count : 0)
	const bblrAvg = bedsLostTotal > 0 ? (bedsTotal / Math.max(1, bedsLostTotal)) : (count ? sum(bblrs) / count : 0)

	const teamColor = colorCode || '§7'
	const replacements: Record<string, string> = {
		team_label: `${label}§7`,
		team_name: `${name ?? '?'}§7`,
		team_players: `${count}§7`,
		team_color: `${teamColor}§7`,
		team_sep: ` ${teamColor}| §7`,

		team_level_total: `${levelTotal.toLocaleString()}§7`,
		team_finals_total: `${finalsTotal.toLocaleString()}§7`,
		team_wins_total: `${winsTotal.toLocaleString()}§7`,
		team_losses_total: `${lossesTotal.toLocaleString()}§7`,
		team_kills_total: `${killsTotal.toLocaleString()}§7`,
		team_deaths_total: `${deathsTotal.toLocaleString()}§7`,
		team_beds_total: `${bedsTotal.toLocaleString()}§7`,

		team_level_avg: `${to1(levelAvg)}§7`,
		team_fkdr_avg: `${getFkdrColor(fkdrAvg)}§7`,
		team_kdr_avg: `${to2(kdrAvg)}§7`,
		team_wlr_avg: `${getWlrColor(wlrAvg)}§7`,
		team_bblr_avg: `${getBblrColor(bblrAvg)}§7`,
	}

	const replaced = String(format).replace(/%%([a-zA-Z_]+)%%/g, (_, key) => {
		const k = key.toLowerCase()
		return replacements[k] ?? ('?' + '§7')
	})
	if (replaced.trim().length === 0) return ''
	return ' §7' + replaced
}


export default {
	name: 'Bedwars Tab Stats',
	description: 'Shows bedwars stats in the tab list',
	version: '1.2.0',
	init: (proxy) => {
		let username = proxy.server.username;
		const mcUserPath = getConfigPath('minecraft-user.json');
		try {
			fs.writeFileSync(mcUserPath, JSON.stringify({ username }), 'utf-8');
		} catch (err) {
			logger.error('Failed to write minecraft-user.json:', err);
		}
		const cachedResponses: Map<string, string> = new Map();
		let gameType: 'game' | 'queue' | 'lobby' | null = null;
		let AstralPrefixCache: Map<string, { prefix: string | null, identity: string | null, expires: number }> = new Map();
		const taskQueue: QueuedTask[] = [];
		let isProcessingQueue = false;
		const queueTask = (task: () => Promise<void>, priority: number = 0) => {
			taskQueue.push({ task, priority });
			taskQueue.sort((a, b) => b.priority - a.priority);
			if (!isProcessingQueue) {
				processQueue();
			}
		};
		const processQueue = async () => {
			isProcessingQueue = true;
			while (taskQueue.length > 0) {
				const { task } = taskQueue.shift()!;
				try {
					await task();
				} catch (error) {
					logger.error('Error processing task:', error);
				}
			}
			isProcessingQueue = false;
		};
		const updateGameType = () => {
			queueTask(async () => {
				proxy.removeListener('experience', onExperience);
				const startTime = Date.now();
				while (proxy.hypixel.server?.status === 'waiting') {
					if (Date.now() - startTime > 5000) {
						proxy.hypixel.server = { status: 'offline' };
						logger.error('Exiting due to timeout');
						return;
					}
					await new Promise(resolve => setTimeout(resolve, 100));
				}
				if (!proxy.hypixel.server ||
					proxy.hypixel.server.status !== 'in_game' ||
					proxy.hypixel.server.lobbyName ||
					!proxy.hypixel.server.map) {
					gameType = 'lobby';
				} else {
					gameType = 'queue';
					if (!proxy.listeners('experience').includes(onExperience)) {
						proxy.onceIncoming('experience', onExperience);
					}
				}
			}, 10);
		};
		const onExperience = (): boolean | undefined => {
			if (proxy.hypixel.server?.status === 'in_game') {
				lastDeathTime = 0;
				ownTeamPrefixColor = '';
				gameType = 'game';

				setTimeout(async () => {
					try {
						await announceTeamPrefixes();
					} catch { }
					announcedThisGame = true;
				}, 1);

				denickerActive = true;
			}
			return undefined;
		};
		const getPlayerString = async (uuid: string): Promise<string | null> => {
			return null;
		};

		function toTextComponentJsonString(input: string): string {
			try {
				const parsed = JSON.parse(input);
				if (parsed && typeof parsed === 'object' && (Object.prototype.hasOwnProperty.call(parsed, 'text') || Object.prototype.hasOwnProperty.call(parsed, 'extra'))) {
					return input;
				}
			} catch { }
			return JSON.stringify({ text: input });
		}

		let prefixCooldown = 0;

		async function announceTeamPrefixes() {
			if (Date.now() < prefixCooldown) return;
			prefixCooldown = Date.now() + 30000;
			try {
				if (!config?.bedwarsUtil?.enableTeamSummary) return;
				if (!proxy.teams || Object.keys(proxy.teams).length === 0) return;
				const teamMap = new Map<string, Array<{ username: string; uuid: string }>>();
				for (const player of Object.values(proxy.players || {})) {
					if (!player?.username || !player?.uuid) continue;
					const team = findPlayerTeam(player, proxy);
					if (!team) continue;
					//@ts-ignore
					const prefixText = jsonToMcText(team.teamData?.prefix);
					const colorCode = extractFirstColorCode(prefixText) || '§7';
					const teamName: string = (team.teamName || '').toString();
					let letter = teamName ? teamName.charAt(0).toUpperCase() : '';
					if (!letter) {
						const visible = stripMcCodes(prefixText).replace(/[^A-Za-z]/g, '').trim();
						letter = (visible[0] || '?').toUpperCase();
					}
					const label = `${colorCode}${letter}`;
					if (!teamMap.has(label)) teamMap.set(label, []);
					teamMap.get(label)!.push({ username: player.username, uuid: player.uuid });
				}

				try {
					const selfId = String(ownUuid || '').replace(/-/g, '').toLowerCase();
					if (selfId) {
						for (const [label, members] of Array.from(teamMap.entries())) {
							const hasSelf = members.some(m => String(m.uuid).replace(/-/g, '').toLowerCase() === selfId);
							if (hasSelf && members.length === 1) {
								teamMap.delete(label);
								break;
							}
						}
					}
				} catch { }

				if (teamMap.size === 0) return;
				const labels = Array.from(teamMap.keys()).sort((a, b) => stripMcCodes(a).localeCompare(stripMcCodes(b)));
				const teamLines: string[] = []
				const perTeamPlayers: Array<{ label: string; teamColor: string; players: Array<{ username: string; uuid: string; ds: DisplayStats | null; tagsDetailed: Array<{ text: string; description: string }>; ping: { averagePing: number | null; lastPingFormatted: string | null } }> }> = []

				for (const label of labels) {
					const players = teamMap.get(label)!.sort((a, b) => a.username.localeCompare(b.username));
					const enriched = await Promise.all(players.map(async (p) => {
						try {
							const [ds, tagRes, ping] = await Promise.all([
								getDisplayStats(p.uuid).catch(() => null),
								dataGetPlayerTags(p.uuid).catch(() => ({ tags: [], customtag: null, tagsDetailed: [] })),
								getPingInfo(p.uuid).catch(() => ({ averagePing: null, lastPingFormatted: null }))
							]);
							const tagsDetailed = ((tagRes?.tagsDetailed ?? []) as Array<{ text: string; description: string }>).
								filter(td => !/ms/i.test(stripMcCodes(td.text)));
							return { ...p, ds, tagsDetailed, ping };
						} catch {
							return { ...p, ds: null as DisplayStats | null, tagsDetailed: [] as Array<{ text: string; description: string }>, ping: { averagePing: null, lastPingFormatted: null } };
						}
					}));

					const withStats = enriched.filter(e => !!e.ds) as Array<{ username: string; uuid: string; ds: DisplayStats }>;
					const totalStars = withStats.reduce((acc, e) => acc + (e.ds.level || 0), 0);
					const totalFinals = withStats.reduce((acc, e) => acc + (e.ds.finals || 0), 0);
					const avgStars = withStats.length ? (totalStars / withStats.length) : 0;
					const avgFkdr = withStats.length ? (withStats.reduce((acc, e) => acc + (e.ds.fkdr || 0), 0) / withStats.length) : 0;
					const teamColor = extractFirstColorCode(label) || '§7';

					const teamFormat = config?.bedwarsUtil?.teamSummaryTeamFormat
						?? '%%teamName%% (%%stars%% | %%fkdr%% fkdr | %%wlr%% wlr)';
					const line1 = buildTeamSummaryTeamLine(teamFormat, {
						teamName: getTeamNameFromColorCode(teamColor),
						teamColor,
						label,
						members: withStats.map(w => w.ds)
					});
					teamLines.push(line1)
					perTeamPlayers.push({ label, teamColor, players: enriched })
				}

				for (const line of teamLines) {
					try { proxy.client.write('chat', { message: JSON.stringify({ text: line }) }); } catch { }
				}

				const playerFormat = config?.bedwarsUtil?.teamSummaryPlayerFormat
					?? '%%tags%% %%stars%% %%label%% %%name%%: %%fkdr%% fkdr | %%wlr%% wlr';
				for (const entry of perTeamPlayers) {
					const { label, teamColor, players } = entry
					for (const e of players) {
						if (!e.tagsDetailed || e.tagsDetailed.length === 0) continue;

						if (playerFormat.includes('%%tags%%')) {
							const parts = playerFormat.split('%%tags%%')
							const leftFmt = parts[0] ?? ''
							const rightFmt = parts.slice(1).join('%%tags%%')
							const leftText = buildTeamSummaryPlayerLine(leftFmt, {
								tags: '',
								ds: e.ds,
								teamColor,
								username: e.username,
								label,
								averagePing: e.ping?.averagePing ?? null,
								lastPingFormatted: e.ping?.lastPingFormatted ?? null
							})
							const rightText = buildTeamSummaryPlayerLine(rightFmt, {
								tags: '',
								ds: e.ds,
								teamColor,
								username: e.username,
								label,
								averagePing: e.ping?.averagePing ?? null,
								lastPingFormatted: e.ping?.lastPingFormatted ?? null
							})

							const extra: any[] = []
							if (leftText) extra.push({ text: leftText })
							extra.push({ text: '§7[' })
							for (let i = 0; i < e.tagsDetailed.length; i++) {
								const t = e.tagsDetailed[i]
								extra.push({
									text: t.text,
									hoverEvent: { action: 'show_text', value: { text: t.description || '...' } }
								})
								if (i < e.tagsDetailed.length - 1) {
									extra.push({ text: '§7, ' })
								}
							}
							extra.push({ text: '§7] ' })
							if (rightText) extra.push({ text: rightText })

							try { proxy.client.write('chat', { message: JSON.stringify({ text: '', extra }) }); } catch { }
						} else {
							const tagsText = `§7[${e.tagsDetailed.map(t => t.text).join('§7, ')}§7] `
							const line = buildTeamSummaryPlayerLine(playerFormat, {
								tags: tagsText,
								ds: e.ds,
								teamColor,
								username: e.username,
								label,
								averagePing: e.ping?.averagePing ?? null,
								lastPingFormatted: e.ping?.lastPingFormatted ?? null
							})
							try { proxy.client.write('chat', { message: JSON.stringify({ text: line }) }); } catch { }
						}
					}
				}
			} catch { }
		}

		async function getTagMessages(uuid: string): Promise<{ tagMsg: string, customTagMsg: string }> {
			return await dataGetBlacklistTagMessages(uuid)
		}

		const updatePlayerInfo = (client, players, type) => {
			queueTask(async () => {
				while (gameType === null) {
					await new Promise(resolve => setTimeout(resolve, 100));
				}
				if (gameType !== type) return;
				const editedData = await Promise.all(players.map(async (player) => {
					const playerString = await getPlayerString(player.UUID);
					if (!playerString) return player;
					const team = findPlayerTeam(player, proxy);
					//@ts-ignore
					const prefix = (type === 'queue') ? '' : (team ? jsonToMcText(team.teamData.prefix) : '');
					return {
						UUID: player.UUID,
						name: player.name,
						hasDisplayName: true,
						displayName: `{"text":"${prefix ? prefix + ' ' : ''}${playerString || player.name}"}`
					};
				}));
				if (editedData.length > 0 && proxy.hypixel.server.status === 'in_game') {
					for (const data of editedData) {
						try {
							JSON.parse(data.displayName as string);
						} catch (e) {
							logger.error('Invalid JSON in displayName 1:', data.displayName);
							return;
						}
					}
					client.write('player_info', { action: 3, data: editedData });
				}
			});
			return false;
		};
		let joinTime: number | null = null;
		let gameJoinTime: number | null = null;

		function getJoinTime(): number {
			if (joinTime === null) {
				joinTime = Date.now();
			}
			return joinTime;
		}

		function getGameJoinTime(): number {
			if (gameJoinTime === null) {
				gameJoinTime = Date.now();
			}
			return gameJoinTime;
		}

		let queueStartTime: number | null = null;

		function getQueueTime(): number {
			if (gameType === "queue") {
				if (queueStartTime === null) queueStartTime = Date.now();
				return Date.now() - queueStartTime;
			} else {
				queueStartTime = null;
				return 0;
			}
		}

		let gameStartTime: number | null = null;

		function getInGameTime(currentGameType: "game" | "queue" | "lobby"): number {
			if (currentGameType === "game") {
				if (gameStartTime === null) gameStartTime = Date.now();
				return Date.now() - gameStartTime;
			} else {
				return gameStartTime ? Date.now() - gameStartTime : 0;
			}
		}

		function formatElapsedTime(ms: number): string {
			const seconds = Math.floor((ms / 1000) % 60);
			const minutes = Math.floor((ms / (1000 * 60)) % 60);
			const hours = Math.floor(ms / (1000 * 60 * 60));
			return `${hours}h ${minutes}m ${seconds}s`;
		}
		function getAllPlayerUUIDsMap(): Record<string, string> {
			const uuidMap: Record<string, string> = {};
			for (const username in proxy.players) {
				uuidMap[username] = proxy.players[username].uuid;
			}
			return uuidMap;
		}

		const playerPropertiesCache = new Map<string, { name: string; value: string }[]>();

		proxy.onIncoming('player_info', (_meta, _buffer, packet) => {
			// Find own nick.
			try {
				const ownId = String(ownUuid || '').replace(/-/g, '').toLowerCase();
				const concernsSelf =
					ownId.length > 0 &&
					Array.isArray(packet?.data) &&
					packet.data.some(p => String(p?.UUID || '').replace(/-/g, '').toLowerCase() === ownId);

				if (concernsSelf && packet?.action === 0) {
					try {
						const selfEntry = packet.data.find(p => String(p?.UUID || '').replace(/-/g, '').toLowerCase() === ownId);
						if (selfEntry && typeof selfEntry.name === 'string') {
							logger.info(`Self name: ${selfEntry.name}`);
							proxy.server.username = selfEntry.name;
							username = selfEntry.name;

							const team = findPlayerTeam({ originalUsername: username, username: username, displayName: username }, proxy);
							logger.debug('Found own team for prefix color check:', team);


							//@ts-ignore
							logger.debug(team?.teamData.prefix.color);
							//@ts-ignore
							if (!['gray', undefined].includes(team?.teamData.prefix.color)) ownTeamPrefixColor = team?.teamData.prefix.color;
						}
					} catch { /* ignore */ }
				}
			} catch { /* ignore */ }

			switch (packet.action) {
				case 0:
					for (const player of packet.data) {
						if (!player.UUID || !player.name) continue;
						if (player.properties) {
							playerPropertiesCache.set(player.UUID, player.properties);
						}
					}
					break;

				case 4:
					for (const player of packet.data) {
						if (!player.UUID) continue;
						playerPropertiesCache.delete(player.UUID);
					}
					break;
			}

			return undefined;
		});

		proxy.onIncoming('playerlist_header', () => true);

		function isLikelyBot(name): boolean {
			return (
				/^[a-z0-9]{10}$/.test(name)
			);
		}

		const bordicWinstreakCache = new Map<string, { winstreak: number | null, lastChecked: number }>();

		const teamNames = new Set<string>();
		let lastDeathTime = 0;

		type BordicWinstreakResponse =
			| {
				success: true;
				data: {
					uuid: string;
					winstreak: number;
					confirmed?: number;
				};
			}
			| {
				success: false;
				data: string;
			};

		proxy.onIncoming('chat', function () {
			const receivedMessage = arguments[2];
			if (receivedMessage.position === 2) return;
			if (receivedMessage && typeof receivedMessage.message === 'string') {
				(async () => {
					try {
						const msgObj = JSON.parse(receivedMessage.message);

						let text = '';
						if (typeof msgObj.text === 'string') {
							text = msgObj.text;
						}
						if (msgObj.extra && Array.isArray(msgObj.extra)) {
							text += msgObj.extra.map(e => e.text || '').join('');
						}

						if (msgObj && msgObj.extra && msgObj.extra.length > 0 && gameType === 'game') {
							const fields = msgObj.extra;
							if (!fields[fields.length - 1].text.includes('FINAL KILL')) {
								const playerName = fields[0].text.replace(' ', '');
								if (playerName !== proxy.server.username && fields[1] && fields[1].color === 'gray' && !fields[1].text.includes('disconnected')) {
									//@ts-ignore
									if (ownTeamPrefixColor && fields[0].color === ownTeamPrefixColor) {
										logger.debug('Same team death detected for', playerName);
										lastDeathTime = Date.now();
									}
								}

							}

							if (fields.length === 1 && fields[0].text === "You have respawned!" && fields[0].color === 'yellow') {
								if (Date.now() - lastDeathTime < 5000) {
									setTimeout(() => {
										proxy.client.write('title', {
											action: 0,
											text: '§cSplit!',
										});
										proxy.client.write('title', {
											action: 2,
											stay: 50,
										});
									}, 10);
								}
							}
						}

						let username = null;
						if (msgObj.extra && Array.isArray(msgObj.extra) && msgObj.extra.length >= 3) {
							const match = msgObj.extra[2].text.match(/\] ([^:]+)/);
							if (match) {
								username = match[1];
							} else {
								username = msgObj.extra[0].text;
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
						if (!username && msgObj.clickEvent && typeof msgObj.clickEvent.value === 'string') {
							const ceMatch = msgObj.clickEvent.value.match(/\s([\w_]+)$/);
							if (ceMatch) {
								username = ceMatch[1];
							}
						}
						if (!username && msgObj.hoverEvent && msgObj.hoverEvent.value && typeof msgObj.hoverEvent.value.text === 'string') {
							const heMatch = msgObj.hoverEvent.value.text.match(/for §7([\w_]+)/);
							if (heMatch) {
								username = heMatch[1];
							}
						}
						if (!username && msgObj.extra && Array.isArray(msgObj.extra) && msgObj.extra.length > 0) {
							const t = msgObj.extra[0].text;
							if (typeof t === 'string' && t.match(/^[\w_]+$/)) {
								//@ts-ignore
								username = t;
							}
						}
						let isPlayerMessage = false
						if (username && username !== proxy.server.username) {
							try {
								const uuidData = await getUUID(username);
								if (uuidData.id) {
									isPlayerMessage = true
								}
							} catch (err) {
							}
						}
					} catch (err) {
					}
				})();
			}
			if (proxy.hypixel.server.serverType !== 'BEDWARS') { return }
			if (gameType === 'queue') {
				const chatPacket = arguments[2];
				if (receivedMessage.position === 2) return;
				if (chatPacket && typeof chatPacket.message === 'string') {
					(async () => {
						try {
							const msgObj = JSON.parse(chatPacket.message);
							let username = null;
							if (msgObj.extra && Array.isArray(msgObj.extra) && msgObj.extra.length >= 3) {
								const match = msgObj.extra[2].text.match(/\] ([^:]+)/);
								if (match) {
									username = match[1];
								} else {
									username = msgObj.extra[0].text;
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
							if (!username && msgObj.clickEvent && typeof msgObj.clickEvent.value === 'string') {
								const ceMatch = msgObj.clickEvent.value.match(/\s([\w_]+)$/);
								if (ceMatch) {
									username = ceMatch[1];
								}
							}
							if (!username && msgObj.hoverEvent && msgObj.hoverEvent.value && typeof msgObj.hoverEvent.value.text === 'string') {
								const heMatch = msgObj.hoverEvent.value.text.match(/for §7([\w_]+)/);
								if (heMatch) {
									username = heMatch[1];
								}
							}
							if (!username && msgObj.extra && Array.isArray(msgObj.extra) && msgObj.extra.length > 0) {
								const t = msgObj.extra[0].text;
								if (typeof t === 'string' && t.match(/^[\w_]+$/)) {
									//@ts-ignore
									username = t as string;
								}
							}

							if (username && username !== proxy.server.username) {
								const cleanText = (msgObj.text || msgObj.extra?.map(e => e.text || '').join('') || '')
									.replace(/§./g, '');

								const fakePlayerPattern = /^([\w_]+):\s+([\w_]+):/;
								if (fakePlayerPattern.test(cleanText)) {
									return;
								}

								const lowerClean = cleanText.toLowerCase();
								if (lowerClean.startsWith(`from`) ||
									lowerClean.startsWith(`to`)) {
									return;
								}
								try {

									const uuidData = await getUUID(username);
									const realUuid = uuidData.id;
									if (assignedChatUUIDs.has(realUuid)) {
										return;
									}
									const ds = await getDisplayStats(realUuid);
									if (ds) {
										assignedChatUUIDs.set(realUuid, {
											tablistUUID: realUuid,
											displayName: username
										});
										const playerFormat = config?.bedwarsUtil?.teamSummaryPlayerFormat || '%%tags%% %%name%% %%stars%% %%fkdr%% %%wlr%% %%finals%%';

										let tagsDetailed: Array<{ text: string; description: string }> = [];
										try {
											const tagRes = await dataGetPlayerTags(realUuid);
											tagsDetailed = ((tagRes?.tagsDetailed ?? []) as Array<{ text: string; description: string }>).
												filter((t) => t.text && t.text.trim().length > 0);
										} catch (err) {
										}

										const extra: any[] = [];

										extra.push({ text: ' §7[' });

										for (let i = 0; i < tagsDetailed.length; i++) {
											const t = tagsDetailed[i];
											extra.push({
												text: t.text,
												hoverEvent: { action: 'show_text', value: { text: t.description || '...' } }
											});
											if (i < tagsDetailed.length - 1) {
												extra.push({ text: '§7, ' });
											}
										}

										extra.push({ text: '§7] ' });

										const statsLine = buildTeamSummaryPlayerLine(playerFormat, {
											tags: '',
											ds: ds,
											teamColor: null,
											username: username,
											label: '',
											averagePing: null,
											lastPingFormatted: null
										});

										if (statsLine && statsLine.trim().length > 0) {
											extra.push({ text: statsLine });
										}

										if (extra.length > 0) {
											try {
												proxy.client.write('chat', {
													message: JSON.stringify({
														text: '§7[§5Astral§7]',
														extra: extra
													})
												});
											} catch (err) {
											}
										}
									}
								} catch (err) {
								}
							}
						} catch (e) {
							logger.error('Failed to parse chat message JSON:', chatPacket.message);
						}
					})();
				}
			}
			return undefined;
		});

		const nickCache = new Map<string, number>();
		const NICK_CACHE_TTL = 60 * 60 * 1000;
		const nickDisplayNames = new Map();
		const resolvedNicks = new Map();

		proxy.onIncoming('login', () => {
			(async () => {
				try {
					try {
						clearInterval(ownInterval);
					}
					catch {
					}
					try {
						clearInterval(otherInterval);
					} catch {
					}
					announcedThisGame = false;
					if (teamAnnounceTimeout) { clearTimeout(teamAnnounceTimeout); teamAnnounceTimeout = null; }
					gameType = 'lobby'
					gameStartTime = null;
					let playerData = await getUUID(username);
					const { id: uuid, name: correctName } = playerData;
					ownUuid = uuid;
					gameJoinTime = Date.now();

					let seenUUIDs: Set<string> = new Set();
					let seenNicks: Set<string> = new Set();
					let playerStatsCache: Map<string, any> = new Map();
					let tagCache: Map<string, { tagMsg: string, customTagMsg: string }> = new Map();
					let playerTagsCache: Map<string, { tags: string[]; customtag: string | null }> = new Map();
					const lobbyPrefixed: Set<string> = new Set();
					const onTagsChanged = async (changedUuid: string) => {
						try {
							if (gameType === 'lobby') {
								const isSelf = String(changedUuid).replace(/-/g, '').toLowerCase() === String(uuid).replace(/-/g, '').toLowerCase()
								const allowSelfHere = !!(config.tabStatsSettings?.showSelf && config.tabStatsSettings?.showSelfInLobby)
								if (!isSelf || !allowSelfHere) return
								return
							}
							const playerEntry = Object.values(proxy.players || {}).find(p => String(p.uuid).replace(/-/g, '').toLowerCase() === String(changedUuid).replace(/-/g, '').toLowerCase())
							if (!playerEntry) return
							const res = await dataGetPlayerTags(playerEntry.uuid)
							playerTagsCache.set(playerEntry.uuid, { tags: res?.tags ?? [], customtag: res?.customtag ?? null })
							const filtered = (res?.tags ?? []).filter(t => !/ms/i.test(stripMcCodes(t)))
							let toggledTags = filtered.length ? `§7[${filtered.join('§7, ')}§7] ` : ''
							let customTagAlways = res?.customtag ? `§7[${res.customtag}§7] ` : ''
							if (!config.tabStatsSettings?.tags) { toggledTags = ''; customTagAlways = '' }

							const dsCached = displayStatsCache.get(playerEntry.uuid)?.value ?? null
							const pingCached = pingCache.get(playerEntry.uuid) ?? { averagePing: null, lastPingFormatted: null }
							let teamPrefixForPlayer = ''
							try {
								if (gameType !== 'queue') {
									teamPrefixForPlayer = teamCache.get(playerEntry.uuid) ?? ''
									if (!teamPrefixForPlayer) {
										const team = findPlayerTeam(playerEntry, proxy);
										//@ts-ignore
										const prefix = team ? jsonToMcText(team.teamData.prefix) : '';
										if (teamPrefixForPlayer) teamCache.set(playerEntry.uuid, prefix);
									}
								}
							} catch { }

							let teamColorCode = ''
							if (gameType === 'game' && config.tabStatsSettings.useTeamColorUsernames) {
								const team = findPlayerTeam(playerEntry, proxy);
								//@ts-ignore
								const prefix = team ? jsonToMcText(team.teamData.prefix) : '';
								const teamColor = extractFirstColorCode(prefix);
								teamColorCode = teamColor ? teamColor : ''
							} else if (dsCached) {
								teamColorCode = getRankColor(dsCached.rank)
							}

							const includeRank = gameType === 'queue' ? true : !(config.tabStatsSettings?.useTeamColorUsernames && proxy.hypixel.server?.status === 'in_game')
							const maybePrefix = gameType === 'queue' ? '' : teamPrefixForPlayer
							let rColor = ''
							let text: string
							if (dsCached) {
								if (dsCached.rank == 'None' || !dsCached.rank || dsCached.rank == 'NONE') rColor = '§7'
								const formattedStar = getStarColor(dsCached.level)
								const formattedRank = includeRank && dsCached.rank ? formatRankWithPlusColor(dsCached.rank, dsCached.rankPlusColor) : ' '
								const defaultFormat = '- %%ping%% ms - %%gap%% - %%winstreak%% ws - %%fkdr%% fkdr - %%wlr%% wlr'
								const rawFormat = config.tabStatsSettings?.format
								const formatStr = (rawFormat === '' || rawFormat == null) ? defaultFormat : rawFormat
								const statsStr = buildStatsFromFormat(formatStr, { averagePing: pingCached.averagePing, lastPingFormatted: pingCached.lastPingFormatted, ds: dsCached })
								text = `${maybePrefix}${toggledTags}${customTagAlways}${formattedStar}${formattedRank}${rColor}${teamColorCode}${playerEntry.username}${statsStr}`
								text = await applyAstralPrefix(text, playerEntry.uuid)
							} else {
								text = `${maybePrefix}${toggledTags}${customTagAlways}${teamColorCode}${playerEntry.username}`
								text = await applyAstralPrefix(text, playerEntry.uuid)
							}

							try {
								JSON.parse(JSON.stringify({ text }));
							} catch (e) {
								logger.error('Invalid JSON in displayName 2:', text);
								return;
							}

							proxy.client.write('player_info', {
								action: 3,
								data: [{ UUID: playerEntry.uuid, name: playerEntry.username, hasDisplayName: true, displayName: JSON.stringify({ text }) }],
							})
						} catch { }
					}
					tagManager.on('tagsChanged', onTagsChanged)
					let teamCache: Map<string, string> = new Map();
					let lobbyPrefixSuffixCache: Map<string, { prefix: string; suffix: string }> = new Map();
					let pingCache: Map<string, { averagePing: number | null, lastPingFormatted: string | null }> = new Map();
					teamCache.clear();
					otherInterval = setInterval(async () => {
						try {
							if (proxy.hypixel.server.map) {
								if (gameType === 'game') {
									if (!announcedThisGame) {
										try { await announceTeamPrefixes(); } catch { }
										announcedThisGame = true;
										teamAnnounceTimeout = null;
									}
								} else {
									announcedThisGame = false;
									if (teamAnnounceTimeout) { clearTimeout(teamAnnounceTimeout); teamAnnounceTimeout = null; }
									denickerActive = false;
									if (denickerActivateTimeout) { clearTimeout(denickerActivateTimeout); denickerActivateTimeout = null; }
								}
								if (gameType !== 'game' && gameType !== 'queue') { return }
								const playerUUIDs = getAllPlayerUUIDsMap();
								const newUUIDs = Object.values(playerUUIDs).filter(uuid => !seenUUIDs.has(uuid));

								for (const [chatUuid, { tablistUUID, displayName }] of assignedChatUUIDs.entries()) {
									if (!Object.values(playerUUIDs).includes(tablistUUID)) {
										const availablePlayers = Object.values(proxy.players || {}).filter(p => {
											return !Array.from(assignedChatUUIDs.values()).some(v => v.tablistUUID === p.uuid);
										});
										if (availablePlayers.length > 0) {
											const randomIdx = Math.floor(Math.random() * availablePlayers.length);
											const newPlayer = availablePlayers[randomIdx];
											proxy.client.write('player_info', {
												action: 3,
												data: [
													{
														UUID: newPlayer.uuid,
														name: newPlayer.username,
														hasDisplayName: true,
														displayName: toTextComponentJsonString(displayName)
													}
												]
											});
											assignedChatUUIDs.set(chatUuid, { tablistUUID: newPlayer.uuid, displayName });
										} else {
											assignedChatUUIDs.delete(chatUuid);
										}
									}
								}

								if (newUUIDs.length > 0) {
									newUUIDs.forEach(uuid => {
										if (getUUIDVersion(uuid) === 4) {
											seenUUIDs.add(uuid);
										} else {
										}
									});
								}

								const leftUUIDs = Array.from(seenUUIDs).filter(uuid => !Object.values(playerUUIDs).includes(uuid));
								if (leftUUIDs.length > 0) {
									leftUUIDs.forEach(uuid => {
										seenUUIDs.delete(uuid);
									});
								}



								Object.values(proxy.players).forEach(async (player) => {
									if (!player.uuid || !player.username) return;
									if (player.uuid.replace(/-/g, '') === uuid.replace(/-/g, '')) return;

									if (getUUIDVersion(player.uuid) === 1) {
										if (!denickerActive) return;
										setInterval(async () => {
											const cachedDisplay = nickDisplayNames.get(player.uuid);
											const prefix = gameType === 'queue' ? '' : (teamCache.get(player.uuid) ?? '');
											if (cachedDisplay) {
												const realPart = cachedDisplay.realName
													? `§c(${cachedDisplay.realName})`
													: '§c§l[NICK]§r§c';

												const displayName = `${prefix}${realPart} ${cachedDisplay.nickName}`;

												try {
													JSON.parse(JSON.stringify({ text: displayName }));
												} catch (e) {
													logger.error('Invalid JSON in displayName 3:', displayName);
													return;
												}
												proxy.client.write('player_info', {
													action: 3,
													data: [
														{
															UUID: player.uuid,
															name: player.username,
															hasDisplayName: true,
															displayName: JSON.stringify({ text: displayName })
														}
													]
												});
												return;
											}
										}, 1000)
										setTimeout(async () => {
											try {
												const now = Date.now();
												const lastSeen = nickCache.get(player.uuid);

												const teamPrefixString = teamCache.has(player.uuid)
													? teamCache.get(player.uuid)!
													: await (async () => {
														const team = findPlayerTeam(player, proxy);
														//@ts-ignore
														const prefix = team ? jsonToMcText(team.teamData.prefix) : '';
														teamCache.set(player.uuid, prefix);
														return prefix;
													})();

												if (teamPrefixString === null || teamPrefixString === "§f§l§r§f") { return }



												if (!lastSeen || now - lastSeen >= NICK_CACHE_TTL) {
													nickCache.set(player.uuid, now);

													const properties = playerPropertiesCache.get(player.uuid);

													parseSkinData(
														{
															uuid: player.uuid,
															name: player.username,
															properties: properties
														},
														{ prefix: teamPrefixString, suffix: '' },
														{
															nickDisplayNames,
															resolvedNicks,
															showUnresolved: true,
															modifyDisplayNames: true,
															alert: (nickName, realName, formatted) => {
																const message = realName
																	? `§7[§5Astral§7] §c${realName} §dis nicked as ${formatted}.`
																	: `§7[§5Astral§7] ${formatted} §dis nicked.`;

																proxy.client.write('chat', {
																	message: JSON.stringify({
																		text: `${message}`
																	})
																});
															},
															addNickSuffix: (uuid, suffix) => {
																const maybePrefix = gameType === 'queue' ? '' : teamPrefixString;
																const displayName = `${maybePrefix}${suffix} ${player.username}`;

																try {
																	JSON.parse(JSON.stringify({ text: displayName }));
																} catch (e) {
																	logger.error('Invalid JSON in displayName 4:', displayName);
																	return;
																}

																proxy.client.write('player_info', {
																	action: 3,
																	data: [
																		{
																			UUID: player.uuid,
																			name: player.username,
																			hasDisplayName: true,
																			displayName: JSON.stringify({ text: displayName })
																		}
																	]
																});
															}
														}
													);
												}
											} catch (err) {
											}
										}, 1000);
										return;
									}

									if (getUUIDVersion(player.uuid) !== 4) {
										return;
									}

									if (player.uuid == uuid) { return }
									let averagePing: number | null = null;
									let lastPingFormatted: string | null = null;
									let ds: DisplayStats | null = null as any;
									let toggledTags = '';
									let customTagAlways = '';
									let teamPrefixForPlayer = '';
									let teamColorCode = '';
									let rColor = '';

									const includeRank = gameType === 'queue' ? true : !(config.tabStatsSettings?.useTeamColorUsernames && proxy.hypixel.server?.status === 'in_game');

									const sendUpdate = async () => {
										const gap = lastPingFormatted !== null ? lastPingFormatted : null;
										const defaultFormat = '- %%ping%% ms - %%gap%% - %%winstreak%% ws - %%fkdr%% fkdr - %%wlr%% wlr';
										const rawFormat = config.tabStatsSettings?.format;
										let formatStr = (rawFormat === '' || rawFormat == null) ? defaultFormat : rawFormat;
										let statsStr = buildStatsFromFormat(formatStr, { averagePing, lastPingFormatted: gap, ds });
										if (gameType === 'lobby') statsStr = '';

										const maybePrefix = gameType === 'queue' ? '' : teamPrefixForPlayer;
										let nameColor = teamColorCode;
										if (!nameColor && ds && (gameType !== 'game' || !config.tabStatsSettings.useTeamColorUsernames)) {
											nameColor = getRankColor(ds.rank);
										}
										let text: string;
										if (ds) {
											if (ds.rank == 'None' || !ds.rank || ds.rank == 'NONE') rColor = '§7'; else rColor = '';
											const formattedStar = getStarColor(ds.level);
											const formattedRank = includeRank && ds.rank ? formatRankWithPlusColor(ds.rank, ds.rankPlusColor) : ' ';
											text = `${maybePrefix}${toggledTags}${customTagAlways}${formattedStar}${formattedRank}${rColor}${nameColor}${player.username}${statsStr}`;
										} else {
											text = `${maybePrefix}${toggledTags}${customTagAlways}${nameColor}${player.username}${statsStr}`;
										}
										text = await applyAstralPrefix(text, player.uuid);

										try {
											JSON.parse(JSON.stringify({ text }));
										} catch (e) {
											logger.error('Invalid JSON in displayName 5:', text);
											return;
										}

										proxy.client.write('player_info', {
											action: 3,
											data: [{ UUID: player.uuid, name: player.username, hasDisplayName: true, displayName: JSON.stringify({ text }) }],
										});
									};

									if (gameType !== 'lobby') {
										const dsP = getDisplayStats(player.uuid).then(v => { ds = v; sendUpdate(); }).catch(() => { });
										const pingP = (async () => {
											if (pingCache.has(player.uuid)) {
												const cached = pingCache.get(player.uuid)!;
												averagePing = cached.averagePing; lastPingFormatted = cached.lastPingFormatted;
											} else {
												try {
													const info = await getPingInfo(player.uuid);
													pingCache.set(player.uuid, info);
													averagePing = info.averagePing; lastPingFormatted = info.lastPingFormatted;
												} catch { }
											}
											sendUpdate();
										})();
										const tagsP = (async () => {
											try {
												let res = playerTagsCache.get(player.uuid);
												if (!res) {
													res = await dataGetPlayerTags(player.uuid);
													playerTagsCache.set(player.uuid, { tags: res?.tags ?? [], customtag: res?.customtag ?? null });
												}
												const filtered = (res?.tags ?? []).filter(t => !/ms/i.test(stripMcCodes(t)));
												let tt = filtered.length ? `§7[${filtered.join('§7, ')}§7] ` : ''
												let ca = res?.customtag ? `§7[${res.customtag}§7] ` : ''
												if (!config.tabStatsSettings?.tags) { tt = ''; ca = '' }
												toggledTags = tt
												customTagAlways = ca
												tagCache.set(player.uuid, { tagMsg: toggledTags, customTagMsg: '' });
											} catch { toggledTags = ''; customTagAlways = ''; }
											sendUpdate();
										})();
										const teamP = (async () => {
											try {
												if (gameType !== 'queue') {
													if (teamCache.has(player.uuid)) {
														teamPrefixForPlayer = teamCache.get(player.uuid)!;
													} else {
														for (let i = 0; i < 10; i++) {
															if (proxy.teams && Object.keys(proxy.teams).length > 0) break;
															await new Promise(res => setTimeout(res, 250));
														}
														const team = findPlayerTeam(player, proxy);
														//@ts-ignore
														teamPrefixForPlayer = team ? jsonToMcText(team.teamData.prefix) : '';
														if (teamPrefixForPlayer) teamCache.set(player.uuid, teamPrefixForPlayer);
													}
												} else { teamPrefixForPlayer = ''; }
											} catch { teamPrefixForPlayer = ''; }
											sendUpdate();
										})();
										sendUpdate();
										Promise.allSettled([dsP, pingP, tagsP, teamP]).then(() => { });
									}
									if (gameType === 'game' && config.tabStatsSettings.useTeamColorUsernames) {
										const team = findPlayerTeam(player, proxy);
										//@ts-ignore
										const prefix = team ? jsonToMcText(team.teamData.prefix) : '';
										teamColorCode = extractFirstColorCode(prefix) || '';
									}
								});
							} else {
								if (gameType === 'queue') return;
								for (const player of Object.values(proxy.players || {})) {
									if (!player?.uuid || !player?.username) continue;
									if (player.uuid.replace(/-/g, '').toLowerCase() === uuid.replace(/-/g, '').toLowerCase()) continue;
									try {
										const original = player.displayName;

										let playerTeam = findPlayerTeam(player, proxy);

										let prefix = '';
										let suffix = '';

										//@ts-ignore
										if (playerTeam) {
											//@ts-ignore
											const prefixJson = playerTeam.teamData.prefix?.json || { text: '' };
											prefix = jsonToMcText(prefixJson);

											//@ts-ignore
											const suffixJson = playerTeam.teamData.suffix?.json || { text: '' };
											suffix = jsonToMcText(suffixJson);

											lobbyPrefixSuffixCache.set(player.uuid, { prefix, suffix });

										} else {
											if (lobbyPrefixSuffixCache.has(player.uuid)) {
												const cached = lobbyPrefixSuffixCache.get(player.uuid);
												if (cached) {
													prefix = cached.prefix;
													suffix = cached.suffix;
												}
											} else {
												continue;
											}
										}


										const playerNameColor = extractFirstColorCode(prefix) || '§7';

										const rawSelf = `${prefix}§r${playerNameColor}${original}§r${suffix}`;
										const raw = await applyAstralPrefix(rawSelf, player.uuid);

										proxy.client.write('player_info', {
											action: 3,
											data: [{ UUID: player.uuid, name: player.username, hasDisplayName: true, displayName: JSON.stringify({ text: raw }) }],
										});
									} catch { }
								}
							}
						} catch (error) { logger.error(error) }
					}, 1000);
					let tabkills = "0";
					let tabfinalKills = "0";
					let tabbedsBroken = "0";

					proxy.server.on('packet', (data, meta) => {

						if (meta.name === 'playerlist_header') {
							try {
								const footer = JSON.parse(data.footer);
								if (footer.extra && Array.isArray(footer.extra)) {
									const extra = footer.extra;
									for (let i = 0; i < extra.length - 1; i++) {
										const current = extra[i];
										const next = extra[i + 1];
										if (current.text === "Kills: " && current.color === "aqua") {
											tabkills = (next.text || '').toString().trim();
										} else if (current.text === "Final Kills: " && current.color === "aqua") {
											tabfinalKills = (next.text || '').toString().trim();
										} else if (current.text === "Beds Broken: " && current.color === "aqua") {
											tabbedsBroken = (next.text || '').toString().trim();
										}
									}
								}
							} catch { }
						}
					});

					setInterval(() => {
						const elapsedSession = Date.now() - getJoinTime();

						const elapsedGame = getInGameTime(gameType ?? 'lobby');
						const elapsedQueue = getQueueTime();
						const formattedSessionTime = formatElapsedTime(elapsedSession);
						const formattedGameTime = formatElapsedTime(elapsedGame);
						const formattedQueueTime = formatElapsedTime(elapsedQueue);
						const queueText = elapsedQueue >= 1000 ? `\n§7Queue Time: §a${formattedQueueTime}` : '';
						const gameTimeText = elapsedGame >= 1000 ? `\n§7Game Time: §a${formattedGameTime}` : '';

						discordRpc.setPlayStartTimestamp(getGameJoinTime());
						if (gameType === 'lobby' || gameType === 'queue') {
							tabkills = "0"; tabfinalKills = "0"; tabbedsBroken = "0";
						}
						const statMsg = gameType === 'game'
							? `§7Kills: §a${tabkills} §7Final Kills: §a${tabfinalKills} §7Beds Broken: §a${tabbedsBroken}\n`
							: '';

						proxy.client.write("playerlist_header", {
							header: JSON.stringify({
								text: "§5Astral §dProxy §7- §dv" + APP_VERSION,
							}),
							footer: JSON.stringify({
								text: `${statMsg}§7Time Online: §a${formattedSessionTime}${queueText}${gameTimeText}`
							})
						});
					}, 1000);



					let dsSelf: DisplayStats | null = null;
					let selfAvgPing: number | null = null;
					let selfLastPingFormatted: string | null = null;
					let selfTags: string[] = [];
					let selfCustomTag: string | null = null;
					void getDisplayStats(uuid).then(v => { dsSelf = v; }).catch(() => { });
					void getPingInfo(uuid).then(({ averagePing, lastPingFormatted }) => { selfAvgPing = averagePing; selfLastPingFormatted = lastPingFormatted; }).catch(() => { });
					void dataGetPlayerTags(uuid).then(res => { selfTags = res?.tags ?? []; selfCustomTag = res?.customtag ?? null; }).catch(() => { });

					ownInterval = setInterval(async () => {
						let teamPrefixSelf = ''

						if (gameType === 'game' || gameType === 'queue') {
							try {
								if (gameType !== 'queue') {
									teamPrefixSelf = teamCache.has(uuid)
										? teamCache.get(uuid)!
										: await (async () => {
											for (let i = 0; i < 10; i++) {
												if (proxy.teams && Object.keys(proxy.teams).length > 0) break;
												await new Promise(res => setTimeout(res, 250));
											}

											const team = findPlayerTeam({ originalUsername: username, username: username, displayName: username }, proxy);

											//@ts-ignore
											logger.debug(team?.teamData.prefix.color);
											//@ts-ignore
											if (!['gray', undefined].includes(team?.teamData.prefix.color)) ownTeamPrefixColor = team?.teamData.prefix.color;
											//@ts-ignore
											const prefix = team ? jsonToMcText(team.teamData.prefix) : '';
											teamCache.set(uuid, prefix);
											return prefix;
										})();
								} else {
									teamPrefixSelf = '';
								}
							} catch (error) {
								teamPrefixSelf = "";
								logger.error(error)
							}
						} else {
							teamPrefixSelf = ''
						}

						let toggledStats = ""
						let toggledTags = ""

						if (config.tabStatsSettings.tags) {
							const filtered = (selfTags ?? []).filter(t => !/ms/i.test(stripMcCodes(t)));
							toggledTags = filtered.length ? `§7[${filtered.join('§7, ')}§7] ` : '';
						}

						const defaultFormat = '- %%ping%% ms - %%gap%% - %%winstreak%% ws - %%fkdr%% fkdr - %%wlr%% wlr';
						const rawFormatSelf = config.tabStatsSettings?.format;
						let formatStr = (rawFormatSelf === '' || rawFormatSelf == null) ? defaultFormat : rawFormatSelf;

						toggledStats += buildStatsFromFormat(formatStr, { averagePing: selfAvgPing, lastPingFormatted: selfLastPingFormatted, ds: dsSelf });
						let displayName

						const allowSelfHere = config.tabStatsSettings.showSelf && (gameType !== 'lobby' || !!config.tabStatsSettings.showSelfInLobby)
						if (!allowSelfHere) {

							try {
								const original = username;

								let playerTeam = findPlayerTeam({ originalUsername: username, username: username, displayName: username }, proxy);

								//@ts-ignore
								if (!['gray', undefined].includes(playerTeam?.teamData.prefix.color)) ownTeamPrefixColor = playerTeam?.teamData.prefix.color;

								let prefix = '';
								let suffix = '';

								//@ts-ignore
								if (playerTeam) {
									//@ts-ignore
									const prefixJson = playerTeam.teamData.prefix?.json || { text: '' };
									prefix = jsonToMcText(prefixJson);

									//@ts-ignore
									const suffixJson = playerTeam.teamData.suffix?.json || { text: '' };
									suffix = jsonToMcText(suffixJson);

									lobbyPrefixSuffixCache.set(uuid, { prefix, suffix });

								} else {
									if (lobbyPrefixSuffixCache.has(uuid)) {
										const cached = lobbyPrefixSuffixCache.get(uuid);
										if (cached) {
											prefix = cached.prefix;
											suffix = cached.suffix;
										}
									} else {
										return;
									}
								}

								const playerNameColor = extractFirstColorCode(prefix) || '§7';

								const rawSelf = `${prefix}§r${playerNameColor}${original}§r${suffix}`;

								try {
									JSON.parse(JSON.stringify({ text: await applyAstralPrefix(rawSelf, uuid) }));
								} catch (e) {
									logger.error('Invalid JSON in displayName 7:', rawSelf);
									return;
								}

								proxy.client.write('player_info', {
									action: 3,
									data: [{ UUID: uuid, name: username, hasDisplayName: true, displayName: `{"text":"${await applyAstralPrefix(rawSelf, uuid)}"}` }],
								});
							} catch { }

							return
						}
						let teamColorCode = '';
						if (gameType === 'game' && config.tabStatsSettings.useTeamColorUsernames) {
							const team = findPlayerTeam({ originalUsername: username, username: username, displayName: username }, proxy);
							//@ts-ignore
							const prefix = team ? jsonToMcText(team.teamData.prefix) : '';
							const teamColor = extractFirstColorCode(prefix);
							teamColorCode = teamColor ? teamColor : ''
						} else {
							if (dsSelf) teamColorCode = getRankColor(dsSelf.rank);
						}
						let customTagAlways = selfCustomTag ? `§7[${selfCustomTag}§7] ` : ''
						const includeRankSelf = gameType === 'queue' ? true : !(config.tabStatsSettings?.useTeamColorUsernames && proxy.hypixel.server?.status === 'in_game');
						const maybePrefix = gameType === 'queue' ? '' : teamPrefixSelf;

						let formattedStar = '';
						if (dsSelf) formattedStar = getStarColor(dsSelf.level);

						const formattedRankSelf = includeRankSelf && dsSelf?.rank ? formatRankWithPlusColor(dsSelf.rank, dsSelf.rankPlusColor) : " ";

						const rawSelf = `${maybePrefix}${toggledTags}${customTagAlways}${formattedStar}${formattedRankSelf}${teamColorCode}${username}${toggledStats}`
						displayName = `{"text":"${await applyAstralPrefix(rawSelf, uuid)}"}`


						const packetData = {
							action: 3,
							data: [
								{
									UUID: uuid,
									name: username,
									hasDisplayName: true,
									displayName: displayName,
								},
							],
						};

						if (displayName) {
							const packetBuffer = proxy.client.serializer.createPacketBuffer({ name: 'player_info', params: packetData });
							proxy.client.writeRaw(packetBuffer);
						}
					}, 1000);
					tagManager.on('tagsChanged', async (changedUuid: string) => {
						try {
							if (String(changedUuid).replace(/-/g, '').toLowerCase() !== String(uuid).replace(/-/g, '').toLowerCase()) return
							const res = await dataGetPlayerTags(uuid)
							selfTags = res?.tags ?? []
							selfCustomTag = res?.customtag ?? null
						} catch { }
					})


				} catch (error) {
					logger.error("An unexpected error occurred", error);
					proxy.client.write('chat', { message: JSON.stringify({ text: `An error occurred while updating the tab.§r` }) });
				}

				gameType = 'lobby';
				cachedResponses.clear();
				updateGameType();
			})();

			return false;
		});

		async function applyAstralPrefix(text: string, uuid: string): Promise<string> {

			const uuid_ = uuid.replace(/-/g, '').toLowerCase();

			const isSelf = String(uuid_).toLowerCase() === String(ownUuid).toLowerCase();
			if (isSelf) {
				// If cached prefix exists and valid, apply it; otherwise request and return star immediately
				const now = Date.now();
				const cached = AstralPrefixCache.get(uuid_);
				const useIdentity = !!config?.tabStatsSettings?.enableIdentity;
				if (cached && cached.expires > now && (useIdentity ? cached.identity : cached.prefix)) {
					const p = useIdentity ? cached.identity! : cached.prefix!;
					return text.startsWith(p) ? text : `${p}§r§7${text}`;
				}
				try {
					void wsClient.requestIsUserOnAstral(uuid_).then(res => {
						let prefixToApply: string | null = null;
						let identityToApply: string | null = null;
						if (typeof res === 'object' && res) {
							identityToApply = typeof res.identity === 'string' && res.identity.trim().length > 0 ? res.identity : null;
							prefixToApply = typeof res.prefix === 'string' && res.prefix.trim().length > 0 ? res.prefix : null;
						} else if (typeof res === 'string' && res.trim().length > 0) {
							prefixToApply = res;
						} else if (res === true) {
							prefixToApply = '§d✦ ';
						}
						AstralPrefixCache.set(uuid_, { prefix: prefixToApply, identity: identityToApply, expires: Date.now() + 30 * 60 * 1000 });
					}).catch(() => { /* ignore */ });
				} catch { /* ignore */ }
				return text.startsWith('§d✦ ') || text.startsWith('✦ ') ? text : `§d✦ §r§7${text}`;
			}

			if (getUUIDVersion(uuid) !== 4) return text;

			{

				const cached = AstralPrefixCache.get(uuid_);
				const now = Date.now();

				if (cached && cached.expires > now) {
					const useIdentity = !!config?.tabStatsSettings?.enableIdentity;
					const p = useIdentity ? (cached.identity || '') : (cached.prefix || '');
					if (p.length > 0) {
						return text.startsWith(p) ? text : `${p}${text}`;
					}
					return text;
				}

				const res = await wsClient.requestIsUserOnAstral(uuid_);
				let prefixToApply: string | null = null;
				let identityToApply: string | null = null;
				if (typeof res === 'object' && res) {
					identityToApply = typeof res.identity === 'string' && res.identity.trim().length > 0 ? res.identity : null;
					prefixToApply = typeof res.prefix === 'string' && res.prefix.trim().length > 0 ? res.prefix : null;
				} else if (typeof res === 'string' && res.trim().length > 0) {
					prefixToApply = res;
				} else if (res === true) {
					// Backward compatibility: boolean response -> default prefix
					prefixToApply = '§d✦ ';
				}
				AstralPrefixCache.set(uuid_, { prefix: prefixToApply, identity: identityToApply, expires: now + 30 * 60 * 1000 });
				const useIdentity = !!config?.tabStatsSettings?.enableIdentity;
				const p = useIdentity ? (identityToApply || '') : (prefixToApply || '');
				if (p) {
					return text.startsWith(p) ? text : `${p}${text}`;
				}
			}
			return text;
		}

	},
} as Mod;

function getColorCode(color: string) {
	if (!color) return '§f';
	switch (color.toLowerCase()) {
		case 'black': return '§0';
		case 'dark_blue': return '§1';
		case 'dark_green': return '§2';
		case 'dark_aqua': return '§3';
		case 'dark_red': return '§4';
		case 'dark_purple': return '§5';
		case 'gold': return '§6';
		case 'gray': return '§7';
		case 'dark_gray': return '§8';
		case 'blue': return '§9';
		case 'green': return '§a';
		case 'aqua': return '§b';
		case 'red': return '§c';
		case 'light_purple': return '§d';
		case 'yellow': return '§e';
		case 'white': return '§f';
		default: return '§f';
	}
}

type DisplayStats = {
	level: number
	wins: number
	losses: number
	kills: number
	deaths: number
	finals: number
	beds: number
	bedsLost: number
	fkdr: number
	wlr: number
	bblr: number
	winstreak: number | string
	rank: string
	rankPlusColor: string
}

const DISPLAY_STATS_CACHE_TTL = 60 * 60 * 1000;
const displayStatsCache = new Map<string, { expires: number; value: DisplayStats | null }>();
const inFlightDisplayFetches = new Map<string, Promise<DisplayStats | null>>();

async function getDisplayStats(uuid: string): Promise<DisplayStats | null> {

	const now = Date.now();

	const cached = displayStatsCache.get(uuid);
	if (cached && cached.expires > now) {
		return cached.value;
	}

	if (inFlightDisplayFetches.has(uuid)) {
		return inFlightDisplayFetches.get(uuid)!;
	}

	const fetchPromise = (async (): Promise<DisplayStats | null> => {
		try {
			const useWs = !!getConfig().General.useWinstreakWsKey;
			if (useWs) {
				try {

					const stats: any = await getNadeshikoStats(uuid);
					if (!stats || !stats.stats || !stats.stats.Bedwars) {
						throw new Error('No BedWars stats found from Nadeshiko');
					}

					const bedwars = stats.stats.Bedwars;
					const bwLvl = stats.achievements?.bedwars_level || 0;
					const { rank: rankData, plusColor: rankPlusColor } = resolveRankData(stats);
					const wins = bedwars.wins_bedwars || 0;
					const losses = bedwars.losses_bedwars || 0;
					const kills = bedwars.kills_bedwars || 0;
					const deaths = bedwars.deaths_bedwars || 0;
					const finals = bedwars.final_kills_bedwars || 0;
					const beds = bedwars.beds_broken_bedwars || 0;
					const bedsLost = bedwars.beds_lost_bedwars || 0;
					const fkdr = finals / Math.max(1, bedwars.final_deaths_bedwars || 1);
					const wlr = wins / Math.max(1, losses);
					const bblr = beds / Math.max(1, bedsLost);
					let winstreak: number | string = bedwars.winstreak;
					if (winstreak === undefined || winstreak === null) {
						winstreak = '?';
					}

					const result: DisplayStats = {
						level: bwLvl,
						wins,
						losses,
						kills,
						deaths,
						finals,
						beds,
						bedsLost,
						fkdr,
						wlr,
						bblr,
						winstreak,
						rank: rankData,
						rankPlusColor,
					};
					return result;
				} catch {
				}
			}

			try {
				const stats: any = await getHypixelStats(uuid);
				if (!stats || !stats.stats || !stats.stats.Bedwars) return null;
				const bedwars = stats.stats.Bedwars;
				const bwLvl = stats.achievements?.bedwars_level || 0;
				const { rank: rankData, plusColor: rankPlusColor } = resolveRankData(stats);
				const wins = bedwars.wins_bedwars || 0;
				const losses = bedwars.losses_bedwars || 0;
				const kills = bedwars.kills_bedwars || 0;
				const deaths = bedwars.deaths_bedwars || 0;
				const finals = bedwars.final_kills_bedwars || 0;
				const beds = bedwars.beds_broken_bedwars || 0;
				const bedsLost = bedwars.beds_lost_bedwars || 0;
				const fkdr = finals / Math.max(1, bedwars.final_deaths_bedwars || 1);
				const wlr = wins / Math.max(1, losses);
				const bblr = beds / Math.max(1, bedsLost);
				let winstreak: number | string = bedwars.winstreak;
				if (winstreak === undefined || winstreak === null) {
					winstreak = '?';
				}
				const result: DisplayStats = {
					level: bwLvl,
					wins,
					losses,
					kills,
					deaths,
					finals,
					beds,
					bedsLost,
					fkdr,
					wlr,
					bblr,
					winstreak,
					rank: rankData,
					rankPlusColor,
				};
				return result;
			} catch {
				return null;
			}
		} finally {
		}
	})();

	inFlightDisplayFetches.set(uuid, fetchPromise);
	try {
		const result = await fetchPromise;
		displayStatsCache.set(uuid, { expires: Date.now() + DISPLAY_STATS_CACHE_TTL, value: result });
		return result;
	} finally {
		inFlightDisplayFetches.delete(uuid);
	}

}

function findPlayerTeam(player, proxy) {
	const username = player.originalUsername || player.username || stripMcCodes(player.displayName || '');

	for (const [teamName, teamData] of Object.entries(proxy.teams || {})) {
		//@ts-ignore
		if (!teamData) continue;
		//@ts-ignore
		const members = (teamData as any).membersMap as string[] | undefined;
		if (!Array.isArray(members)) continue;
		//@ts-ignore
		if (members.includes(username)) {
			return { teamName, teamData };
		}
	}

	return null;
}

function jsonToMcText(json: any): string {
	if (!json) return "";

	let result = json.text || "";
	if (json.color) {
		const colorCode = getColorCode(json.color);
		result = `${colorCode}${result}`;
	}
	if (json.bold) {
		result = `§l${result}`;
	}

	if (Array.isArray(json.extra)) {
		for (const extra of json.extra) {
			result += jsonToMcText(extra);
		}
	}

	return result;
}

function extractFirstColorCode(text: string): string | null {
	const colorCodeRegex = /§[0-9a-fk-or]/i;
	const match = text.match(colorCodeRegex);
	return match ? match[0] : null;
}

function getTeamNameFromColorCode(colorCode: string): string | null {
	switch (colorCode) {
		case '§c': return 'Red';
		case '§9': return 'Blue';
		case '§a': return 'Green';
		case '§e': return 'Yellow';
		case '§b': return 'Cyan';
		case '§f': return 'White';
		case '§d': return 'Pink';
		case '§8': return 'Gray';
		default: return null;
	}
}