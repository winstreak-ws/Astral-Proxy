declare module 'typed-emitter' {
	import type { EventMap } from 'typed-emitter';
	import type TypedEventEmitter from 'typed-emitter';

	export type TypedEmitter<T extends EventMap> = TypedEventEmitter.default<T>;
}

export { type EventMap, default } from 'typed-emitter';
