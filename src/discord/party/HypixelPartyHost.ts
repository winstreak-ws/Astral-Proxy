import axios from 'axios';
import crypto from 'crypto';
import { HypixelParty } from './HypixelParty.js';
import { shieldPartyConfirmInvite, shieldPartyPending } from '../../data/playerData.js'

export class HypixelPartyHost extends HypixelParty {

  constructor(discord: string, uuid: string) {
    super(
      crypto.randomBytes(32).toString('hex'),
      discord,
      uuid
    );
  }

  async confirmInvite(targetDiscordId: string): Promise<boolean> {
    return await shieldPartyConfirmInvite(this.join_secret, targetDiscordId)
  }

  async getPendingJoins(): Promise<{ discord: string; uuid: string }[]> {
    return await shieldPartyPending(this.join_secret)
  }
}
