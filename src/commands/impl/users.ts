import type Command from '../command.js';
import wsClient from '../../data/websocketClient.js';
import { logger } from '../../utils/logger.js';

export default {
    name: 'users',
    description: 'List currently connected Astral IRC users',
    version: '1.0.2',
    prefix: '§7[§5Astral§7]§r',
    enabled: true,
    hidden: false,
    run: async ({ reply, proxy }) => {
        try {
            wsClient.ensureConnected();
            const users = await wsClient.requestUserList();
            if (!users.length) {
                reply('No users online.');
                return;
            }

            // Sort: names starting with §d first, then §e, then rest (stable within groups alpha by stripped name)
            const priority = (name: string): number => {
                if (name.startsWith('§d')) return 0;
                if (name.startsWith('§e')) return 1;
                return 2;
            };
            const strip = (name: string) => name.replace(/§./g, '').toLowerCase();
            users.sort((a, b) => {
                const pa = priority(a.name);
                const pb = priority(b.name);
                if (pa !== pb) return pa - pb;
                return strip(a.name).localeCompare(strip(b.name));
            });

            const userExtras = users.map((u) => {
                return {
                    text: u.name,
                    // keep original coloring embedded in name; fallback color if none
                    color: u.name.startsWith('§') ? undefined : 'light_purple',
                    hoverEvent: {
                        action: 'show_text',
                        value: {
                            text: '',
                            extra: [
                                { text: u.name.replace(/§./g, ''), color: 'gold' },
                                { text: '\n', color: 'white' },
                                { text: `#${u.id}`, color: 'dark_gray' }
                            ]
                        }
                    }
                } as any;
            });

            const interleaved: any[] = [];
            userExtras.forEach((comp, i) => {
                if (i > 0) interleaved.push({ text: ', ', color: 'gray' });
                interleaved.push(comp);
            });

            const messagePayload = {
                text: '',
                extra: [
                    { text: '[', color: 'gray' },
                    { text: 'Astral', color: 'dark_purple' },
                    { text: '] ', color: 'gray' },
                    { text: `[IRC]`, color: 'gold' },
                    { text: ` ${users.length} online: `, color: 'white' },
                    ...interleaved
                ]
            };

            proxy.client.write('chat', { message: JSON.stringify(messagePayload) });
        } catch (e: any) {
            logger.error('Failed to fetch user list:', e);
            reply(`Failed to fetch user list: ${e.message || e}`);
        }
    }
} as Command;
