import type Command from '../command.js';
import { logger } from '../../utils/logger.js';
import { getConfig } from '../../config/config.js';
let config = getConfig()

setInterval(async () => {
  config = getConfig();
}, 5000);

const nickBot = {
  enabled: false,
  wait: true,
  currentNick: '',
  lastSentNick: Date.now(),
  INTERVAL: config.nickBot.cooldown * 1000 || 1000,
  containsList: new Set<string>(),
  startsWithList: new Set<string>(),
  endsWithList: new Set<string>(),
};

function extractNickFromChatMessage(chatPacket: any): string {
  let nick = '';
  if (chatPacket && chatPacket.extra && Array.isArray(chatPacket.extra)) {
    for (const item of chatPacket.extra) {
      if (typeof item.text === 'string' && item.text.startsWith('You are now nicked as ')) {
        nick = item.text.substring('You are now nicked as '.length);
        break;
      }
    }
  }

  return nick.trim();
}

export default {
  name: 'nickbot',
  description: 'Auto-claims Hypixel nicknames based on filters',
  version: '1.0.0',
  prefix: '§7[§5Astral§7]§r',
  enabled: true,
  hidden: false,

  options: [
    {
      name: 'action',
      description: 'toggle | contains | startswith | endswith | test',
      type: 'string',
      required: true,
    },
    {
      name: 'value',
      description: 'Optional value for pattern or nick',
      type: 'string',
      required: false,
    },
],

  run: async ({ proxy, options, reply }) => {
    const action = (options.get('action') || '').toLowerCase();
    const value = options.get('value');
    let count = 0
    let lastLobby = null
    let lastAttemptTime = Date.now()
    if (action === 'toggle') {
      if (nickBot.enabled) {
        reply('§7[§dNickBot§7]§r §cNickBot is now disabled.');
        count = 0
        lastAttemptTime = Date.now()
        nickBot.enabled = false;
      } else {
        nickBot.enabled = true;
        reply('§7[§dNickBot§7]§r §aNickBot is now enabled.');
      }
    } else if (action === 'test' && value) {
      const nick = value;
      reply(`§7[§dNickBot§7]§r The nick "${nick}" is ${isGoodNick(nick) ? 'good' : 'bad'}`);
    }
    if (!nickBot.enabled) { return }
    if ((proxy as any)._nickbotAttached) return;
    (proxy as any)._nickbotAttached = true;
    reply('§7[§dNickBot§7]§r §aNickBot started. Attempting to fetch current nick...');
    proxy.server.write('chat', { message: '/nick reuse' });

    function extractNickFromBook(pages: string[]): string[] {
      const nicks: string[] = [];

      for (let i = 0; i < pages.length; i++) {
        const pageContent = pages[i].replace(/\u00a7./g, '');

        try {
          const jsonString = JSON.parse(pageContent);

          if (Array.isArray(jsonString)) {
            for (const entry of jsonString) {
              if (typeof entry === 'string') {
                if (/^[a-zA-Z0-9_]{3,16}$/.test(entry)) {
                  if (isGoodNick(entry)) {
                    const currentTime = Date.now()
                    const timeDiff = currentTime - lastAttemptTime
                    lastAttemptTime = currentTime
                    count++

                    reply(`§7[§dNickBot§7]§r §eSetting nick: §a${entry}§r.\n§7[§dAttempts§7]§e Attempt: §b${count} §e(§b${timeDiff}ms§e)\n§7[§dNickBot§7]§r §cNickBot is now disabled.`);
                    proxy.server.write('chat', { message: `/nick actuallyset ${entry}` });
                    nickBot.enabled = false;
                  } else {
                    let randomLobby;
                    do {
                      randomLobby = Math.floor(Math.random() * (18 - 4 + 1)) + 4;
                    } while (randomLobby === lastLobby);
                    lastLobby = randomLobby;
                    const currentTime = Date.now()
                    const timeDiff = currentTime - lastAttemptTime
                    lastAttemptTime = currentTime
                    count++
                    if (count % config.nickBot.switchLobby === 0) {
                      reply(`§7[§dNickBot§7]§r §eSkipping nick: §c${entry}§e.\n§7[§dLobby§7]§e Switching to lobby §b${randomLobby}.\n§7[§dAttempts§7]§e Session Attempts: §b${count} §e(§b${timeDiff}ms§e)`);
                      proxy.server.write('chat', { message: `/swaplobby ${randomLobby}` });
                    } else {
                      reply(`§7[§dNickBot§7]§r §eSkipping nick: §c${entry}§e.\n§7[§dAttempts§7]§e Session Attempts: §b${count} §e(§b${timeDiff}ms§e)`);
                    }
                  }
                  nicks.push(entry);
                }
              }

              if (entry && entry.text && typeof entry.text === 'string') {
                const text = entry.text.trim();
                if (/^[a-zA-Z0-9_]{3,16}$/.test(text)) {
                  nicks.push(text);
                }
              }
            }
          }
        } catch (e) {
          logger.error(`Error parsing page content: ${e}`);
        }
      }
      if (nicks.length === 0) {
        logger.warn('No nicknames found in book pages.');
      }
      return nicks;
    }

    proxy.onIncoming('chat', function () {
        const chatPacket = arguments[2];

        if (chatPacket && typeof chatPacket.message === 'string') {
            try {
              const msgObj = JSON.parse(chatPacket.message);
              const nick = extractNickFromChatMessage(msgObj);

              if (nick) {
                nickBot.currentNick = nick;
                nickBot.wait = false;
                nickBot.enabled = true;
                reply(`§7[§dNickBot§7]§r §aCurrent nick: §b${nickBot.currentNick}`);
                logger.info(`[NickBot] Current nick set to ${nickBot.currentNick}`);
              }
            } catch (e) {
              logger.error('Failed to parse chat message JSON:', chatPacket.message);
            }
        }

        return undefined;
    });


    let currentHotbarSlot = 0;

    proxy.client.on('held_item_slot', (packet) => {
      currentHotbarSlot = packet.slotId;
    });


    const hotbar = new Array(9).fill(null);

    proxy.server.on('window_items', (packet) => {
      if (packet.windowId === 0) {
        for (let i = 36; i <= 44; i++) {
          hotbar[i - 36] = packet.items[i];
        }
      }
    });

    proxy.server.on('set_slot', (packet) => {
      if (packet.windowId === 0 && packet.slot >= 36 && packet.slot <= 44) {
        const slot = packet.slot - 36;
        hotbar[slot] = packet.item;
      }
    });

    proxy.server.on('custom_payload', (packet) => {
      if (packet.channel === 'MC|BOpen') {
        const heldItem = hotbar[currentHotbarSlot];

        if (!heldItem || heldItem.blockId !== 387) {
          logger.warn('No written book found in current slot.');
          return;
        }

        const nbt = heldItem.nbtData?.value?.pages?.value?.value;
        if (!nbt) {
          logger.warn('No NBT found in book.');
          return;
        }
        extractNickFromBook(heldItem.nbtData.value.pages.value.value);
      }
    });


    setInterval(() => {
      if (nickBot.enabled && Date.now() - nickBot.lastSentNick >= nickBot.INTERVAL) {
        proxy.server.write('chat', { message: '/nick help setrandom' });
        nickBot.lastSentNick = Date.now();
        logger.info('[NickBot] Requested random nick...');
        
      }
    }, 10);
  },
} as Command;

function isGoodNick(nick: string): boolean {
  const lower = nick.toLowerCase();
  if (lower === nickBot.currentNick.toLowerCase()) return false;
  if (nick.length === 4) return true;
  if (!hasRepeatingVowels(lower)) return false;
  for (const pattern of nickBot.containsList)
    if (lower.includes(pattern)) return true;
  for (const pattern of nickBot.startsWithList)
    if (lower.startsWith(pattern)) return true;
  for (const pattern of nickBot.endsWithList)
    if (lower.endsWith(pattern)) return true;

  return true;
}


function hasRepeatingVowels(nick: string): boolean {
  const vowels = ['a', 'e', 'i', 'o', 'u', 'y', 'A', 'E', 'I', 'O', 'U', 'Y'];
  let count = 1;

  for (let i = 1; i < nick.length; i++) {
    const curr = nick[i].toLowerCase();
    const prev = nick[i - 1].toLowerCase();

    if (vowels.includes(curr) && curr === prev) {
      count++;
      if (count >= 3) return true;
    } else {
      count = 1;
    }
  }

  return false;
}







