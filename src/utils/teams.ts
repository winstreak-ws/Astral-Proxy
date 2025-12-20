import type Player from '../player/player.js';
import { colorString } from './other.js';

const loader = (player: Player) => {
	const { Chat, Registry } = player;
	const MessageBuilder = Chat.MessageBuilder;
	return class Team {
		public team: string;

		public name: any;

		public friendlyFire: boolean;

		public nameTagVisibility: string;

		public collisionRule: string;

		public color: string;

		public prefix: any;

		public suffix: any;

		public membersMap: any;

		public constructor(team, name, friendlyFire, nameTagVisibility, collisionRule, formatting, prefix, suffix) {
			this.team = team;
			this.update(name, friendlyFire, nameTagVisibility, collisionRule, formatting, prefix, suffix);
			this.membersMap = [];
		}

		public parseMessage(value) {
			if (Registry.supportFeature('teamUsesChatComponents')) {
				// 1.13+
				return Chat.fromNotch(value);
			} else {
				const result = MessageBuilder.fromString(value, { colorSeparator: '§' });
				if (result === null) {
					return new Chat('');
				}

				return new Chat(result);
			}
		}

		public add(name) {
			this.membersMap.push(name);
			return this.membersMap[this.membersMap.length - 1];
		}

		public remove(name) {
			const removed = this.membersMap.find((member) => member === name);
			this.membersMap = this.membersMap.filter((member) => member !== name);
			return removed;
		}

		public update(name, friendlyFire, nameTagVisibility, collisionRule, formatting, prefix, suffix) {
			this.name = this.parseMessage(name);
			this.friendlyFire = friendlyFire;
			this.nameTagVisibility = nameTagVisibility;
			this.collisionRule = collisionRule;
			this.color = colorString(formatting);
			this.prefix = this.parseMessage(prefix);
			this.suffix = this.parseMessage(suffix);
		}

		public displayName(member) {
			const name = this.prefix.clone();
			name.append(new Chat(JSON.parse(`{"text":${member},"color":${this.color}}`)), this.suffix);
			return name;
		}

		public get members() {
			return this.membersMap;
		}
	};
};

export default loader;
