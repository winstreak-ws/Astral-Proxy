import type { PlayerState } from '../utils/types.js';
import { logger } from '../../../utils/logger.js';
import { sendMessage, sendPartyMessage } from '../utils/sendMessage.js';

import { getConfig } from '../../../config/config.js';
let config = getConfig()

setInterval(async () => {
  config = getConfig();
}, 5000);

const COOLDOWN = config.anticheatSettings.cooldown * 1000
const VL_THRESHOLD = config.violationLevels.scaffold || 5;

// Not working yet

function clientTime() {
  return Date.now();
}

export function ScaffoldB(state: PlayerState) {
  const now = clientTime();

  const {
    lastStopCrouchingTick = 0,
    lastCrouchedTick,
    ticksExisted,
    lastSwingTick = 0,
    pitch,
    lastSwingItem,
    onGround = false,
    username,
    block = 'hand',
    previousPositions = [],
    server,
    sneakState,
    sprinting,
    swingProgress
  } = state;

  const holdingBlocks = block == "block"
  const lookingDown = pitch >= 70;
  const swinging = state.swingProgress > 0
  const isFast = Math.sqrt(state.velocity.x * state.velocity.x + state.velocity.z * state.velocity.z);
  const isSneaking = state.sneakState

  let grounded = onGround;

  let vl = state.scaffoldB_VL ?? 0;
  const lastAlert = state.scaffoldB_LastAlert ?? 0;

  if (
    lookingDown && swinging && holdingBlocks &&
    ticksExisted - lastStopCrouchingTick >= 1 &&
    isFast && !isSneaking
  ) {
    if (!grounded && server === "REPLAY") {
        const len = previousPositions.length;
        if (len > 1) {
          const n = Math.min(len - 1, 10);
          let sum = 0;
          for (let i = len - n; i < len; i++) {
            const yDiff = Math.abs(previousPositions[i].y - previousPositions[i - 1].y);
            sum += yDiff;
          }
          grounded = (sum / n) <= 0.2;
        }
    }
    if (grounded) {
        vl++;
        if (vl >= VL_THRESHOLD && now - lastAlert > COOLDOWN) {
        state.scaffoldB_LastAlert = now;
        if (config.anticheatSettings.alertSelf && config.anticheatSettings.scaffold) {
          sendMessage(username, 'Scaffold', vl);
        }
        if (config.anticheatSettings.alertParty && config.anticheatSettings.scaffold) {
          sendPartyMessage(username, 'Scaffold', vl);
        }
        logger.debug(`[Astral] ${username} was detected for Scaffold VL=${vl}`);
        }
    }
  } else if (
    !lookingDown ||
    !holdingBlocks ||
    ticksExisted - lastStopCrouchingTick > 50 ||
    ticksExisted - lastSwingTick > 50
  ) {
    vl = Math.max(vl - 1, 0);
  }

  state.scaffoldB_VL = vl;
}
