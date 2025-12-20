declare module 'prismarine-entity' {
	type PrismarineEntityConstructor = (registryOrVersion: object | string) => Entity;
	declare const constructor: PrismarineEntityConstructor;

	export = constructor;
}
