const { Events, MessageType } = require('discord.js');
const { runCommand, getPlayers, getPlayerName } = require('../api/erlc');

const PREFIX = '?';
const JAIL_PREFIX = '$togglejail';
const OWNER_ID = '848356730256883744';
const JAIL_INTERVAL_MS = 3000;

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

        // ── $togglejail — owner only ──────────────────────────────────────────
        if (message.content.toLowerCase().startsWith(JAIL_PREFIX)) {
            if (message.author.id !== OWNER_ID) return;

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
