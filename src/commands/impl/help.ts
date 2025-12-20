import type Command from '../command.js';

const helpCommand: Command = {
  name: 'help',
  description: 'All Winstreak Proxy Commands',
  version: '1.0.0',
  prefix: '§7[§5Astral§7]§r',
  hidden: false,
  enabled: true,
  run: async ({ reply, proxy }) => {
    let helpMessage = '§6Available Commands:';

    const coreCommands = Array.from(proxy.commands.values());
    const modCommands = proxy.modAPI?.commandSystem.getCommands() ?? [];

    const allCommands = [...coreCommands, ...modCommands];

    if (allCommands.length === 0) {
      reply('No commands available.');
      return;
    }

    const addedCommands = new Set<string>();

    for (const command of allCommands) {
      if (addedCommands.has(command.name?.toLowerCase())) continue;
      if (command.hidden) continue;
      if (!command.enabled) continue;

      addedCommands.add(command.name.toLowerCase());
      helpMessage += `\n§r> §e/a:${command.name} §7- §f${command.description ?? 'No description'}`;
    }

    reply(helpMessage);
  },
};

export default helpCommand;
