import type Player from '../player/player.js';

type CommandOptions = {
	description: string;
	name: string;
	options?: string[];
	required: boolean;
	type: 'boolean' | 'number' | 'string' | (string & {});
};

type CommandExecution = (interaction: {
	options: Map<string, string>;
	proxy: Player;
	reply(message: string): void;
}) => void;

type Command = {
	aliases?: string[];
	description: string;
	enabled: boolean;
	hidden: boolean,
	name: string;
	options?: CommandOptions[];
	prefix: string;
	run: CommandExecution;
	version: string;
};
export default Command;
