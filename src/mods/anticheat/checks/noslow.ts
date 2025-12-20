import type { PlayerState } from "../utils/types.js";
import { sendMessage, sendPartyMessage } from "../utils/sendMessage.js";
import { logger } from "../../../utils/logger.js";
import { getConfig } from "../../../config/config.js";

let config = getConfig();
setInterval(() => {
  config = getConfig();
}, 5000);

const noSlowMap = new Map<string, { startTime: number | null; isActive: boolean }>();

export function NoSlow(state: PlayerState) {
  const now = Date.now();
  const {
    sprinting = false,
    using = false,
    heldItem,
    username,
  } = state;

  if (!username) return;

  const VL_THRESHOLD = config.violationLevels?.noslow ?? 5;
  const COOLDOWN = (config.anticheatSettings?.cooldown ?? 2) * 1000;

  let data = noSlowMap.get(username);
  if (!data) {
    data = { startTime: null, isActive: false };
    noSlowMap.set(username, data);
  }

  const itemName = heldItem?.name?.toLowerCase() || "";
  const isHoldingConsumable = /(apple|bread|stew|potion|carrot|fish|cookie|melon|chicken|beef|pork|mutton)/.test(itemName);
  const isHoldingBow = /bow/.test(itemName);
  const isHoldingSword = /sword/.test(itemName);

  const isUsingSlowdownItem =
    using && (isHoldingConsumable || isHoldingBow || isHoldingSword);

  const isCurrentlyNoSlow = isUsingSlowdownItem && sprinting;

  if (isCurrentlyNoSlow) {
    if (!data.isActive) {
      data.startTime = now;
      data.isActive = true;
    }

    const noSlowDuration = now - (data.startTime ?? 0);
    if (noSlowDuration >= 500) {
      let vl = state.noSlow_VL ?? 0;
      const lastAlert = state.noSlow_LastAlert ?? 0;

      vl += 2;

      if (vl >= VL_THRESHOLD && now - lastAlert > COOLDOWN) {
        state.noSlow_LastAlert = now;
        if (config.anticheatSettings.alertSelf && config.anticheatSettings.noslow) {
          sendMessage(username, "NoSlow", vl);
        }
        if (config.anticheatSettings.alertParty && config.anticheatSettings.noslow) {
          sendPartyMessage(username, "NoSlow", vl);
        }
        logger.debug(`[Astral] ${username} was detected for NoSlow VL=${vl}`);
      }

      state.noSlow_VL = vl;
    }
  } else {
    data.isActive = false;
    data.startTime = null;
    state.noSlow_VL = Math.max((state.noSlow_VL ?? 0) - 1, 0);
  }
}
