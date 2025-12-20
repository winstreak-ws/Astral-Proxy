import type Mod from '../mod.js';
import { logger } from '../../utils/logger.js';
import { ScaffoldA } from '../anticheat/checks/scaffoldA.js';
import { ScaffoldB } from '../anticheat/checks/scaffoldB.js';
import { ScaffoldC } from '../anticheat/checks/scaffoldC.js';
import { NoSlow } from '../anticheat/checks/noslow.js';
import { AutoBlockA } from '../anticheat/checks/autoblockA.js';
import { AutoBlockB} from '../anticheat/checks/autoblockB.js';
import type { PlayerState, Vec3, ItemStack } from '../anticheat/utils/types.js';
import { getItemNameFromId } from '../anticheat/utils/items.js';
import { setProxy } from '../anticheat/utils/sendMessage.js';

function convertPitch(pitchByte: number): number {
  return pitchByte * (180 / 256) * 2;
}

function convertYaw(yawByte: number): number {
  return yawByte * (180 / 256) * 2;
}

export default {
  name: 'anticheat',
  description: 'Detects players using cheats',
  version: '1.0.0',

  init: (proxy) => {
    const players = new Map<number, PlayerState>();
    logger.debug('Anticheat loaded');
    setProxy(proxy);

    proxy.server.on('packet', (data, meta) => {
      try {
        if (!proxy.entities || !proxy.entity) return;


        const packetEntityId = data.entityId ?? proxy.entity.id;

        let state = players.get(packetEntityId);
        if (!state) {
          state = {
            ticksExisted: 0,
            lastSwingTick: 0,
            lastCrouchedTick: 0,
            lastStopCrouchingTick: 0,
            lastOnGroundTick: 0,
            pitch: 0,
            moveYaw: 0,
            block: 'hand',
            server: 'lobby',
            username: '',
            onGround: true,
            previousPositions: [],
            position: { x: 0, y: 0, z: 0 },
            scaffoldA_VL: 0,
            scaffoldA_LastAlert: 0,
            scaffoldB_VL: 0,
            scaffoldB_LastAlert: 0,
            noSlow_VL: 0,
            noSlow_LastAlert: 0,
            using: false,
            riding: false,
            sprinting: false,
            lastUsingTick: 0,
            lastStopUsingTick: 0,
            lastItemChangeTick: 0,
            heldItem: undefined,
            lastStopUsingItem: undefined,
            swingProgress: 0,
            sneakState: false,
            velocity: { x: 0, y: 0, z: 0 }
          };
          players.set(packetEntityId, state);
        }

        state.server = proxy.hypixel.server?.serverType || 'lobby';
        state.ticksExisted++;

        const entities = proxy.entities as Record<number, any>;
        const entity = entities[packetEntityId];
        if (!entity) return;
        state.username = entity.username;

        if (meta.name === 'animation' && data.entityId === packetEntityId && data.animation === 0) {
          state.lastSwingTick = state.ticksExisted;
          state.swingProgress = 7
        } else {
          state.swingProgress = Math.max(0.0, state.swingProgress! - 1);
        }



        if (meta.name === 'entity_metadata' && data.entityId === packetEntityId) {
          const metadata = data.metadata;


          for (const metaEntry of metadata) {
            if (metaEntry.key === 0 && typeof metaEntry.value === 'number') {
              const flags = metaEntry.value;
              const isSneaking = (flags & 0x02) !== 0;
              state.lastCrouchedTick = isSneaking ? state.ticksExisted : state.lastCrouchedTick;
              state.lastStopCrouchingTick = !isSneaking ? state.ticksExisted : state.lastStopCrouchingTick;
              state.sneakState = isSneaking
            }

            if (metaEntry.key === 0 && metaEntry.type === 0) {
              const value = metaEntry.value;

              const usingItem = value === 80;
              const released = value === 64;

              if (usingItem) {
                state.lastUsingTick = state.ticksExisted;
                state.using = true;
              }
              if (released) {
                state.lastStopUsingTick = state.ticksExisted;
                state.lastStopUsingItem = state.heldItem;
                state.using = false;
              }

              const flags = value;
              state.sprinting = (flags & 0x08) !== 0;
              state.riding = (flags & 0x40) !== 0;
            }
          }
        }

        if (meta.name === 'entity_velocity' && data.entityId === packetEntityId) {
          state.velocity = {
            x: data.velocityX / 8000,
            y: data.velocityY / 8000,
            z: data.velocityZ / 8000,
          };
        }

        if (meta.name === 'entity_teleport') {
          state.position = { x: data.x, y: data.y, z: data.z };
          state.previousPositions.unshift(state.position);
          if (state.previousPositions.length > 20) state.previousPositions.pop();
        } else if (meta.name === 'rel_entity_move') {
          if (state.position) {
            state.position.x += data.dX;
            state.position.y += data.dY;
            state.position.z += data.dZ;
            state.previousPositions.unshift(state.position);
            if (state.previousPositions.length > 20) state.previousPositions.pop();
          }
        }
        if (meta.name === 'entity_look' || meta.name === 'rel_entity_move_look' || meta.name === 'entity_teleport') {
          state.pitch = convertPitch(data.pitch);
          if (data.yaw !== undefined) {
            state.moveYaw = convertYaw(data.yaw);
          }
          if (data.x !== undefined && data.y !== undefined && data.z !== undefined) {
            state.position = { x: data.x, y: data.y, z: data.z };
            state.previousPositions.unshift(state.position);
            if (state.previousPositions.length > 20) state.previousPositions.pop();
          }
        }

        if (meta.name === 'rel_entity_move') {
          state.onGround = data.onGround;
        }

        if (meta.name === 'entity_equipment') {
          if (data.slot === 0 && data.item) {
            const blockId = data.item.blockId ?? -1;
            const itemCount = data.item.itemCount ?? 1;
            const itemDamage = data.item.itemDamage ?? 0;
            const nbtData = data.item.nbtData;

            const name = getItemNameFromId(blockId) ?? 'unknown';
            const metaValue = itemDamage;

            state.heldItem = {
              type: blockId >= 0 && blockId < 256 ? 'block' : 'hand/item',
              name,
              meta: metaValue,
            };

            if (blockId >= 0 && blockId < 256) {
              state.block = 'block';
            } else {
              state.block = 'hand/item';
            }

            state.lastItemChangeTick = state.ticksExisted;
          }
        }

        if (meta.name === 'entity_status' && data.entityId === packetEntityId) {
          if ('swingProgress' in data) {
            state.swingProgress = data.swingProgress;
          } else {
            state.swingProgress = 0;
          }
        }

        //@ts-ignore
        ScaffoldA(state);
        ScaffoldB(state);
        NoSlow(state);
        AutoBlockA(state);
        AutoBlockB(state);
        ScaffoldC(state);

      } catch (err) {
        logger.error('[anticheat] Error processing packet:', err);
      }
    });
  },
} as Mod;
