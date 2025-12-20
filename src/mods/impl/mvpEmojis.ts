import type Mod from '../mod.js';
import { logger } from '../../utils/logger.js';
import { setProxy } from '../anticheat/utils/sendMessage.js';
import { getConfig } from "../../config/config.js";

let config = getConfig();
setInterval(() => {
  config = getConfig();
}, 5000);

const emojis: Record<string, string> = {
  "<3": "❤",
  ":star:": "✮",
  ":yes:": "✔",
  ":no:": "✖",
  ":java:": "☕",
  ":arrow:": "➜",
  ":shrug:": "¯\\_(ツ)_/¯",
  ":tableflip": "(╯°□°）╯︵ ┻━┻",
  "o/": "( ﾟ◡ﾟ)/",
  ":123:": "123",
  ":totem:": "☉_☉",
  ":typing:": "✎...",
  ":maths:": "√(π+x)=L",
  ":snail:": "@'-'",
  ":thinking:": "(0.o?)",
  ":gimme:": "༼つ◕_◕༽つ",
  ":wizard:": "('-')⊃━☆ﾟ.*･｡ﾟ",
  ":pvp:": "⚔",
  ":peace:": "✌",
  ":oof:": "OOF",
  ":puffer:": "<('O')>",
  ":yey:": "ヽ (◕◡◕) ﾉ",
  ":cat:": "= ＾● ⋏ ●＾ =",
  ":dab:": "<o/",
  ":dj:": "ヽ(⌐■_■)ノ♬",
  ":snow:": "☃",
  "^_^": "^_^",
  "h/": "ヽ(^◇^*)/",
  "^-^": "^-^",
  ":sloth:": "(・⊝・)",
  ":cute:": "(✿◠‿◠)",
  ":dog:": "(ᵔᴥᵔ)"
};

export default {
  name: 'mvpEmojis',
  description: 'Unlocks MVP+ emojis without paying',
  version: '1.0.0',

  init: (proxy) => {
    logger.debug('mvpEmojis loaded');
    setProxy(proxy);

    const player = proxy.rawProxy.players.get(proxy.client.username);
    if (player) {
      player.registerChatHandler((data) => {
        const currentConfig = getConfig(); 

        if (!currentConfig.freeEmojis.enabled) return false;
        let msg = data.message as string;
        let modified = false;

        for (const key in emojis) {
          const regex = new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g');
          if (regex.test(msg)) {
            modified = true;
            msg = msg.replace(regex, emojis[key]);
          }
        }

        if (modified) {
          proxy.server.write('chat', { message: msg });
          console.log(config.freeEmojis.enabled)
          return true;
        }

        return false;
      });
    }
  },
} as Mod;