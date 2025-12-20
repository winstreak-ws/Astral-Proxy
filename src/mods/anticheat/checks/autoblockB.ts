import { sendMessage, sendPartyMessage } from "../utils/sendMessage.js";
import { logger } from "../../../utils/logger.js";
import { getConfig } from "../../../config/config.js";
import type { PlayerState } from "../utils/types.js";

let config = getConfig();
setInterval(() => {
  config = getConfig();
}, 5000);

interface SwingRecord {
  time: number;
  wasBlockingBefore: boolean;
  wasBlockingAfter: boolean | null;
}

const swingHistoryMap = new Map<string, SwingRecord[]>();
const blockingStartMap = new Map<string, number>();
const isBlockingMap = new Map<string, boolean>();
const lastSwingDetectedMap = new Map<string, number>();

const SWING_DEBOUNCE = 100;
const BLOCKING_MIN_DURATION = 150; 
const BLOCKING_AFTER_WINDOW_MIN = 150; 
const BLOCKING_AFTER_WINDOW_MAX = 200; 
const RECENT_SWING_WINDOW = 1000; 
const REQUIRED_BLOCKED_SWINGS = 2; 

export function AutoBlockB(state: PlayerState) {
  const now = Date.now();
  const {
    swingProgress = 0,
    using = false,
    heldItem,
    username
  } = state;

  if (!username) return;

  const VL_THRESHOLD = config.anticheatSettings?.autoBlockVL ?? 5;
  const COOLDOWN = config.anticheatSettings?.autoBlockCooldown ?? 10000;

  let swingHistory = swingHistoryMap.get(username);
  if (!swingHistory) {
    swingHistory = [];
    swingHistoryMap.set(username, swingHistory);
  }
  let blockingStartTime = blockingStartMap.get(username) ?? 0;
  let isBlocking = isBlockingMap.get(username) ?? false;
  let lastSwingDetected = lastSwingDetectedMap.get(username) ?? 0;

  const isHoldingSword = !!heldItem?.name?.toLowerCase().includes("sword");

  if (using && isHoldingSword) {
    if (!isBlocking) {
      isBlocking = true;
      blockingStartTime = now;
    }
  } else {
    isBlocking = false;
  }

  const isSwinging = swingProgress > 0;
  if (isSwinging && isHoldingSword && now - lastSwingDetected > SWING_DEBOUNCE) {
    const hasBeenBlockingLongEnough = isBlocking && !!blockingStartTime && (now - blockingStartTime >= BLOCKING_MIN_DURATION);
    swingHistory.push({ time: now, wasBlockingBefore: hasBeenBlockingLongEnough, wasBlockingAfter: null });
    lastSwingDetected = now;
    if (swingHistory.length > 20) swingHistory.shift();
  }

  swingHistory.forEach(swing => {
    if (swing.wasBlockingAfter === null) {
      const timeSinceSwing = now - swing.time;
      if (timeSinceSwing >= BLOCKING_AFTER_WINDOW_MIN && timeSinceSwing <= BLOCKING_AFTER_WINDOW_MAX) {
        swing.wasBlockingAfter = isBlocking;
      } else if (timeSinceSwing > BLOCKING_AFTER_WINDOW_MAX) {
        swing.wasBlockingAfter = false;
      }
    }
  });

  const recentSwings = swingHistory.filter(swing => (now - swing.time < RECENT_SWING_WINDOW) && swing.wasBlockingAfter !== null && isHoldingSword);

  let autoBlockCount = 0;
  recentSwings.forEach(swing => {
    if (swing.wasBlockingBefore && swing.wasBlockingAfter) autoBlockCount++;
  });

  let vl = state.autoblock_VL ?? 0;
  const lastAlert = state.autoblock_LastAlert ?? 0;

  if (autoBlockCount >= REQUIRED_BLOCKED_SWINGS) {
    vl++;
    if (vl >= VL_THRESHOLD && now - lastAlert > COOLDOWN) {
      state.autoblock_LastAlert = now;
      if (config.anticheatSettings.alertSelf && config.anticheatSettings.autoblock) {
        sendMessage(username, "AutoBlock", vl);
      }
      if (config.anticheatSettings.alertParty && config.anticheatSettings.autoblock) {
        sendPartyMessage(username, "AutoBlock", vl);
      }
      logger.debug(`[Astral] ${username} was detected for AutoBlock VL=${vl}`);
    }
  } else {
    vl = Math.max(vl - 1, 0);
  }

  state.autoblock_VL = vl;

  blockingStartMap.set(username, blockingStartTime);
  isBlockingMap.set(username, isBlocking);
  lastSwingDetectedMap.set(username, lastSwingDetected);
}
