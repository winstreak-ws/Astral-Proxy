import type Command from '../command.js';
import wsClient from '../../data/websocketClient.js';

const wsCommand: Command = {
  name: 'websocket',
  description: 'WebSocket management commands',
  version: '1.0.0',
  prefix: '§7[§5Astral§7]§r',
  hidden: false,
  enabled: true,
  options: [
    {
      name: 'action',
      description: 'The action to perform',
      required: true,
      type: 'string',
    },
    {
      name: 'argument',
      description: 'The argument for the action',
      required: false,
      type: 'string',
    }
  ],
  run: async ({ options, reply }: { options: Map<string, any>; reply: (msg: string) => void }) => {
    const action = options.get('action');

    if (action === 'restart') {
      try {
        reply('§aRestarting WebSocket connection...');
        const success = wsClient.restart();
        if (success) {
          reply('§aWebSocket connection restarted successfully.');
        } else {
          reply('§cFailed to restart WebSocket connection.');
        }
      } catch (e: any) {
        reply(`§cFailed to restart WebSocket: ${e}`);
      }
    } else if (action === 'status') {
      const status = wsClient.connected ? '§aConnected' : '§cDisconnected';
      reply(`WebSocket status: ${status}`);
    } else if (action === 'sync') {
      wsClient.uploadConfig();
      reply('§aResynced your config. Reload the config webpage to see changes.');
    } else {
      reply('§cUnknown action. Available actions: restart, status, sync');
    }

  },
};

export default wsCommand;
