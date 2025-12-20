import discordRpc from "../../discord/discordRpc.js";

export default {
    name: 'discordrpc',
    description: '',
    version: '1.0.0',
    prefix: '§7[§5Astral§7]§r',
    enabled: true,
    hidden: true,
    options: [
        {
            name: 'action',
            description: 'The action to perform',
            required: true,
            type: 'string',
        },
        {
            name: 'discordid',
            description: 'The Discord ID of the user',
            required: true,
            type: 'string',
        }
    ],
    run: async ({ options, reply }: { options: Map<string, any>; reply: (msg: string) => void }) => {

        const action = options.get('action');
        const discordId = options.get('discordid');

        if (!action || !discordId) {
            reply('Usage: /wsdiscordrpc <action> <discordid>');
            return;
        }

        if (action === 'invite') {
            if (!discordId) {
                reply('Usage: /a:discordrpc invite <discordid>');
            }
            discordRpc.sendInvite(discordId).then((success) => {
                if (success) reply(`\n§9§l[Discord] §rInvite sent`);
                else reply(`\n§c§l[Discord] §rFailed to send invite`);
            }).catch((err: Error) => {
                reply(`\n§c§l[Discord] §rFailed to send invite`);
            });
        }

    }
}