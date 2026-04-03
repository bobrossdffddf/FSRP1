const { Events, PermissionFlagsBits, ActivityType } = require('discord.js');
const { getPlayers, getServerInfo, pmPlayer, jailPlayer, getPlayerName, getPlayerId } = require('../api/erlc');

const vcWarnings = new Map();
const commsWarnings = new Map();

let msgFlip = false;

const IN_GAME_ROLE_ID = '1480589156177674343';
const STAFF_BYPASS_ROLE_ID = '970917178142498824';

module.exports = {
    name: Events.ClientReady,
    once: true,
    async execute(client) {
        console.log(`Polling Manager: Ready. Starting loops...`);

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
                    console.log(`[VC] Jailing ${robloxUsername} for not being in VC`);
                    await jailPlayer(player.Player, "Not in a voice channel" + endPunc());
                    await sleep(1500);
                    vcWarnings.delete(robloxUsername);
                } else {
                    console.log(`[VC] Warning ${robloxUsername} (${warnings + 1}/5)`);
                    await pmPlayer(player.Player, "You are in our comms but not in a Voice Channel" + endPunc() + " Please join a VC to continue RPing" + endPunc());
                    await sleep(1500);
                    vcWarnings.set(robloxUsername, warnings + 1);
                }
            } else {
                vcWarnings.delete(robloxUsername);
            }
        } else {
            const warnings = commsWarnings.get(robloxUsername) || 0;
            if (warnings >= 6) {
                console.log(`[Comms] Jailing ${robloxUsername} for not being in comms`);
                await jailPlayer(player.Player, "Not in the comms server" + endPunc());
                await sleep(1500);
                commsWarnings.delete(robloxUsername);
            } else {
                console.log(`[Comms] Warning ${robloxUsername} (${warnings + 1}/6)`);
                await pmPlayer(player.Player, "You are not in our comms server" + endPunc() + " Please join or you will be jailed" + endPunc());
                await sleep(1500);
                commsWarnings.set(robloxUsername, warnings + 1);
            }
        }
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
    client.user.setActivity(`${commsMemberCount} people in FSRP comms`, {
        type: ActivityType.Watching,
    });
}
