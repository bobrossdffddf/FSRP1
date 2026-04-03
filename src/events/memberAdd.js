const { Events } = require('discord.js');

const AUTO_ROLE_ID = '1489733107006312558';

module.exports = {
    name: Events.GuildMemberAdd,
    async execute(member) {
        try {
            await member.roles.add(AUTO_ROLE_ID);
            console.log(`[AutoRole] Gave role ${AUTO_ROLE_ID} to ${member.user.tag} (${member.user.id})`);
        } catch (e) {
            console.error(`[AutoRole] Failed to assign role to ${member.user.tag}:`, e.message);
        }
    },
};
