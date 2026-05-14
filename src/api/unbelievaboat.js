const axios = require('axios');

const BASE_URL = 'https://unbelievaboat.com/api/v1';

const getHeaders = () => {
    const apiKey = process.env.UNBELIEVABOAT_API_KEY;

    if (!apiKey) {
        throw new Error('Missing UNBELIEVABOAT_API_KEY in environment variables.');
    }

    return {
        Authorization: apiKey,
        'Content-Type': 'application/json'
    };
};

const getUserBalance = async (guildId, userId) => {
    const response = await axios.get(`${BASE_URL}/guilds/${guildId}/users/${userId}`, {
        headers: getHeaders(),
        timeout: 15000
    });

    return response.data;
};

const editUserBalance = async (guildId, userId, changes, reason) => {
    const payload = {
        ...changes,
        reason
    };

    const response = await axios.patch(`${BASE_URL}/guilds/${guildId}/users/${userId}`, payload, {
        headers: getHeaders(),
        timeout: 15000
    });

    return response.data;
};

module.exports = {
    getUserBalance,
    editUserBalance
};
