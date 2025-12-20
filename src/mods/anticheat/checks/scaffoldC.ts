import type { PlayerState } from '../utils/types.js';
import { logger } from '../../../utils/logger.js';
import { sendMessage, sendPartyMessage } from '../utils/sendMessage.js';
import { getConfig } from '../../../config/config.js';

let config = getConfig();
setInterval(() => { config = getConfig(); }, 5000);

export function ScaffoldC(state: PlayerState) {
  const now = Date.now();
  const {
    username,
    pitch = 0,
    swingProgress = 0,
    velocity,
    position,
    previousPositions = [],
    block = 'hand'
  } = state;

  if (!username) return;

  const VL_THRESHOLD = config.violationLevels?.legitScaffold ?? 5;
  const COOLDOWN = (config.anticheatSettings?.cooldown ?? 10) * 1000;

  const isHoldingBlock = block === 'block' || (state.heldItem?.name && /(block|wool|plank|stone|brick|slab|glass)/i.test(state.heldItem.name));
  const isLookingDown = pitch >= 25;
  const horizontalSpeed = (() => {
    if (velocity) {
      return Math.sqrt((velocity.x || 0) ** 2 + (velocity.z || 0) ** 2);
    }
    const len = previousPositions.length;
    if (len >= 2) {
      const a = previousPositions[len - 2];
      const b = previousPositions[len - 1];
      const dx = (b.x - a.x);
      const dz = (b.z - a.z);
      return Math.sqrt(dx * dx + dz * dz);
    }
    return 0;
  })();
  const isPlacingBlocks = swingProgress > 0 && isHoldingBlock;
  const isMovingFast = horizontalSpeed > 5.0; 
  const lastCrouchedTick = (state as any).lastCrouchedTick as number | undefined;
  const ticksExisted = (state as any).ticksExisted as number | undefined;
  const crouchRecently = lastCrouchedTick !== undefined && ticksExisted !== undefined && (ticksExisted - lastCrouchedTick) <= 1;
  const isNotSneaking = !crouchRecently;
  const verticalVelocity = velocity?.y ?? (previousPositions.length >= 2 ? (previousPositions[previousPositions.length - 1].y - previousPositions[previousPositions.length - 2].y) : 0);
  const isFlat = Math.abs(verticalVelocity) < 0.1;
  const isLikelyDead = (position && typeof position.y === 'number' && position.y > 100) ? true : false;

  if (isLikelyDead) {
    state.scaffoldA_VL = Math.max((state.scaffoldA_VL ?? 0) - 1, 0);
    return;
  }

  const isScaffold = isLookingDown && isPlacingBlocks && isMovingFast && isNotSneaking && isFlat;

  let vl = state.scaffoldA_VL ?? 0;
  const lastAlert = state.scaffoldA_LastAlert ?? 0;

  if (isScaffold) {
    vl += 1;
    if (vl >= VL_THRESHOLD && (now - lastAlert) > COOLDOWN) {
      state.scaffoldA_LastAlert = now;
      if (config.anticheatSettings?.alertSelf && config.anticheatSettings?.legitScaffold) {
        sendMessage(username, 'Legit Scaffold', vl);
      }
      if (config.anticheatSettings?.alertParty && config.anticheatSettings?.legitScaffold) {
        sendPartyMessage(username, 'Scaffold', vl);
      }
      logger.debug(`[Astral] ${username} was detected for Scaffold VL=${vl}`);
    }
  } else {
    vl = Math.max(vl - 1, 0);
  }

  state.scaffoldA_VL = vl;
}
