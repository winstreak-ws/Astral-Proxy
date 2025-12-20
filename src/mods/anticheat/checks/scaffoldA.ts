import type { PlayerState } from '../utils/types.js';
import { logger } from '../../../utils/logger.js';
import { sendMessage, sendPartyMessage } from '../utils/sendMessage.js'

import { getConfig } from '../../../config/config.js';
let config = getConfig()

setInterval(async () => {
  config = getConfig();
}, 5000);


const COOLDOWN = config.anticheatSettings.cooldown * 1000
const VL_THRESHOLD = config.violationLevels.legitScaffold || 5;

function clientTime() {
  return Date.now();
}

function strip(text: string): string {
  return text.replace(/§[0-9a-fk-or]/gi, '');
}

export function ScaffoldA(state: PlayerState, world: { scoreboard: string[] }) {
  const now = clientTime();

  const {
    lastStopCrouchingTick = 0,
    ticksExisted,
    lastSwingTick = 0,
    block = "hand",
    lastCrouchedTick = 0,
    onGround = false,
    pitch,
    lastSwingItem,
    previousPositions = [],
    username,
    server,
  } = state;

  const holdingBlocks = block == "block"
  const lookingDown = pitch >= 70;


  let grounded = onGround;

  if (
    lookingDown &&
    holdingBlocks &&
    lastStopCrouchingTick >= ticksExisted - 1 &&
    lastStopCrouchingTick - lastCrouchedTick <= 3 &&
    lastSwingTick >= ticksExisted - 5
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
      state.scaffoldA_VL++;
      if (state.scaffoldA_VL >= VL_THRESHOLD && now - state.scaffoldA_LastAlert > COOLDOWN) {
        state.scaffoldA_LastAlert = now;
        if (config.anticheatSettings.alertSelf && config.anticheatSettings.legitScaffold) {
          sendMessage(username, 'Legit Scaffold', state.scaffoldA_VL);
        }
        if (config.anticheatSettings.alertParty && config.anticheatSettings.legitScaffold) {
          sendPartyMessage(username, 'Legit Scaffold', state.scaffoldA_VL);
        }
        logger.debug(`[Astral] ${state.username} was detected for Legit Scaffold VL=${state.scaffoldA_VL}`);
      }
    }
  } else if (
    !lookingDown ||
    !holdingBlocks ||
    ticksExisted - lastStopCrouchingTick > 20 ||
    ticksExisted - lastSwingTick > 20 ||
    (onGround && lastSwingTick === ticksExisted && lastStopCrouchingTick < ticksExisted - 1)
  ) {
    state.scaffoldA_VL = Math.max(state.scaffoldA_VL - 1, 0);
  }
}
