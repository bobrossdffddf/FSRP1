const axios = require('axios');

const USERS_API  = 'https://users.roblox.com/v1/users';
const THUMB_API  = 'https://thumbnails.roblox.com/v1/users/avatar-headshot';

async function getRobloxUser(robloxId) {
    try {
        const res = await axios.get(`${USERS_API}/${robloxId}`, { timeout: 8000 });
        return res.data; // { id, name, displayName, created, description, ... }
    } catch (err) {
        console.warn(`[Roblox] Failed to get user ${robloxId}: ${err.message}`);
        return null;
    }
}

async function getRobloxHeadshot(robloxId) {
    try {
        const res = await axios.get(THUMB_API, {
            params: { userIds: robloxId, size: '150x150', format: 'Png', isCircular: false },
            timeout: 8000,
        });
        const item = res.data?.data?.[0];
        return item?.state === 'Completed' ? item.imageUrl : null;
    } catch (err) {
        console.warn(`[Roblox] Failed to get headshot for ${robloxId}: ${err.message}`);
        return null;
    }
}

module.exports = { getRobloxUser, getRobloxHeadshot };
