const { Events } = require('discord.js');
const { updateMemberCountChannel } = require('../utils/serverVoiceChannels');

module.exports = {
    name: Events.GuildMemberRemove,
    async execute(member) {
        await updateMemberCountChannel(member.guild);
    },
};
