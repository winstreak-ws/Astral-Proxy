import wsClient from '../../data/websocketClient.js';

export default {
    name: 'irc',
    description: 'Manage IRC channel connections',
    version: '1.0.0',
    prefix: '§7[§5Astral§7]§r',
    enabled: true,
    hidden: false,
    options: [
        {
            name: 'action',
            description: 'The action to perform',
            required: true,
            type: 'string',
        },
        {
            name: 'name',
            description: 'The name of the channel',
            required: false,
            type: 'string',
        },
        {
            name: 'password',
            description: 'The password for the channel',
            required: false,
            type: 'string',
        }
    ],
    run: async ({ options, reply }: { options: Map<string, any>; reply: (msg: string) => void }) => {

        const action = options.get('action');
        const name = options.get('name');
        const password = options.get('password');

        if (action === 'join') {

            if (!name) {
                wsClient.joinIrc('General');
                return;
            }

            wsClient.joinIrc(name, password);
        } else if (action === 'leave') {
            wsClient.leaveIrc();
        } else {
            reply('§cInvalid action. Use "join <channel> <password>" or "leave".');
        }

    }
}