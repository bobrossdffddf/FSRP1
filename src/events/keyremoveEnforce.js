const { Events } = require('discord.js');

const NOTIFY_CHANNEL_ID = '1489715677827825774';

module.exports = {
    name: Events.GuildMemberUpdate,
    async execute(oldMember, newMember, client) {
        // Find any roles the member just gained
        const gained = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id));
        if (gained.size === 0) return;

        const blocked = client.settings.get('keyremove_blocked') || [];
        if (blocked.length === 0) return;

        for (const [roleId] of gained) {
            const entry = blocked.find(e => e.roleId === roleId && e.userId === newMember.id);
            if (!entry) continue;

            // This user is blocked from having this role — strip it immediately
            try {
                await newMember.roles.remove(roleId, 'Key-Remove enforcement — blocked');
                console.log(`[KeyRemove] Auto-stripped role ${roleId} from ${newMember.user.username} (${newMember.id})`);

                const channel = newMember.guild.channels.cache.get(NOTIFY_CHANNEL_ID);
                if (channel) {
                    const msg = await channel.send(
                        `<@${newMember.id}> attempted to regain <@&${roleId}> — stripped automatically.`
                    );
                    setTimeout(() => msg.delete().catch(() => {}), 8000);
                }
            } catch (e) {
                console.error(`[KeyRemove] Failed to auto-strip role ${roleId} from ${newMember.id}:`, e.message);
            }
        }
    },
};
