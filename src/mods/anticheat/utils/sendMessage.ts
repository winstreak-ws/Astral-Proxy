import { getConfig } from '../../../config/config.js';
let config = getConfig();
setInterval(async () => {
  config = getConfig();
}, 5000);

let proxyInstance: any = null;

export function setProxy(proxy: any) {
  proxyInstance = proxy;
}

export function sendMessage(username: string, check: string, vl: number) {
  if (!proxyInstance) {
    throw new Error("Proxy has not been set in sendMessage.ts");
  }
  
  username = username.replace(/§./g, '');

  const showVL = config.anticheatSettings.showVL ? ` (§7VL=§b${vl}§r)` : '';

  const baseMessage = {
      text: `§7[§5Astral§7]§r §d${username}§r was detected for §d${check}§r${showVL} `,
      strikethrough: false,
  };

  const wdrButton = {
      text: `§c[WDR]`,
      strikethrough: false,
      clickEvent: {
          action: 'run_command',
          value: `/wdr ${username} ${check}`,
      },
      hoverEvent: {
        action: "show_text",
        value: [
          { 'text': '§e§lClick to report player' },
          { 'text': `\n§a§lPlayer: §d§l${username}`},
          { 'text': `\n§c§lDetection: §d§l${check}`}

        ]
      }
  };

  const messagePayload = {
      text: '',
      strikethrough: false,
      extra: [baseMessage],
  };

  if (config.anticheatSettings.showWDR) {
      messagePayload.extra.push(wdrButton);
  }

  proxyInstance.client.write('chat', {
      message: JSON.stringify(messagePayload),
  });
}

export function sendPartyMessage(username: string, check: string, vl: number) {
  if (!proxyInstance) {
    throw new Error("Proxy has not been set in sendMessage.ts");
  }

  username = username.replace(/§./g, '');
  proxyInstance.server.write('chat', {
    message: `/pc ${username} was detected for ${check} by Astral`
  });
}
