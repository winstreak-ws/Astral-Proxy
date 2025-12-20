import type Player from '../../player/player.js';
import { logger } from '../../utils/logger.js';

export interface ModCommandOptions {
    name: string;
    description: string;
    prefix?: string;
    aliases?: string[];
    hidden?: boolean;
    options?: {
        name: string;
        description: string;
        type: string;
        required: boolean;
    }[];
}

export interface ModCommandContext {
    options: Map<string, string>;
    proxy: Player;
    reply: (message: string) => void;
    sender: string;
}

export class ModCommandSystem {
    private commands = new Map<string, {
        modName: string;
        options: ModCommandOptions;
        handler: (context: ModCommandContext) => void;
    }>();

    constructor(private proxy: Player) {
        this.setupCommandHandler();
    }

    private setupCommandHandler() {
        this.proxy.on('outgoing_chat', (message: string) => {
            if (!message.startsWith('/')) return false;

            const args = message.split(' ');
            const commandName = args[0].slice(1).toLowerCase();
            args.shift();

            const command = Array.from(this.commands.values()).find(cmd => 
                cmd.options.name.toLowerCase() === commandName || 
                cmd.options.aliases?.map(a => a.toLowerCase()).includes(commandName)
            );

            if (!command) return false;

            this.proxy.client.write('chat', { message: JSON.stringify({ text: '' }) });

            const options = new Map<string, string>();
            if (command.options.options) {
                for (let i = 0; i < command.options.options.length; i++) {
                    const option = command.options.options[i];
                    const value = args[i];

                    if (!value && option.required) {
                        this.sendMessage(command.options.prefix || '§7[§dMod§7]§r', `§cMissing required argument: ${option.name}`);
                        return true;
                    }

                    if (value) {
                        options.set(option.name, value);
                    }
                }
            }

            try {
                command.handler({
                    options,
                    proxy: this.proxy,
                    reply: (msg: string) => this.sendMessage(command.options.prefix || '§7[§dMod§7]§r', msg),
                    sender: this.proxy.server?.username || 'Unknown'
                });
            } catch (error) {
                logger.error(`Error executing mod command ${command.options.name}:`, error);
                this.sendMessage(command.options.prefix || '§7[§dMod§7]§r', '§cAn error occurred while executing the command.');
            }

            return true;
        });
    }

    registerCommand(modName: string, options: ModCommandOptions, handler: (context: ModCommandContext) => void) {
        const existingCommand = Array.from(this.commands.values()).find(cmd => 
            cmd.modName === modName && cmd.options.name.toLowerCase() === options.name.toLowerCase()
        );
        
        if (existingCommand) {
            logger.warn(`[${modName}] Command ${options.name} is already registered, skipping.`);
            return;
        }

        this.commands.set(options.name.toLowerCase(), {
            modName,
            options,
            handler
        });

        if (options.aliases) {
            options.aliases.forEach(alias => {
                this.commands.set(alias.toLowerCase(), {
                    modName,
                    options,
                    handler
                });
            });
        }

        logger.info(`[${modName}] Registered mod command: ${options.name}`);
    }

    unregisterCommand(modName: string, commandName: string) {
        const command = this.commands.get(commandName.toLowerCase());
        if (command?.modName === modName) {
            this.commands.delete(commandName.toLowerCase());
            
            if (command.options.aliases) {
                command.options.aliases.forEach(alias => {
                    this.commands.delete(alias.toLowerCase());
                });
            }

            logger.info(`[${modName}] Unregistered mod command: ${commandName}`);
            return true;
        }
        return false;
    }

    unregisterModCommands(modName: string) {
        for (const [name, command] of this.commands.entries()) {
            if (command.modName === modName) {
                this.commands.delete(name);
            }
        }
    }

    private sendMessage(prefix: string, message: string) {
        this.proxy.client.write('chat', {
            message: JSON.stringify({
                text: `${prefix} ${message}`
            }),
            position: 0
        });
    }

    getCommands(modName?: string) {
        const uniqueCommands = new Map();
        for (const command of this.commands.values()) {
            if (!uniqueCommands.has(command.options.name)) {
                uniqueCommands.set(command.options.name, command);
            }
        }
        const commands = Array.from(uniqueCommands.values());
        if (modName) {
            return commands.filter(cmd => cmd.modName === modName);
        }
        return commands;
    }
}
