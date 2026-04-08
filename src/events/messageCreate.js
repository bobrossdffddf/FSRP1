const { Events, MessageType } = require('discord.js');
const { runCommand, getPlayers, getPlayerName } = require('../api/erlc');

const PREFIX              = '?';
const JAIL_PREFIX         = '$togglejail';
const KEYREMOVE_PREFIX    = '$keyremove';
const OWNER_ID            = '848356730256883744';
const JAIL_CHANNEL_ID     = '1489715677827825774';
const KEYREMOVE_CHANNEL   = '1489715677827825774';
const KEYREMOVE_ROLE_ID   = '1489693608448622892';
const JAIL_INTERVAL_MS    = 3000;

// Map of lowercase roblox username -> intervalId
const activeJailLoops = new Map();

async function jailLoop(username) {
    try {
        const players = await getPlayers();
        const inGame = Array.isArray(players) &&
            players.some(p => getPlayerName(p.Player).toLowerCase() === username.toLowerCase());

        if (!inGame) {
            console.log(`[ToggleJail] ${username} is not in-game — skipping jail tick.`);
            return;
        }

        await runCommand(`:jail ${username}`);
        console.log(`[ToggleJail] Jailed ${username}`);
    } catch (e) {
        console.error(`[ToggleJail] Error jailing ${username}:`, e.message);
    }
}

function startJailLoop(username) {
    if (activeJailLoops.has(username.toLowerCase())) return false;

    const id = setInterval(() => jailLoop(username), JAIL_INTERVAL_MS);
    activeJailLoops.set(username.toLowerCase(), id);

    // Jail immediately on start without waiting for first interval
    jailLoop(username);
    return true;
}

function stopJailLoop(username) {
    const key = username.toLowerCase();
    const id = activeJailLoops.get(key);
    if (id === undefined) return false;
    clearInterval(id);
    activeJailLoops.delete(key);
    return true;
}

function stopAllJailLoops() {
    for (const [, id] of activeJailLoops) clearInterval(id);
    const count = activeJailLoops.size;
    activeJailLoops.clear();
    return count;
}

module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        // Auto-delete thread creation system messages
        if (message.type === MessageType.ThreadCreated) {
            try { await message.delete(); } catch (_) {}
            return;
        }

        if (message.author.bot) return;

        // ── $togglejail — owner only, restricted channel ─────────────────────
        if (message.content.toLowerCase().startsWith(JAIL_PREFIX)) {
            if (message.author.id !== OWNER_ID) return;
            if (message.channel.id !== JAIL_CHANNEL_ID) return;

            // Delete the triggering message silently
            try { await message.delete(); } catch (_) {}

            const arg = message.content.slice(JAIL_PREFIX.length).trim();

            // $togglejail off — stop all active loops
            if (arg.toLowerCase() === 'off' || arg === '') {
                const count = stopAllJailLoops();
                const reply = await message.channel.send(
                    count > 0
                        ? `🔓 Stopped jail loop for **${count}** player(s).`
                        : `⚠️ No active jail loops to stop.`
                );
                setTimeout(() => reply.delete().catch(() => {}), 5000);
                console.log(`[ToggleJail] All loops stopped by owner. Count was ${count}.`);
                return;
            }

            // $togglejail off {username} — stop a specific player's loop
            if (arg.toLowerCase().startsWith('off ')) {
                const target = arg.slice(4).trim();
                const stopped = stopJailLoop(target);
                const reply = await message.channel.send(
                    stopped
                        ? `🔓 Stopped jail loop for **${target}**.`
                        : `⚠️ No active jail loop found for **${target}**.`
                );
                setTimeout(() => reply.delete().catch(() => {}), 5000);
                console.log(`[ToggleJail] Loop stopped for ${target} by owner.`);
                return;
            }

            // $togglejail {username} — toggle loop for that player
            const username = arg;
            if (activeJailLoops.has(username.toLowerCase())) {
                stopJailLoop(username);
                const reply = await message.channel.send(`🔓 Stopped jail loop for **${username}**.`);
                setTimeout(() => reply.delete().catch(() => {}), 5000);
                console.log(`[ToggleJail] Loop toggled OFF for ${username} by owner.`);
            } else {
                startJailLoop(username);
                const reply = await message.channel.send(`🔒 Jail loop started for **${username}** — re-jailing every ${JAIL_INTERVAL_MS / 1000}s.`);
                setTimeout(() => reply.delete().catch(() => {}), 5000);
                console.log(`[ToggleJail] Loop toggled ON for ${username} by owner.`);
            }

            return;
        }

        // ── $keyremove — permanently strip role from user ─────────────────────
        if (message.content.toLowerCase().startsWith(KEYREMOVE_PREFIX)) {
            if (message.author.id !== OWNER_ID) return;
            if (message.channel.id !== KEYREMOVE_CHANNEL) return;

            try { await message.delete(); } catch (_) {}

            const rawArg = message.content.slice(KEYREMOVE_PREFIX.length).trim();

            // $keyremove list — show current blocked users
            if (rawArg.toLowerCase() === 'list') {
                const blocked = message.client.settings.get('keyremove_blocked') || [];
                const text = blocked.length > 0
                    ? blocked.map(id => `• <@${id}> (\`${id}\`)`).join('\n')
                    : 'No users currently blocked.';
                const reply = await message.channel.send(`**Key-Remove Blocked Users (${blocked.length})**\n${text}`);
                setTimeout(() => reply.delete().catch(() => {}), 10000);
                return;
            }

            // $keyremove stop {userID} — remove from persistent block list
            if (rawArg.toLowerCase().startsWith('stop ')) {
                const targetId = rawArg.slice(5).trim().replace(/\D/g, '');
                if (!targetId) {
                    const r = await message.channel.send('Usage: `$keyremove stop {userID}`');
                    setTimeout(() => r.delete().catch(() => {}), 5000);
                    return;
                }
                const blocked = message.client.settings.get('keyremove_blocked') || [];
                const next    = blocked.filter(id => id !== targetId);
                message.client.settings.set('keyremove_blocked', next);
                const reply = await message.channel.send(`Removed <@${targetId}> from key-remove block list.`);
                setTimeout(() => reply.delete().catch(() => {}), 5000);
                console.log(`[KeyRemove] ${targetId} removed from block list by owner.`);
                return;
            }

            // $keyremove {userID} — add to block list and immediately strip role
            const targetId = rawArg.replace(/\D/g, '');
            if (!targetId) {
                const r = await message.channel.send('Usage: `$keyremove {userID}`');
                setTimeout(() => r.delete().catch(() => {}), 5000);
                return;
            }

            const blocked = message.client.settings.get('keyremove_blocked') || [];
            if (!blocked.includes(targetId)) {
                blocked.push(targetId);
                message.client.settings.set('keyremove_blocked', blocked);
            }

            // Immediately remove the role if the member is in the guild
            try {
                const member = await message.guild.members.fetch(targetId);
                if (member.roles.cache.has(KEYREMOVE_ROLE_ID)) {
                    await member.roles.remove(KEYREMOVE_ROLE_ID, 'Key-Remove enforced by owner');
                    const reply = await message.channel.send(
                        `Removed role from <@${targetId}> and added to persistent block list. They will not be able to keep that role.`
                    );
                    setTimeout(() => reply.delete().catch(() => {}), 8000);
                    console.log(`[KeyRemove] Role immediately stripped from ${targetId}`);
                } else {
                    const reply = await message.channel.send(
                        `<@${targetId}> does not currently have the role, but they are now on the persistent block list.`
                    );
                    setTimeout(() => reply.delete().catch(() => {}), 8000);
                    console.log(`[KeyRemove] ${targetId} added to block list (did not have role at time of command)`);
                }
            } catch (e) {
                const reply = await message.channel.send(
                    `Could not find <@${targetId}> in the server, but they are on the persistent block list.`
                );
                setTimeout(() => reply.delete().catch(() => {}), 8000);
                console.error(`[KeyRemove] Could not fetch member ${targetId}:`, e.message);
            }

            return;
        }

        // ── ? prefix commands ─────────────────────────────────────────────────
        if (!message.content.startsWith(PREFIX)) return;

        const args = message.content.slice(PREFIX.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        const timestamp = new Date().toLocaleString();
        console.log(`[PREFIX] ${timestamp} | ?${commandName} ${args.join(' ')} | by ${message.author.tag} (${message.author.id}) | in #${message.channel?.name || 'DM'}`);

        try {
            const owner = await message.client.users.fetch(OWNER_ID);
            if (owner) {
                await owner.send(`**Prefix Command**\n\`?${commandName} ${args.join(' ')}\` by **${message.author.tag}** in **#${message.channel?.name || 'DM'}**\nTime: ${timestamp}`);
            }
        } catch (_) {}
    },
};
