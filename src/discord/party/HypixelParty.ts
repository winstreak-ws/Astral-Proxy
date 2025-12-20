export abstract class HypixelParty {
  constructor(
    public readonly join_secret: string,
    public readonly discord: string,
    public readonly uuid: string
  ) {}

  get data() {
    return {
      join_secret: this.join_secret,
      discord: this.discord,
      uuid: this.uuid,
    };
  }
}