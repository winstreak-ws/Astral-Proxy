import process from 'node:process';
import chalk from 'chalk';

type LogLevel = 'debug' | 'error' | 'info' | 'warn' | 'chat' | 'update' | 'irc' | 'rpc';

type Styler = (text: string) => string;

const mcColorMap: { [code: string]: Styler } = {
	a: chalk.green,
	b: chalk.cyan,
	c: chalk.red,
	d: chalk.magenta,
	e: chalk.yellow,
	f: chalk.white,
	0: chalk.black,
	1: chalk.blue,
	2: chalk.greenBright,
	3: chalk.cyanBright,
	4: chalk.redBright,
	5: chalk.magentaBright,
	6: chalk.yellowBright,
	7: chalk.gray,
	8: chalk.gray,
	9: chalk.blueBright,
	l: chalk.bold,
	n: chalk.underline,
	o: chalk.italic,
	r: chalk.reset,
};

function parseMinecraftColors(message: string): string {
	const parts = message.split(/(§[0-9a-frlon])/gi);
	let currentStyle: Styler = chalk.reset;
	let output = '';

	for (let part of parts) {
		if (part.startsWith('§')) {
			const code = part[1].toLowerCase();
			if (code === 'r') {
				currentStyle = chalk.reset;
			} else {
				const style = mcColorMap[code];
				if (style) {
					currentStyle = style;
				}
			}
		} else {
			output += currentStyle(part);
		}
	}

	return output;
}

export { parseMinecraftColors };

class Logger {
	private static instance: Logger;
	private debugEnabled: boolean;

	private constructor() {
		this.debugEnabled = process.env.NODE_ENV !== 'production';
	}

	public static getInstance(): Logger {
		if (!Logger.instance) {
			Logger.instance = new Logger();
		}
		return Logger.instance;
	}

	private getTimestamp(): string {
		const now = new Date();
		const hours = now.getHours().toString().padStart(2, '0');
		const minutes = now.getMinutes().toString().padStart(2, '0');
		const seconds = now.getSeconds().toString().padStart(2, '0');
		return `[${hours}:${minutes}:${seconds}]`;
	}

	private formatMessage(level: LogLevel, message: string, ...args: any[]): string {
		const timestamp = this.getTimestamp();
		const formattedArgs = args.map(arg =>
			typeof arg === 'object' ? JSON.stringify(arg) : arg
		).join(' ');

		const colors: Record<LogLevel, string> = {
			debug: '#55FF55',
			info: '#800080',
			warn: '#FFFF55',
			error: '#AA0000',
			chat: '#0000FF',
			update: '#00AAAA',
			irc: '#DEADED',
			rpc: '#DEADED'
		};

		let argText: string;
		if (level === 'update') {
			argText = `${chalk.hex('#808080')('(')}${chalk.hex('#55FF55')(formattedArgs)}${chalk.hex('#808080')(')')}`;
		} else {
			argText = chalk.hex(colors[level])(formattedArgs);
		}

		return `${chalk.hex('#808080')(timestamp)} ${chalk.hex(colors[level])(level.toUpperCase())} ${chalk.hex('#808080')('»')} ${chalk.hex(colors[level])(message)} ${argText}`;
	}


	public debug(message: string, ...args: any[]): void {
		if (!this.debugEnabled) return;
		console.log(this.formatMessage('debug', message, ...args));
	}

	public info(message: string, ...args: any[]): void {
		console.log(this.formatMessage('info', message, ...args));
	}

	public chat(message: string, ...args: any[]): void {
		const formattedMessage = this.formatMessage('chat', message, ...args);
		console.log(parseMinecraftColors(formattedMessage));
	}

	public warn(message: string, ...args: any[]): void {
		console.log(this.formatMessage('warn', message, ...args));
	}

	public error(message: string, ...args: any[]): void {
		console.error(this.formatMessage('error', message, ...args));
	}

	public update(message: string, ...args: any[]): void {
		console.error(this.formatMessage('update', message, ...args));
	}

	public irc(message: string, ...args: any[]): void {
		console.error(this.formatMessage('irc', message, ...args));
	}

	public rpc(message: string, ...args: any[]): void {
		console.error(this.formatMessage('rpc', message, ...args));
	}

	public setDebugEnabled(enabled: boolean): void {
		this.debugEnabled = enabled;
	}
}

export const logger = Logger.getInstance();
