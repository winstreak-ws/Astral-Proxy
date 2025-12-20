import { Buffer } from 'node:buffer';
import type { SupportsFeature } from 'minecraft-data';
import * as conv from '../../utils/converter.js';
import type Player from '../player.js';

const events = {
	player: {
		login: 'login',
		named_entity_spawn: 'named_entity_spawn',
		spawn_entity: 'spawn_entity',
		entity_destroy: 'entity_destroy',
		player_info: 'player_info',
	},
};



const NAMED_ENTITY_HEIGHT = 1.62;
const NAMED_ENTITY_WIDTH = 0.6;
const CROUCH_HEIGHT = NAMED_ENTITY_HEIGHT - 0.08;

const fetchEntity = (id: number, player: Player) =>
	player.entities[id] || (player.entities[id] = new player.Entity(id));

const setEntityData = (entity: any, type: string, entityData: any, entityDataByInternalId: any) => {
	let eData = entityData;
	eData ??= entityDataByInternalId[type];
	if (entityData) {
		entity.type = entityData.type || 'object';
		entity.displayName = entityData.displayName;
		entity.entityType = entityData.id;
		entity.name = entityData.name;
		entity.kind = entityData.category;
		entity.height = entityData.height;
		entity.width = entityData.width;
	} else {
		entity.type = 'other';
		entity.entityType = type;
		entity.displayName = 'unknown';
		entity.name = 'unknown';
		entity.kind = 'unknown';
	}
};

const updateEntityPos = (
	entity: any,
	pos: any,
	supportFeature: (feature: keyof SupportsFeature) => SupportsFeature[keyof SupportsFeature],
) => {
	if (supportFeature('fixedPointPosition')) {
		entity.position.set(pos.x / 32, pos.y / 32, pos.z / 32);
	} else if (supportFeature('doublePosition')) {
		entity.position.set(pos.x, pos.y, pos.z);
	}

	entity.yaw = pos.yaw;
	entity.pitch = pos.pitch;
};

const addNewPlayer = (entityId: number, uuid: string, pos: any, player: Player) => {
	const entity = fetchEntity(entityId, player);
	entity.type = 'player';
	entity.name = 'player';
	entity.username = player.uuidToUsername[uuid];
	entity.uuid = uuid;
	updateEntityPos(entity, pos, player.Registry.supportFeature);
	entity.height = NAMED_ENTITY_HEIGHT;
	entity.width = NAMED_ENTITY_WIDTH;
	if (player.players[entity.username] !== undefined && !player.players[entity.username].entity) {
		player.players[entity.username].entity = entity;
	}

	return entity;
};

const addNewNonPlayer = (entityId: number, uuid: string, entityType: string, pos: any, player: Player) => {
	const entity = fetchEntity(entityId, player);
	const entityData = player.Registry.entities[entityType];
	setEntityData(entity, entityType, entityData, player.entityDataByInternalId);
	updateEntityPos(entity, pos, player.Registry.supportFeature);
	return entity;
};

const parseMetadata = (metadata: any, entityMetadata: any = {}) => {
	if (metadata !== undefined) {
		for (const { key, value } of metadata) {
			entityMetadata[key] = value;
		}
	}

	return entityMetadata;
};

const extractSkinInformation = (properties: any) => {
	if (!properties) {
		return undefined;
	}

	const props = Object.fromEntries(properties.map((ent: any) => [ent.name, ent]));
	if (!props.textures?.value) {
		return undefined;
	}

	const skinTexture = JSON.parse(Buffer.from(props.textures.value, 'base64').toString('utf8'));

	const skinTextureUrl = skinTexture?.textures?.SKIN?.url ?? undefined;
	const skinTextureModel = skinTexture?.textures?.SKIN?.metadata?.model ?? undefined;

	if (!skinTextureUrl) {
		return undefined;
	}

	return { url: skinTextureUrl, model: skinTextureModel };
};

const handlePlayerInfoBitfield = (packet: any, player: Player) => {
	for (const item of packet.data) {
		if (!item.uuid) {
			continue;
		}
		
		let playerObj = player.uuidToUsername[item.uuid] ? player.players[player.uuidToUsername[item.uuid]] : null;
		let newPlayer = false;

		const obj: any = { uuid: item.uuid };

		if (!playerObj) newPlayer = true;
		playerObj = playerObj || obj;

		if (packet.action & 1) {
			obj.username = item.player.name;
			obj.displayName =
				playerObj.displayName || new player.Chat(JSON.parse(`{"text":"","extra": [{"text":"${item.player.name}"}]}`));
			obj.skinData = extractSkinInformation(item.player.properties);
		}

		if (packet.action & 4) {
			obj.gamemode = item.gamemode;
		}

		if (packet.action & 16) {
			obj.ping = item.latency;
		}

		if (item.displayName) {
			obj.displayName = player.Chat.fromNotch(item.displayName);
		} else if (packet.action & 32) {
			obj.displayName = new player.Chat(
				JSON.parse(`{"text":"","extra": [{"text":"${playerObj.username || obj.username}"}]}`),
			);
		}

		if (newPlayer) {
			if (!obj.username) continue;
			player.players[obj.username] = obj;
			playerObj = player.players[obj.username];
			player.uuidToUsername[obj.uuid] = obj.username;
		} else {
			Object.assign(playerObj, obj);
		}

		const playerEntity = Object.values(player.entities).find(
			(ent: any) => ent.type === 'player' && ent.username === playerObj.username,
		);
		playerObj.entity = playerEntity;

		if (playerEntity === player.entity) {
			player.self = playerObj;
		}
	}
};

const handlePlayerInfoLegacy = (packet: any, player: Player) => {
	for (const item of packet.data) {
		if (!item.UUID) {
			continue;
		}
		
		let playerObj = player.uuidToUsername[item.UUID] ? player.players[player.uuidToUsername[item.UUID]] : null;
		if (packet.action === 0) {
			if (playerObj) {
				playerObj.gamemode = item.gamemode;
				playerObj.ping = item.ping;
				playerObj.skinData = extractSkinInformation(item.properties);
				if (item.crypto) {
					playerObj.profileKeys = {
						publicKey: item.crypto.publicKey,
						signature: item.crypto.signature,
					};
				}
			} else {
				player.players[item.name] = {
					username: item.name,
					ping: item.ping,
					uuid: item.UUID,
					displayName: new player.Chat(JSON.parse(`{"text":"","extra": [{"text":"${item.name}"}]}`)),
					skinData: extractSkinInformation(item.properties),
					profileKeys: item.crypto
						? {
								publicKey: item.crypto.publicKey,
								signature: item.crypto.signature,
							}
						: null,
				};

				playerObj = player.players[item.name];

				player.uuidToUsername[item.UUID] = item.name;
			}

			if (item.displayName) {
				playerObj.displayName = player.Chat.fromNotch(item.displayName);
			}

			const playerEntity = Object.values(player.entities).find(
				(ent: any) => ent.type === 'player' && ent.username === item.name,
			);
			playerObj.entity = playerEntity;

			if (playerEntity === player.entity) {
				player.self = playerObj;
			}
		} else if (playerObj) {
			switch (packet.action) {
				case 1:
					playerObj.gamemode = item.gamemode;
					break;
				case 2:
					playerObj.ping = item.ping;
					break;
				case 3:
					playerObj.displayName = item.displayName
						? player.Chat.fromNotch(item.displayName)
						: new player.Chat(JSON.parse(`{"text":"","extra": [{"text":"${playerObj.username}"}]}`));
					break;
				case 4:
					if (playerObj.entity === player.entity) continue;
					playerObj.entity = null;
					Reflect.deleteProperty(player.players, playerObj.username);
					Reflect.deleteProperty(player.uuidToUsername, item.UUID);
					break;
			}
		} else {
			continue;
		}
	}
};

const handlePlayers = (player: Player, packet: any, meta: any) => {
	if (meta.name === 'login') {
		player.hypixel.server = {
			status: 'waiting',
		};
		player.players = {};
		player.entities = {};
		player.uuidToUsername = {};

		player.entity = fetchEntity(packet.entityId, player);
	}

	if (meta.name === 'named_entity_spawn' && packet.playerUUID in player.uuidToUsername) {
		const entity = addNewPlayer(packet.entityId, packet.playerUUID, packet, player);
		entity.dataBlobs = packet.data;
		entity.metadata = parseMetadata(packet.metadata, entity.metadata);
	}

	if (meta.name === 'spawn_entity') {
		const entityData = player.entityDataByInternalId[packet.type];
		if (entityData?.type === 'player') {
			addNewPlayer(packet.entityId, packet.uuid, packet, player);
		} else {
			addNewNonPlayer(packet.entityId, packet.uuid, packet.type, packet, player);
		}
	}

	if (meta.name === 'entity_destroy') {
		for (const entityId of packet.entityIds) {
			const entity = fetchEntity(entityId, player);
			entity.isValid = false;

			if (entity.username && player.players[entity.username]) {
				player.players[entity.username].entity = null;
			}

			Reflect.deleteProperty(player.entities, entityId);
		}
	}

	if (meta.name === 'player_info') {
		if (player.Registry.supportFeature('playerInfoActionIsBitfield')) {
			handlePlayerInfoBitfield(packet, player);
		} else {
			handlePlayerInfoLegacy(packet, player);
		}
	}
};

export { events, handlePlayers };
