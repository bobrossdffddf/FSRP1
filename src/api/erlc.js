const axios = require('axios');
const https = require('https');

const API_BASE = 'https://api.policeroleplay.community/v1/server';

const agent = new https.Agent({
    keepAlive: false,
    rejectUnauthorized: false
});

const erlcApi = axios.create({
    baseURL: API_BASE,
    timeout: 15000,
    headers: {
        'Server-Key': process.env.ERLC_API_KEY,
        'Content-Type': 'application/json'
    },
    httpsAgent: agent
});

/**
 * Extracts just the username from the PRC API's "Username:RobloxId" format
 */
function getPlayerName(playerField) {
    if (!playerField) return '';
    // The API returns "Username:RobloxId" - we only want the username
    const parts = playerField.split(':');
    return parts[0];
}

/**
 * Extracts just the Roblox ID from the PRC API's "Username:RobloxId" format
 */
function getPlayerId(playerField) {
    if (!playerField) return '';
    const parts = playerField.split(':');
    return parts.length > 1 ? parts[1] : '';
}

function checkKey() {
    if (!process.env.ERLC_API_KEY) {
        throw new Error('ERLC_API_KEY is missing from .env');
    }
}

async function getServerInfo() {
    checkKey();
    try {
        const res = await erlcApi.get('/');
        return res.data;
    } catch (error) {
        console.error('Error fetching ERLC server info:', error.message);
        return null;
    }
}

async function getPlayers() {
    checkKey();
    try {
        const res = await erlcApi.get('/players');
        return res.data;
    } catch (error) {
        console.error('Error fetching ERLC players:', error.message);
        return [];
    }
}

async function runCommand(command) {
    checkKey();

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            const res = await erlcApi.post('/command', { command });
            return res.data;
        } catch (error) {
            const status = error.response?.status;
            const isRateLimited = status === 429;

            if (isRateLimited && attempt < maxAttempts) {
                const retryAfterHeader = Number(error.response?.headers?.['retry-after']);
                const retryAfterMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
                    ? retryAfterHeader * 1000
                    : 1200 * attempt;

                console.warn(`ERLC command rate-limited (${command}). Retrying in ${retryAfterMs}ms (attempt ${attempt}/${maxAttempts})`);
                await new Promise(resolve => setTimeout(resolve, retryAfterMs));
                continue;
            }

            console.error('Error running ERLC command (' + command + '):', error.message);
            return null;
        }
    }

    return null;
}

async function pmPlayer(player, message) {
    const username = getPlayerName(player);
    return runCommand(':pm ' + username + ' ' + message);
}

async function jailPlayer(player, reason = '') {
    const username = getPlayerName(player);
    let cmd = ':jail ' + username;
    if (reason) {
        cmd += ' ' + reason;
    }
    return runCommand(cmd);
}

async function getModCalls() {
    checkKey();
    try {
        const res = await erlcApi.get('/modcalls');
        return Array.isArray(res.data) ? res.data : [];
    } catch (error) {
        console.warn('Error fetching ERLC mod calls:', error.message);
        return [];
    }
}

module.exports = {
    getServerInfo,
    getPlayers,
    getModCalls,
    runCommand,
    pmPlayer,
    jailPlayer,
    getPlayerName,
    getPlayerId
};
