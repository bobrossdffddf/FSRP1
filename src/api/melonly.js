const axios = require('axios');

const API_BASE = 'https://api.melonly.xyz/api/v1';

function getClient() {
    const token = process.env.MELONLY_API_KEY;
    if (!token) throw new Error('MELONLY_API_KEY is not set');
    return axios.create({
        baseURL: API_BASE,
        timeout: 15000,
        headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
        },
    });
}

async function safeGet(path, params = {}) {
    try {
        const client = getClient();
        const res = await client.get(path, { params });
        return res.data;
    } catch (error) {
        const status = error.response?.status;
        const msg = error.response?.data?.error || error.message;
        console.warn(`[Melonly] GET ${path} failed (${status}): ${msg}`);
        return null;
    }
}

async function getServerInfo() {
    return safeGet('/server/info');
}

async function getServerShifts(page = 1, limit = 50) {
    return safeGet('/server/shifts', { page, limit });
}

async function getShiftsForMember(memberId, page = 1, limit = 50) {
    return safeGet(`/server/shifts/user/${memberId}`, { page, limit });
}

async function getServerLogs(page = 1, limit = 50) {
    return safeGet('/server/logs', { page, limit });
}

async function getLogsForStaff(staffId, page = 1, limit = 50) {
    return safeGet(`/server/logs/staff/${staffId}`, { page, limit });
}

async function getLogsForUser(username, page = 1, limit = 50) {
    return safeGet(`/server/logs/user/${username}`, { page, limit });
}

async function getMemberByDiscordId(discordId) {
    return safeGet(`/server/members/discord/${discordId}`);
}

async function getServerMembers(page = 1, limit = 100) {
    return safeGet('/server/members', { page, limit });
}

async function getServerRoles(page = 1, limit = 100) {
    return safeGet('/server/roles', { page, limit });
}

async function getServerLoas(page = 1, limit = 50) {
    return safeGet('/server/loas', { page, limit });
}

async function getLeasForMember(memberId) {
    return safeGet(`/server/loas/user/${memberId}`);
}

async function getAuditLogs(page = 1, limit = 50) {
    return safeGet('/server/audit-logs', { page, limit });
}

module.exports = {
    getServerInfo,
    getServerShifts,
    getShiftsForMember,
    getServerLogs,
    getLogsForStaff,
    getLogsForUser,
    getMemberByDiscordId,
    getServerMembers,
    getServerRoles,
    getServerLoas,
    getLeasForMember,
    getAuditLogs,
};
