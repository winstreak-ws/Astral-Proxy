import process from 'node:process';
import Proxy from './proxy/createProxy.js';
import { logger } from './utils/logger.js';
import discordRpc, { discordEvents } from './discord/discordRpc.js';
import chalk from 'chalk';
import express from 'express';
import wsClient from './data/websocketClient.js';

import { getConfig, setConfig, APP_VERSION } from './config/config.js';
import rateLimiter from './data/rateLimiter.js';
import { requestAuthFromServer } from './data/configTools.js';
import axios from 'axios';
import { ensureAssets, getAstralVersionInfo } from './config/assets.js';

let config = getConfig();
rateLimiter.init();
setInterval(async () => { config = getConfig(); }, 5000);

const argv = process.argv.slice(2).map((a) => a.toLowerCase());
const skipClear = argv.includes('--no-clear') || argv.includes('--noclear') || argv.includes('-nc');
const maybeClear = () => { if (!skipClear) console.clear(); };

const loaded = chalk.bold.hex('#800080')('🌑 Astral successfully loaded 🪐');
const loading = chalk.bold.hex('#800080')('🌑 Astral is loading... 🪐');
const loggedIn = chalk.bold.hex('#800080')('🌑 Logged in using Astral 🪐'); // Purple

process.on('uncaughtException', (err) => {
	try {
		logger.error('Uncaught Exception:', err?.stack || String(err));
	} catch { /* no-op */ }
});
process.on('unhandledRejection', (reason: any) => {
	try {
		const msg = reason?.stack || (typeof reason === 'object' ? JSON.stringify(reason) : String(reason));
		logger.error('Unhandled Rejection:', msg);
	} catch { /* no-op */ }
});

let keySet = false;
const baseUrl = 'https://astral.winstreak.ws';

ensureAssets().catch(() => { });
let versionMessage = `You are currently on the latest version of Astral. v${APP_VERSION}`;
let usableVersion = true;

async function main() {
	const versionInfo = await getAstralVersionInfo().catch(() => null);

	if (versionInfo) {
		if (versionInfo.latest !== APP_VERSION) {
			versionMessage = `A new version of Astral is available! You are on v${APP_VERSION}, latest is v${versionInfo.latest}. Download at ${versionInfo.versions.find(v => v.id === versionInfo.latest)?.downloadUrl || 'https://astral.winstreak.ws/'}`;
		}
		if (versionInfo.versions.find(v => v.id === APP_VERSION && v.deprecated === true)) {
			versionMessage = `You are using a deprecated version of Astral (v${APP_VERSION}) which is no longer usable. Please update to the latest version at ${versionInfo.versions.find(v => v.id === versionInfo.latest)?.downloadUrl || 'https://astral.winstreak.ws/'} to continue using the proxy.`;
			usableVersion = false;
		}
	}

	if (!usableVersion) {
		maybeClear();
		logger.update(versionMessage);
		logger.info('Astral will now exit.');

		// freeze the process
		while(true) {}
		process.exit(0);
	}

	if (config.General.winstreakKey && config.General.winstreakKey !== '') keySet = true;

	if (!keySet) {
		requestAuthFromServer(baseUrl).catch((e) => {
			logger.error('Failed to request authentication from server:');
			return null;
		}).then(async (res: any) => {

			const authCode = res || null;
			const PORTOPT = [45151, 45152, 45153, 45154, 45155];
			let selectedPort = PORTOPT[0];

			const app = express();

			for (const port of PORTOPT) {
				const isFree = await new Promise((resolve) => {
					const server = app.listen(port, () => resolve(true));
					server.on('error', () => resolve(false));
				});
				if (isFree) {
					selectedPort = port;
					break;
				}
			}

			app.get('/callback', async (req, res) => {
				const token = req.query.token;
				const code = req.query.code;

				if (code !== authCode) {
					res.status(400).send('Invalid code provided.');
					return;
				}

				const response = await axios.get(`${baseUrl}/api/authenticate?token=${token}&code=${code}`).catch((e) => {
					logger.error('Failed to fetch API key from server:', e);
					return null;
				});

				if (!response || response.status !== 200 || !response.data.key) {
					res.status(500).send('Failed to fetch API key from server.');
					return;
				}

				const newConfig = getConfig();
				newConfig.General.winstreakKey = response.data.key;
				setConfig(newConfig);
				keySet = true;

				res.status(200).send('Authentication successful! You can now close this tab and return to the proxy.');
				return;
			});

			if (authCode) {
				logger.info('No Winstreak API key set in config. Please click the link below to authenticate:');
				logger.info(`${baseUrl}/authenticate?code=${authCode}&callback=${encodeURIComponent(`http://localhost:${selectedPort}/callback`)}`);
			} else {
				logger.info('No Winstreak API key set in config. Could not request authentication code from server.');
				logger.info('Please restart the proxy to try again, or manually set your API key in the config file.');
				logger.info('Check server status at https://status.winstreak.ws/ or contact support if the issue persists.');
			}

			while (!keySet) {
				await new Promise((resolve) => setTimeout(resolve, 1000));
				config = getConfig();
			}

			createProxy();
		});
	} else {
		createProxy();
	}
}

// Start the application without top-level await
main().catch((err) => {
	try {
		logger.error('Failed to start Astral:', err?.stack || String(err));
	} catch { /* no-op */ }
});

function createProxy() {
	const proxy = new Proxy(config.General.remoteServerIp, config.General.remoteServerPort, config.General.localServerPort, '1.8.9');
	discordRpc.init();

	maybeClear();
	console.log(loading);

	logger.info(
		'Creating proxy for',
		proxy.host,
		'on port',
		proxy.port,
		'listening on port',
		proxy.listenPort,
		'with version',
		proxy.version,
	);

	proxy.on('start', (client) => {
		logger.info('Client connected:', client.username);
		discordRpc.setProxyConnected(true);
	});

	proxy.on('end', (username) => {
		discordRpc.setProxyConnected(false);
		logger.info('Client disconnected:', username);
	});

	proxy.on('login', (username, uuid) => {
		maybeClear();
		console.log(loggedIn);
		logger.info(`Connected to ${proxy.host}:${proxy.port} as ${username} on minecraft ${proxy.version}.`);
		logger.info(`Change your config at https://astral.winstreak.ws/config.`);
	});

	discordEvents.on('ready', () => {
		maybeClear();
		console.log(loaded);
		console.log(chalk.hex('#AAAAFF')('Access your config at https://astral.winstreak.ws/config'));
		console.log(chalk.hex('#AAAAFF')(`   Connect to localhost:${proxy.listenPort} with Minecraft 1.8.9\n\n`));
		logger.update(versionMessage);
		logger.info(`Proxy ready for ${proxy.host}:${proxy.port} for minecraft ${proxy.version}.`);
		logger.rpc(`Discord RPC successfully connected.`);
	});
}
