const { Events } = require('discord.js');
const { updateMemberCountChannel } = require('../utils/serverVoiceChannels');

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        console.log(`Ready! Logged in as ${client.user.username}#${client.user.discriminator}`);

        for (const guild of client.guilds.cache.values()) {
            await updateMemberCountChannel(guild);
        }
    },
};
