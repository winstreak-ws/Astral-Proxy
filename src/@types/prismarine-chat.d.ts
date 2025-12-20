declare module 'prismarine-chat' {
	import type { ChatMessage } from 'prismarine-chat';

	type PrismarineChatConstructor = (registryOrVersion: object | string) => typeof ChatMessage;
	declare const constructor: PrismarineChatConstructor;

	export = constructor;
}

export { ChatMessage } from 'prismarine-chat';
