import type Player from '../player/player.js';
import type { ModAPI } from './api/ModAPI.js';

type Mod = {
	config: {
		enabled: boolean;
	};
	description: string;
	end(): void;
	init(proxy: Player): void;
	initSettings?(api: ModAPI): void;
	name: string;
	version: string;
};
export default Mod;
