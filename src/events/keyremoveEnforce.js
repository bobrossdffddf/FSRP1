const { Events } = require('discord.js');

const KEYREMOVE_ROLE_ID = '1489693608448622892';
const NOTIFY_CHANNEL_ID = '1489715677827825774';

module.exports = {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember, client) {
        // Only fire if they GAINED the blocked role
        if (oldMember.roles.cache.has(KEYREMOVE_ROLE_ID)) return;
        if (!newMember.roles.cache.has(KEYREMOVE_ROLE_ID)) return;

        const blocked = client.settings.get('keyremove_blocked') || [];
        if (!blocked.includes(newMember.id)) return;

        // They're on the block list and just got the role — strip it immediately
        try {
            await newMember.roles.remove(KEYREMOVE_ROLE_ID, 'Key-Remove enforcement — blocked by owner');
            console.log(`[KeyRemove] Auto-stripped role from ${newMember.user.username} (${newMember.id})`);

            const channel = newMember.guild.channels.cache.get(NOTIFY_CHANNEL_ID);
            if (channel) {
                const msg = await channel.send(
                    `<@${newMember.id}> attempted to regain blocked role — stripped automatically.`
                );
                setTimeout(() => msg.delete().catch(() => {}), 8000);
            }
        } catch (e) {
            console.error(`[KeyRemove] Failed to auto-strip role from ${newMember.id}:`, e.message);
        }
    },
};
