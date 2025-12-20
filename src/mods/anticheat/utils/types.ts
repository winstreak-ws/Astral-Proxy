export type Vec3 = { x: number; y: number; z: number };
export type ItemStack = {
  type: string;
  name: string;
  meta?: number;
};

export interface PlayerState {
  ticksExisted: number;
  lastSwingTick: number;
  lastCrouchedTick: number;
  lastStopCrouchingTick: number;
  lastOnGroundTick: number;
  pitch: number;
  username: string;
  server: string;
  block: string;
  moveYaw: number;
  onGround: boolean;
  lastSwingItem?: ItemStack;
  position?: Vec3;
  lastPosition?: Vec3;
  previousPositions: Vec3[];

  scaffoldA_VL: number;
  scaffoldA_LastAlert: number;
  scaffoldB_VL: number;
  scaffoldB_LastAlert: number;

  noSlow_VL?: number;
  noSlow_LastAlert?: number;

  autoblock_VL?: number;
  autoblock_LastAlert?: number;

  sprinting?: boolean;
  using?: boolean;
  riding?: boolean;
  lastUsingTick?: number;
  lastStopUsingTick?: number;
  lastItemChangeTick?: number;
  sneakState?: boolean;

  heldItem?: ItemStack;
  lastStopUsingItem?: ItemStack;

  swingProgress: number;
  velocity: { x: number, y: number, z: number }
}
