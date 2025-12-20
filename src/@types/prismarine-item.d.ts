declare module 'prismarine-item' {
	import type { Item } from 'prismarine-item';

	type PrismarineItemConstructor = (registryOrVersion: object | string) => Item;
	declare const constructor: PrismarineItemConstructor;

	export = constructor;
}

export { Item } from 'prismarine-item';
