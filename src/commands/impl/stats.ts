import { logger } from '../../utils/logger.js';
import type Command from '../command.js';
import axios from 'axios';
import { hypixelRateLimiter } from '../../data/rateLimiter.js'
import { getConfig } from '../../config/config.js';
import { getBedwarsTabstats as dataGetBedwarsTabstats } from '../../data/playerData.js'
let config = getConfig()

setInterval(async () => {
  config = getConfig();
}, 5000);

function getRankColor(rank: string): string {
    switch (rank) {
        case 'VIP':
        case 'VIP+':
            return '§a';
        case 'MVP':
        case 'MVP+':
            return '§b';
        case 'MVP++':
            return '§6';
        case 'ADMIN':
            return '§c';
        case 'GM': 
            return '§2';
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
    const colorCode = getPlusColor(rankPlusColor);
    const rankColor = getRankColor(rank);

    if (rank === "None") return " ";
    
    let coloredRank = ` ${rankColor}[${rank}] `;

    if (rank === 'YOUTUBE') { coloredRank = `§c[§fYOUTUBE§c]`}

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

function getStarColor(bwlvl: number): string {
    let colorFormatted = `§7[*✫]`; // Default to Stone Prestige

    if (bwlvl < 10) {
        colorFormatted = `§7[*✫]`; // Stone Prestige
    } else if (bwlvl < 100) {
        colorFormatted = `§7[**✫]`; // Stone Prestige
    } else if (bwlvl >= 100 && bwlvl < 200) {
        colorFormatted = `§f[***✫]`; // Iron Prestige
    } else if (bwlvl >= 200 && bwlvl < 300) {
        colorFormatted = `§6[***✫]`; // Gold Prestige
    } else if (bwlvl >= 300 && bwlvl < 400) {
        colorFormatted = `§b[***✫]`; // Diamond Prestige
    } else if (bwlvl >= 400 && bwlvl < 500) {
        colorFormatted = `§2[***✫]`; // Emerald Prestige
    } else if (bwlvl >= 500 && bwlvl < 600) {
        colorFormatted = `§3[***✫]`; // Sapphire Prestige
    } else if (bwlvl >= 600 && bwlvl < 700) {
        colorFormatted = `§4[***✫]`; // Ruby Prestige
    } else if (bwlvl >= 700 && bwlvl < 800) {
        colorFormatted = `§d[***✫]`; // Crystal Prestige
    } else if (bwlvl >= 800 && bwlvl < 900) {
        colorFormatted = `§9[***✫]`; // Opal Prestige
    } else if (bwlvl >= 900 && bwlvl < 1000) {
        colorFormatted = `§5[***✫]`; // Amethyst Prestige
    } else if (bwlvl >= 1000 && bwlvl < 1100) {
        colorFormatted = `§c[§6*§e*§a*§b*§d✫§5]`; // Rainbow Prestige (Multiple colors)
    } else if (bwlvl >= 1100 && bwlvl < 1200) {
        colorFormatted = `§7[§f****§7✪]`; // Iron Prime Prestige
    } else if (bwlvl >= 1200 && bwlvl < 1300) {
        colorFormatted = `§7[§e****§6✪§7]`; // Gold Prime Prestige
    } else if (bwlvl >= 1300 && bwlvl < 1400) {
        colorFormatted = `§7[§b****§3✪§7]`; // Diamond Prime Prestige
    } else if (bwlvl >= 1400 && bwlvl < 1500) {
        colorFormatted = `§7[§a****§2✪§7]`; // Emerald Prime Prestige
    } else if (bwlvl >= 1500 && bwlvl < 1600) {
        colorFormatted = `§7[§3****§9✪§7]`; // Sapphire Prime Prestige
    } else if (bwlvl >= 1600 && bwlvl < 1700) {
        colorFormatted = `§7[§c****§4✪§7]`; // Ruby Prime Prestige
    } else if (bwlvl >= 1700 && bwlvl < 1800) {
        colorFormatted = `§7[§d****§5✪§7]`; // Crystal Prime Prestige
    } else if (bwlvl >= 1800 && bwlvl < 1900) {
        colorFormatted = `§7[§9****§1✪§7]`; // Opal Prime Prestige
    } else if (bwlvl >= 1900 && bwlvl < 2000) {
        colorFormatted = `§7[§5****§8✪§7]`; // Amethyst Prime Prestige
    } else if (bwlvl >= 2000 && bwlvl < 2100) {
        colorFormatted = `§8[§7*§f**§7*✪§8]`; // Mirror Prestige
    } else if (bwlvl >= 2100 && bwlvl < 2200) {
        colorFormatted = `§f[*§e**§6*❀]`; // Light Prestige
    } else if (bwlvl >= 2200 && bwlvl < 2300) {
        colorFormatted = `§6[*§f**§b*§3❀]`; // Dawn Prestige
    } else if (bwlvl >= 2300 && bwlvl < 2400) {
        colorFormatted = `§5[*§d**§6*§e❀]`; // Dusk Prestige
    } else if (bwlvl >= 2400 && bwlvl < 2500) {
        colorFormatted = `§b[*§f**§7*§8❀]`; // Air Prestige
    } else if (bwlvl >= 2500 && bwlvl < 2600) {
        colorFormatted = `§f[*§a**§2*❀]`; // Wind Prestige
    } else if (bwlvl >= 2600 && bwlvl < 2700) {
        colorFormatted = `§4[*§c**§d*❀]`; // Nebula Prestige
    } else if (bwlvl >= 2700 && bwlvl < 2800 ) {
        colorFormatted = `§e[*§f**§8*❀]`; // Thunder Prestige
    } else if (bwlvl >= 2800 && bwlvl < 2900) {
        colorFormatted = `§a[*§2**§6*❀§e]`; // Earth Prestige
    } else if (bwlvl >= 2900 && bwlvl < 3000) {
        colorFormatted = `§b[*§3**§9*❀§1]`; // Water Prestige
    } else if (bwlvl >= 3000 && bwlvl < 3100) {
        colorFormatted = `§e[*§6**§c*❀§4]`; // Fire Prestige
    } else if (bwlvl >= 3100 && bwlvl < 3200) {
        colorFormatted = `§9[*§3**§6✥§e]`; // New color 3100
    } else if (bwlvl >= 3200 && bwlvl < 3300) {
        colorFormatted = `§c[§4*§7**§4*§c✥]`; // New color 3200
    } else if (bwlvl >= 3300 && bwlvl < 3400) {
        colorFormatted = `§9[**§d*§c*✥§4]`; // New color 3300
    } else if (bwlvl >= 3400 && bwlvl < 3500) {
        colorFormatted = `§2[§a*§d**§5*✥§2]`; // New color 3400
    } else if (bwlvl >= 3500 && bwlvl < 3600) {
        colorFormatted = `§c[*§4**§2*§a✥]`; // New color 3500
    } else if (bwlvl >= 3600 && bwlvl < 3700) {
        colorFormatted = `§a[**§b*§9*✥§1]`; // New color 3600
    } else if (bwlvl >= 3700 && bwlvl < 3800) {
        colorFormatted = `§4[*§c**§b*§3✥]`; // New color 3700
    } else if (bwlvl >= 3800 && bwlvl < 3900) {
        colorFormatted = `§1[*§9*§5**§d✥§1]`; // New color 3800
    } else if (bwlvl >= 3900 && bwlvl < 4000) {
        colorFormatted = `§c[*§a**§3*§9✥]`; // New color 3900
    } else if (bwlvl >= 4000 && bwlvl < 4100) {
        colorFormatted = `§5[*§c**§6*✥§e]`; // New color 4000
    } else if (bwlvl >= 4100 && bwlvl < 4200) {
        colorFormatted = `§e[*§6*§c*§d*✥§5]`; // New color 4100
    } else if (bwlvl >= 4200 && bwlvl < 4300) {
        colorFormatted = `§1[§9*§3*§b*§f*§7✥]`; // New color 4200
    } else if (bwlvl >= 4300 && bwlvl < 4400) {
        colorFormatted = `§0[§5*§8**§5*✥§0]`; // New color 4300
    } else if (bwlvl >= 4400 && bwlvl < 4500) {
        colorFormatted = `§2[*§a*§e*§6*§5✥§d]`; // New color 4400
    } else if (bwlvl >= 4500 && bwlvl < 4600) {
        colorFormatted = `§f[*§b**§3*✥]`; // New color 4500
    } else if (bwlvl >= 4600 && bwlvl < 4700) {
        colorFormatted = `§3[§b*§e**§6*§d✥§5]`; // New color 4600
    } else if (bwlvl >= 4700 && bwlvl < 4800) {
        colorFormatted = `§f[§4*§c**§9*§1✥§9]`; // New color 4700
    } else if (bwlvl >= 4800 && bwlvl < 4900) {
        colorFormatted = `§5[*§c*§6*§e*§b✥§3]`; // New color 4800
    } else if (bwlvl >= 4900 && bwlvl < 5000) {
        colorFormatted = `§2[§a*§f**§a*✥§2]`; // New color 4900
    } else if (bwlvl >= 5000) {
        colorFormatted = `§4[*§5*§9**§1✥§0]`; // New color 5000
    }

    const bwlvlStr = bwlvl.toString();
    let bwlvlIndex = 0;
    colorFormatted = colorFormatted.replace(/\*/g, () => bwlvlStr[bwlvlIndex++] || '*');

    return colorFormatted;
}

async function getUUID(playerName: string): Promise<{ id: string; name: string }> {
    try {
        const { data } = await axios.get(`https://api.mojang.com/users/profiles/minecraft/${playerName}`);
        return { id: (data as any).id, name: (data as any).name };
    } catch (error) {
        throw new Error('Failed to fetch UUID');
    }
}

async function getBedWarsStats(uuid: string) {
    try {
        // Respect Hypixel API rate limits when user provides their own key
        if (config.General.hypixelKey && String(config.General.hypixelKey).trim() !== '') {
            await hypixelRateLimiter.acquire(1)
        }
        const res = await axios.get(`https://api.hypixel.net/player`, {
            params: { key: config.General.hypixelKey, uuid },
        });

        // Update limiter from response headers
        if (config.General.hypixelKey && String(config.General.hypixelKey).trim() !== '') {
            hypixelRateLimiter.updateFromHeaders(res.headers)
        }

        const data = res.data as any
        if (!data.success || !data.player || !data.player.stats || !data.player.stats.Bedwars) {
            throw new Error('No BedWars stats found for this player.');
        }

        return data.player;
    } catch (error) {
        const headers = (error as any)?.response?.headers
        if (headers && config.General.hypixelKey && String(config.General.hypixelKey).trim() !== '') {
            hypixelRateLimiter.updateFromHeaders(headers)
        }
        throw new Error('Error fetching BedWars stats');
    }
}

export default {
    name: 'bw',
    description: 'Retrieve BedWars stats from Hypixel',
    version: '1.0.0',
    prefix: '§7[§5Astral§7]§r',
    enabled: true,
    hidden: false,
    options: [
        {
            name: 'player',
            description: 'The player to search for',
            required: true,
            type: 'string',
        },
    ],
    run: async ({ options, reply }: { options: Map<string, any>; reply: (msg: string) => void }) => {
        const playerName = options.get('player');
        if (!playerName) {
            reply('Usage: /wsstats <playerName>');
            return;
        }

        logger.info(`Fetching UUID for player: ${playerName}`);
        let playerData;

        try {
            playerData = await getUUID(playerName);
        } catch (error) {
            logger.error(`Error fetching UUID for ${playerName}: ${(error as Error).message}`);
            reply(`Error fetching UUID: ${(error as Error).message}`);
            return;
        }

        const { id: uuid, name: correctName } = playerData;
        logger.info(`Fetched UUID: ${uuid}, Corrected Name: ${correctName}`);

        try {
            const useWs = !!getConfig().General.useWinstreakWsKey;
            const tabstats = useWs ? await dataGetBedwarsTabstats(uuid) : null
            if (tabstats) {
                const formattedRank = formatRankWithPlusColor(tabstats.rank || 'None', tabstats.rankPlusColor || 'GOLD')
                const formattedStar = getStarColor(tabstats.level || 0)
                const wins = tabstats.wins || 0
                const wlr = typeof tabstats.wlr === 'number' ? tabstats.wlr : 0
                const fkdr = typeof tabstats.fkdr === 'number' ? tabstats.fkdr : 0
                const finals = tabstats.finals || 0
                const beds = tabstats.beds || 0
                const bblr = typeof tabstats.bblr === 'number' ? tabstats.bblr : 0

                const message = `§7[§cBed§fWars§7]\n§d> ${formattedStar}${formattedRank}${correctName} \n§d> §7WLR: §b${wlr.toFixed(2)}, §7Wins: §b${wins.toLocaleString()} \n§d> §7FKDR: §6${fkdr.toFixed(2)}, §7Finals: §6${finals.toLocaleString()} \n§d> §7BBLR: §e${bblr.toFixed(2)}, §7Beds: §e${beds.toLocaleString()}`;

                logger.info(`Stats retrieved for ${correctName} via TabStats`);
                reply(message);
                return
            }

            // Fallback to direct Hypixel API
            const stats = await getBedWarsStats(uuid);
            const bedwars = stats.stats.Bedwars

            let rankData = stats.newPackageRank || "None"
            if (stats.monthlyPackageRank) { rankData = stats.monthlyPackageRank } 
            if (stats.rank) { rankData = stats.rank }
            if (rankData == 'VIP') {
                rankData = 'VIP'
            } else if (rankData == 'VIP_PLUS') {
                rankData = 'VIP+'
            } else if (rankData == 'MVP') {
                rankData = 'MVP'
            } else if (rankData == 'MVP_PLUS') {
                rankData = 'MVP+'
            } else if (rankData == 'SUPERSTAR') {
                rankData = 'MVP++'
            } else if (rankData == 'ADMIN') {
                rankData = 'ADMIN'
            } else if (rankData == 'YOUTUBER') {
                rankData = 'YOUTUBE'
            } else if (rankData == 'GAME_MASTER') {
                rankData = 'GM'
            }
            const rankPlusColor = stats.rankPlusColor || "GOLD"
            const bwLvl = stats.achievements?.bedwars_level || 0
            const formattedRank = formatRankWithPlusColor(rankData, rankPlusColor)
            const formattedStar = getStarColor(bwLvl)
            const wins = bedwars.wins_bedwars || 0;
            const losses = bedwars.losses_bedwars || 0;
            const fkdr = (bedwars.final_kills_bedwars || 0) / Math.max(1, bedwars.final_deaths_bedwars || 1);
            const wlr = wins / Math.max(1, losses);
            const bedsBroken = bedwars.beds_broken_bedwars || 0;
            const bedsLost = bedwars.beds_lost_bedwars || 0;
            const bblr = bedsBroken / Math.max(1, bedsLost)

            const message = `§7[§cBed§fWars§7]\n§d> ${formattedStar}${formattedRank}${correctName} \n§d> §7WLR: §b${wlr.toFixed(2)}, §7Wins: §b${wins.toLocaleString()} \n§d> §7FKDR: §6${fkdr.toFixed(2)}, §7Finals: §6${bedwars.final_kills_bedwars.toLocaleString()} \n§d> §7BBLR: §e${bblr.toFixed(2)}, §7Beds: §e${bedsBroken.toLocaleString()}`;

            logger.info(`Stats retrieved for ${correctName}`);
            reply(message);
        } catch (error) {
            logger.error(`Error fetching stats: ${(error as Error).message}`);
            reply(`Error fetching stats: ${(error as Error).message}`);
        }
    },
} as Command;
