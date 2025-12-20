import mcDataLoader from 'minecraft-data';
import type { MicrosoftDeviceAuthorizationResponse, ServerClient, Client } from 'minecraft-protocol';

class OnMSACode {
	public constructor(data: MicrosoftDeviceAuthorizationResponse, client: ServerClient, server: Client) {
		this.onMsaCode(data, client, server);
	}

	public onMsaCode(data: MicrosoftDeviceAuthorizationResponse, client: ServerClient, server: Client) {
		client.write('login', {
			entityId: client.id,
			gameMode: 0,
			dimension: 1,
			difficulty: 0,
			maxPlayers: 20,
			levelType: 'default',
			reducedDebugInfo: false,
			isFlat: true,
		});

		client.write('position', {
			x: 0,
			y: 64,
			z: 0,
			yaw: 0,
			pitch: 0,
			flags: 0,
		});

		const keepAliveInterval = setInterval(() => {
			let keepAliveId = 1;
			client.write('keep_alive', { keepAliveId: keepAliveId++ });
		}, 1_000);

		client.write('chat', {
			message: JSON.stringify({
				text: '',
				strikethrough: false,
				extra: [
					{
						text: '§e[Proxy] Please click the link to authenticate: ',
						strikethrough: false,
					},
					{
						text: `§b${data.verification_uri + '?otc=' + data.user_code}`,
						strikethrough: false,
						clickEvent: {
							action: 'open_url',
							value: `${data.verification_uri + '?otc=' + data.user_code}`,
						},
					},
				],
			}),
		});

		const mcData = mcDataLoader(server.version);

		server.once('login', (data, metadata) => {
			clearInterval(keepAliveInterval);
			let dimension = data.dimension;
			if (mcData.isOlderThan('1.16')) {
				dimension = data.dimension === 0 ? -1 : 0;
			}

			client.write('respawn', { ...data, dimension });
			client.write('respawn', data);
		});
	}
}

export default OnMSACode;
