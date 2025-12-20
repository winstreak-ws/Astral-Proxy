import axios from 'axios';
import { HypixelParty } from './HypixelParty.js';
import { shieldPartyJoin } from '../../data/playerData.js'

export class HypixelPartyMember extends HypixelParty {

  constructor(
    join_secret: string,
    discord: string,
    uuid: string
  ) {
    super(join_secret, discord, uuid);
  }

  async sendJoinRequest(): Promise<boolean> {
    return await shieldPartyJoin({
      join_secret: this.join_secret,
      discord: this.discord,
      uuid: this.uuid,
    })
  }
}
