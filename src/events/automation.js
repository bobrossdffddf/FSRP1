const { Events, PermissionFlagsBits, ActivityType } = require('discord.js');
const { getPlayers, getServerInfo, runCommand, getPlayerName, getPlayerId } = require('../api/erlc');

const vcWarnings = new Map();
const commsWarnings = new Map();

let msgFlip = false;
let lastCacheRefresh = 0;
const CACHE_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const IN_GAME_ROLE_ID = '1489733107006312558';
const STAFF_BYPASS_ROLE_ID = '970917178142498824';

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        console.log(`Polling Manager: Ready. Starting loops...`);

        const guildId = process.env.MAIN_GUILD_ID;
        if (guildId) {
            const guild = client.guilds.cache.get(guildId);
            if (guild) {
                try {
                    await guild.roles.fetch();
                    const role = guild.roles.cache.get(IN_GAME_ROLE_ID);
                    if (role) {
                        console.log(`[Role] In-Game role verified: "${role.name}" (${IN_GAME_ROLE_ID})`);
                    } else {
                        console.error(`[Role] ⚠️  IN_GAME_ROLE_ID ${IN_GAME_ROLE_ID} does NOT exist in guild "${guild.name}". Role assignment will fail every loop. Please verify the role ID.`);
                        const allRoles = guild.roles.cache
                            .filter(r => !r.managed && r.id !== guild.id)
                            .map(r => `  ${r.id} — ${r.name}`)
                            .join('\n');
                        console.log(`[Role] Available roles in "${guild.name}":\n${allRoles}`);
                    }
                } catch (e) {
                    console.error(`[Role] Failed to fetch roles at startup: ${e.message}`);
                }
            }
        }

        const mainLoop = async () => {
            try {
                await runChecks(client);
            } catch (err) {
                console.error('[Main Loop] Unhandled error:', err.message);
            }
            msgFlip = !msgFlip;
            setTimeout(mainLoop, 15 * 1000);
        };

        setTimeout(mainLoop, 2000);
    },
};

function normalizeString(str) {
    if (!str) return '';
    return str.toLowerCase().replace(/\s+/g, ' ').trim();
}

function endPunc() {
    return msgFlip ? '!' : '.';
}

function findDiscordMember(guild, robloxUsername) {
    const normalized = normalizeString(robloxUsername);
    if (!normalized) return null;

    return guild.members.cache.find(m => {
        const nick = normalizeString(m.nickname);
        const globalName = normalizeString(m.user.globalName);
        const username = normalizeString(m.user.username);
        return nick.includes(normalized) || globalName.includes(normalized) || username.includes(normalized);
    });
}

// Send a batched :pm command to multiple players with the same message
async function batchPm(players, message) {
    if (players.length === 0) return;
    const names = players.map(p => getPlayerName(p)).join(',');
    const cmd = `:pm ${names} ${message}`;
    console.log(`[Batch] PM → ${names} | "${message}"`);
    await runCommand(cmd);
}

// Send a batched :jail command to multiple players
async function batchJail(players, reason) {
    if (players.length === 0) return;
    const names = players.map(p => getPlayerName(p)).join(',');
    const cmd = reason ? `:jail ${names} ${reason}` : `:jail ${names}`;
    console.log(`[Batch] JAIL → ${names}${reason ? ` | "${reason}"` : ''}`);
    await runCommand(cmd);
}

async function runChecks(client) {
    const guildId = process.env.MAIN_GUILD_ID;
    if (!guildId) {
        console.log('[Checks] MAIN_GUILD_ID not set');
        return;
    }

    const guild = client.guilds.cache.get(guildId);
    if (!guild) {
        console.log('[Checks] Guild not found');
        return;
    }

    const now = Date.now();
    if (now - lastCacheRefresh > CACHE_REFRESH_INTERVAL_MS) {
        try {
            await guild.members.fetch();
            await guild.roles.fetch();
            lastCacheRefresh = now;
            console.log('[Checks] Guild member and role cache refreshed.');
        } catch (e) {
            console.warn('[Checks] Could not refresh guild cache:', e.message);
        }
    }

    if (!guild.roles.cache.has(IN_GAME_ROLE_ID)) {
        console.error(`[Checks] In-Game role ${IN_GAME_ROLE_ID} not found in guild — skipping role operations this cycle.`);
        return;
    }

    const inGamePlayersResponse = await getPlayers();
    if (!inGamePlayersResponse) {
        console.log('[Checks] Failed to fetch players from API');
        return;
    }
    const inGamePlayers = Array.isArray(inGamePlayersResponse) ? inGamePlayersResponse : [];
    const serverInfo = await getServerInfo();
    const queuePlayers = Number(serverInfo?.QueuePlayers || 0);
    updateBotPresence(client, guild, inGamePlayers.length, queuePlayers);

    const hardcodeBypasses = client.settings.get(guild.id, 'hardcodeBypasses') || [];

    console.log(`[Checks] Active Players: ${inGamePlayers.length} | Guild Cache: ${guild.members.cache.size}`);

    // Buckets for batched ERLC commands
    const vcWarnPlayers   = [];
    const vcJailPlayers   = [];
    const commsWarnPlayers = [];
    const commsJailPlayers = [];

    for (const player of inGamePlayers) {
        const robloxUsername = getPlayerName(player.Player);
        const robloxId = getPlayerId(player.Player);
        const member = findDiscordMember(guild, robloxUsername);

        if (hardcodeBypasses.includes(robloxUsername) || hardcodeBypasses.includes(robloxId)) {
            vcWarnings.delete(robloxUsername);
            commsWarnings.delete(robloxUsername);
            continue;
        }

        if (member) {
            if (!member.roles.cache.has(IN_GAME_ROLE_ID)) {
                try {
                    await member.roles.add(IN_GAME_ROLE_ID);
                    console.log(`[Role] Added In-Game Role to ${member.user.tag} (${robloxUsername})`);
                } catch (e) {
                    console.error(`[Role] Failed to add role to ${member.user.tag}:`, e.message);
                }
            }

            if (member.roles.cache.has(STAFF_BYPASS_ROLE_ID) || member.permissions.has(PermissionFlagsBits.ManageMessages)) {
                vcWarnings.delete(robloxUsername);
                continue;
            }

            if (!member.voice.channelId) {
                const warnings = vcWarnings.get(robloxUsername) || 0;
                if (warnings >= 5) {
                    console.log(`[VC] Queuing jail for ${robloxUsername} (${warnings + 1} warnings exceeded)`);
                    vcJailPlayers.push(player.Player);
                    vcWarnings.delete(robloxUsername);
                } else {
                    console.log(`[VC] Queuing warning for ${robloxUsername} (${warnings + 1}/5)`);
                    vcWarnPlayers.push(player.Player);
                    vcWarnings.set(robloxUsername, warnings + 1);
                }
            } else {
                if (vcWarnings.has(robloxUsername)) {
                    console.log(`[VC] ${robloxUsername} joined VC — warning cleared`);
                    vcWarnings.delete(robloxUsername);
                }
            }
        } else {
            const warnings = commsWarnings.get(robloxUsername) || 0;
            if (warnings >= 6) {
                console.log(`[Comms] Queuing jail for ${robloxUsername} (${warnings + 1} warnings exceeded)`);
                commsJailPlayers.push(player.Player);
                commsWarnings.delete(robloxUsername);
            } else {
                console.log(`[Comms] Queuing warning for ${robloxUsername} (${warnings + 1}/6) — not in comms`);
                commsWarnPlayers.push(player.Player);
                commsWarnings.set(robloxUsername, warnings + 1);
            }
        }
    }

    // Fire all batched commands (one per action type, no per-player sleep needed)
    const punc = endPunc();
    if (vcWarnPlayers.length > 0) {
        await batchPm(vcWarnPlayers, `You are in our comms but not in a Voice Channel${punc} Please join a VC to continue RPing${punc}`);
    }
    if (vcJailPlayers.length > 0) {
        await batchJail(vcJailPlayers, `Not in a voice channel${punc}`);
    }
    if (commsWarnPlayers.length > 0) {
        await batchPm(commsWarnPlayers, `You are not in our comms server${punc} Please join or you will be jailed${punc}`);
    }
    if (commsJailPlayers.length > 0) {
        await batchJail(commsJailPlayers, `Not in the comms server${punc}`);
    }

    // Summary log for the cycle
    const actionCount = vcWarnPlayers.length + vcJailPlayers.length + commsWarnPlayers.length + commsJailPlayers.length;
    if (actionCount > 0) {
        console.log(`[Checks] Cycle complete — VC warns: ${vcWarnPlayers.length}, VC jails: ${vcJailPlayers.length}, Comms warns: ${commsWarnPlayers.length}, Comms jails: ${commsJailPlayers.length}`);
    }

    const inGameUsernames = inGamePlayers.map(p => normalizeString(getPlayerName(p.Player)));

    for (const [memberId, member] of guild.members.cache) {
        if (member.roles.cache.has(IN_GAME_ROLE_ID)) {
            const nick = normalizeString(member.nickname);
            const globalName = normalizeString(member.user.globalName);
            const username = normalizeString(member.user.username);

            const isStillInGame = inGameUsernames.some(rblox =>
                nick.includes(rblox) || globalName.includes(rblox) || username.includes(rblox)
            );

            if (!isStillInGame) {
                try {
                    await member.roles.remove(IN_GAME_ROLE_ID);
                    console.log(`[Role] Removed In-Game Role from ${member.user.tag}`);
                } catch (e) {
                    console.error(`[Role] Failed to remove role from ${member.user.tag}:`, e.message);
                }
            }
        }
    }
}

function updateBotPresence(client, guild, inGameCount, queueCount) {
    if (inGameCount > 4) {
        client.user.setActivity(`${inGameCount} players online | Queue: ${queueCount}`, {
            type: ActivityType.Custom,
        });
        return;
    }

    const commsMemberCount = guild.memberCount || guild.members.cache.size;
    client.user.setActivity(`${commsMemberCount} people in FSRP`, {
        type: ActivityType.Watching,
    });
}
