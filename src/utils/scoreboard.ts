import PrismarineChat from 'prismarine-chat';
import type Player from '../player/player.js';
import { colorString } from './other.js';

const sortItems = (a: any, b: any) => {
	if (a.value < b.value) return -1;
	if (a.value > b.value) return 1;
	return 0;
};

const loader = (player: Player) => {
	const { Chat } = player;

	class Scoreboard {
		public name: string;

		public title: string;

		public items: any[];

		public static positions: { readonly belowName: any; readonly list: any; readonly sidebar: any };

		public constructor(packet) {
			this.name = packet.name;
			this.setTitle(packet.displayText);
			this.items = [];
		}

		public setTitle(title: string) {
			try {
				this.title = JSON.parse(title).text;
			} catch {
				this.title = title;
			}
		}

		public addItem(name, value) {
			this.items[name] = {
				name,
				value,
				get displayName() {
					if (name in player.teamMap) {
						return player.teamMap[name].displayName(name);
					}

					return new Chat(name);
				},
			};
			return this.items[name];
		}

		public removeItem(name) {
			const removed = this.items[name];
			this.items[name] = undefined;
			return removed;
		}

		public get itemsArray() {
			return Object.values(this.items).sort(sortItems);
		}
	}

	Scoreboard.positions = {
		get list() {
			return this[0];
		},

		get sidebar() {
			return this[1];
		},

		get belowName() {
			return this[2];
		},
	};

	return Scoreboard;
};

export default loader;
