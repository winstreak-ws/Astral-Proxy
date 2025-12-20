import axios from 'axios';
import { getConfig, setConfig } from '../config/config.js';

/**
 * Get the entire config file.
 * @return The full config object.
 */
export function getFullConfig() {
    return getConfig();
}

/**
 * Replace the entire config file with a new one.
 * @param newConfig 
 */
export function updateFullConfig(newConfig: any) {
    setConfig(newConfig);
}


/**
 * Change a single field in the config file.
 * @param field Field name. Fox example: tabStatsSettings.stats.finals
 * @param value New value for the field.
 */
export function updateSingleConfigField(field: string, value: any) {
    const config = getConfig();
    const fieldParts = field.split('.');
    let current: any = config;

    for (let i = 0; i < fieldParts.length - 1; i++) {
        const part = fieldParts[i];
        if (!(part in current)) {
            current[part] = {};
        }
        current = current[part];
    }
    current[fieldParts[fieldParts.length - 1]] = value;
    setConfig(config);
}

/**
 * Sends a request to the server that the user want to authenticate for the first time.
 * Used to fetch the users API key from the server.
 */
export async function requestAuthFromServer(baseUrl = 'https://astral.winstreak.ws'): Promise<string> {
    const response = await axios.post(`${baseUrl}/api/request-auth`, {
        headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'WinstreakProxy'
        }
    });

    if (response.status !== 200) {
        throw new Error(`Failed to request auth from server: ${response.statusText}`);
    }

    return response.data.code;
}