#!/usr/bin/env bash
set -euo pipefail

# Run this from inside your FSRP repo on the branch you want the fixes on.

echo ">>> Discarding any local ticket-related changes"
git checkout -- . 2>/dev/null || true
git clean -fd src/commands src/utils 2>/dev/null || true

echo ">>> Deleting ticket files"
git rm -f \
  src/commands/close.js \
  src/commands/escalate.js \
  src/commands/rename.js \
  src/commands/ticket.js \
  src/commands/ticket-setup.js \
  src/events/ticketActions.js \
  src/utils/ticketManager.js \
  src/utils/ticketPanel.js \
  src/utils/transcriptBuilder.js 2>/dev/null || true

echo ">>> Writing src/api/erlc.js"
cat > src/api/erlc.js <<'FILE_EOF'
const axios = require('axios');
const https = require('https');

// ER:LC API. The legacy api.policeroleplay.community host is deprecated
// and now returns HTTP 410 for the player/server endpoints. The current
// host is api.erlc.gg:
//   GET  /v2/server         — server info with optional Players/Queue/etc.
//   POST /v1/server/command — run an in-game command
// See: https://apidocs.erlc.gg
const API_BASE = 'https://api.erlc.gg';

const agent = new https.Agent({
    keepAlive: false,
    rejectUnauthorized: false
});

const erlcApi = axios.create({
    baseURL: API_BASE,
    timeout: 15000,
    headers: {
        'Server-Key': process.env.ERLC_API_KEY,
        'Content-Type': 'application/json'
    },
    httpsAgent: agent
});

/**
 * Extracts just the username from the PRC API's "Username:RobloxId" format
 */
function getPlayerName(playerField) {
    if (!playerField) return '';
    // The API returns "Username:RobloxId" - we only want the username
    const parts = playerField.split(':');
    return parts[0];
}

/**
 * Extracts just the Roblox ID from the PRC API's "Username:RobloxId" format
 */
function getPlayerId(playerField) {
    if (!playerField) return '';
    const parts = playerField.split(':');
    return parts.length > 1 ? parts[1] : '';
}

function checkKey() {
    if (!process.env.ERLC_API_KEY) {
        throw new Error('ERLC_API_KEY is missing from .env');
    }
}

async function getServerInfo() {
    checkKey();
    try {
        // v2 returns Queue as an array; map its length to QueuePlayers for
        // backward compatibility with existing callers (automation.js etc.).
        const res = await erlcApi.get('/v2/server', { params: { Queue: true } });
        const data = res.data || {};
        return {
            ...data,
            QueuePlayers: Array.isArray(data.Queue) ? data.Queue.length : 0,
        };
    } catch (error) {
        console.error('Error fetching ERLC server info:', error.message);
        return null;
    }
}

async function getPlayers() {
    checkKey();
    try {
        const res = await erlcApi.get('/v2/server', { params: { Players: true } });
        return Array.isArray(res.data?.Players) ? res.data.Players : [];
    } catch (error) {
        console.error('Error fetching ERLC players:', error.message);
        return [];
    }
}

async function runCommand(command) {
    checkKey();

    const maxAttempts = 3;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            // Command endpoint still lives under /v1.
            const res = await erlcApi.post('/v1/server/command', { command });
            return res.data;
        } catch (error) {
            const status = error.response?.status;
            const isRateLimited = status === 429;

            if (isRateLimited && attempt < maxAttempts) {
                const retryAfterHeader = Number(error.response?.headers?.['retry-after']);
                const retryAfterMs = Number.isFinite(retryAfterHeader) && retryAfterHeader > 0
                    ? retryAfterHeader * 1000
                    : 1200 * attempt;

                console.warn(`ERLC command rate-limited (${command}). Retrying in ${retryAfterMs}ms (attempt ${attempt}/${maxAttempts})`);
                await new Promise(resolve => setTimeout(resolve, retryAfterMs));
                continue;
            }

            console.error('Error running ERLC command (' + command + '):', error.message);
            return null;
        }
    }

    return null;
}

async function pmPlayer(player, message) {
    const username = getPlayerName(player);
    return runCommand(':pm ' + username + ' ' + message);
}

async function jailPlayer(player, reason = '') {
    const username = getPlayerName(player);
    let cmd = ':jail ' + username;
    if (reason) {
        cmd += ' ' + reason;
    }
    return runCommand(cmd);
}

async function getModCalls() {
    checkKey();
    try {
        const res = await erlcApi.get('/v2/server', { params: { ModCalls: true } });
        return Array.isArray(res.data?.ModCalls) ? res.data.ModCalls : [];
    } catch (error) {
        console.warn('Error fetching ERLC mod calls:', error.message);
        return [];
    }
}

module.exports = {
    getServerInfo,
    getPlayers,
    getModCalls,
    runCommand,
    pmPlayer,
    jailPlayer,
    getPlayerName,
    getPlayerId
};
FILE_EOF

echo ">>> Writing src/events/automation.js"
cat > src/events/automation.js <<'FILE_EOF'
const { Events, PermissionFlagsBits, ActivityType } = require('discord.js');
const { getPlayers, getServerInfo, runCommand, getPlayerName, getPlayerId } = require('../api/erlc');
const { getBypasses } = require('../commands/hardcode');

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

    const [inGamePlayersResponse, serverInfo] = await Promise.all([getPlayers(), getServerInfo()]);
    if (!inGamePlayersResponse) {
        console.log('[Checks] Failed to fetch players from API');
        return;
    }
    const inGamePlayers = Array.isArray(inGamePlayersResponse) ? inGamePlayersResponse : [];
    const queuePlayers = Number(serverInfo?.QueuePlayers || 0);

    // Hardcode bypasses are stored per-guild under client.settings[guildId].hardcodeBypasses
    // — read via the helper so we don't hit the wrong enmap key.
    const hardcodeBypasses = getBypasses(client, guildId);
    const bypassSet = new Set(hardcodeBypasses.map(v => String(v).toLowerCase()));

    console.log(`[Checks] Active Players: ${inGamePlayers.length} | Guild Cache: ${guild.members.cache.size} | Bypasses: ${bypassSet.size}`);

    // Buckets for batched ERLC commands
    const vcWarnPlayers   = [];
    const vcJailPlayers   = [];
    const commsWarnPlayers = [];
    const commsJailPlayers = [];

    for (const player of inGamePlayers) {
        const robloxUsername = getPlayerName(player.Player);
        const robloxId = getPlayerId(player.Player);
        const member = findDiscordMember(guild, robloxUsername);

        if (bypassSet.has(String(robloxUsername).toLowerCase()) || bypassSet.has(String(robloxId).toLowerCase())) {
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

    // Fire all batched commands in parallel
    const punc = endPunc();
    const batchTasks = [];
    if (vcWarnPlayers.length > 0) batchTasks.push(batchPm(vcWarnPlayers, `You are in our comms but not in a Voice Channel${punc} Please join a VC to continue RPing${punc}`));
    if (vcJailPlayers.length > 0) batchTasks.push(batchJail(vcJailPlayers, `Not in a voice channel${punc}`));
    if (commsWarnPlayers.length > 0) batchTasks.push(batchPm(commsWarnPlayers, `You are not in our comms server${punc} Please join with code fsrp2 or you will be jailed${punc}`));
    if (commsJailPlayers.length > 0) batchTasks.push(batchJail(commsJailPlayers, `Not in the comms server (code: fsrp2)${punc}`));
    
    if (batchTasks.length > 0) await Promise.all(batchTasks).catch(e => console.error('[Batch] Command error:', e.message));

    // Summary log for the cycle
    const actionCount = vcWarnPlayers.length + vcJailPlayers.length + commsWarnPlayers.length + commsJailPlayers.length;
    if (actionCount > 0) {
        console.log(`[Checks] Cycle complete — VC warns: ${vcWarnPlayers.length}, VC jails: ${vcJailPlayers.length}, Comms warns: ${commsWarnPlayers.length}, Comms jails: ${commsJailPlayers.length}`);
    }

    updateBotPresence(client, guild, inGamePlayers.length, queuePlayers);

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
FILE_EOF

echo ">>> Writing src/commands/setup.js"
cat > src/commands/setup.js <<'FILE_EOF'
const {
    SlashCommandBuilder,
    PermissionFlagsBits,
    EmbedBuilder,
    ChannelType,
} = require('discord.js');

const { buildPriorityEmbed, buildPriorityRow } = require('../utils/priorityMessage');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('(Admin only) Configure this server\'s settings.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addChannelOption(option =>
            option.setName('ssu_channel').setDescription('Channel where SSU/SSD session announcements are sent.').setRequired(false))
        .addRoleOption(option =>
            option.setName('ping_role').setDescription('Role to ping when an SSU vote is started.').setRequired(false))
        .addChannelOption(option =>
            option.setName('logs_channel').setDescription('Channel where general bot command logs are posted.').setRequired(false))
        .addChannelOption(option =>
            option.setName('priority_channel').setDescription('Channel where the permanent priority-request button is posted.').setRequired(false))
        .addChannelOption(option =>
            option.setName('infraction_channel').setDescription('Channel where staff infraction notices are posted.').setRequired(false))
        .addChannelOption(option =>
            option.setName('promotion_channel').setDescription('Channel where staff promotion announcements are posted.').setRequired(false))
        .addChannelOption(option =>
            option.setName('staffrequest_channel').setDescription('Channel where game assistance / staff requests are posted.').setRequired(false))
        .addChannelOption(option =>
            option.setName('shift_channel').setDescription('Channel where shift warnings and shoutouts are posted.').setRequired(false))
        .addChannelOption(option =>
            option.setName('flag_channel').setDescription('Channel where Shift Contribution Flags are sent. Defaults to shift channel if not set.').setRequired(false))
        .addRoleOption(option =>
            option.setName('flag_role_1').setDescription('First management role to ping when a Shift Contribution Flag is issued.').setRequired(false))
        .addRoleOption(option =>
            option.setName('flag_role_2').setDescription('Second management role to ping (e.g. Management Team).').setRequired(false))
        .addRoleOption(option =>
            option.setName('flag_role_3').setDescription('Third management role to ping (e.g. Ownership Team).').setRequired(false)),

    async execute(interaction, client) {
        if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
            return safeReply(interaction, { content: 'Only server administrators can use `/setup`.', flags: 64 });
        }

        await interaction.deferReply({ flags: 64 }).catch(() => {});

        const ssuChannel              = interaction.options.getChannel('ssu_channel');
        const pingRole                = interaction.options.getRole('ping_role');
        const logsChannel             = interaction.options.getChannel('logs_channel');
        const priorityChannel         = interaction.options.getChannel('priority_channel');
        const infractionChannel       = interaction.options.getChannel('infraction_channel');
        const promotionChannel        = interaction.options.getChannel('promotion_channel');
        const staffRequestChannel     = interaction.options.getChannel('staffrequest_channel');
        const shiftChannel            = interaction.options.getChannel('shift_channel');
        const flagChannel             = interaction.options.getChannel('flag_channel');
        const flagRole1               = interaction.options.getRole('flag_role_1');
        const flagRole2               = interaction.options.getRole('flag_role_2');
        const flagRole3               = interaction.options.getRole('flag_role_3');

        const nothingProvided = !ssuChannel && !pingRole && !logsChannel && !priorityChannel
            && !infractionChannel && !promotionChannel && !staffRequestChannel && !shiftChannel
            && !flagChannel && !flagRole1 && !flagRole2 && !flagRole3;

        const buildConfigFields = (cfg) => [
            { name: '📢 SSU Channel',              value: cfg.ssuChannelId              ? `<#${cfg.ssuChannelId}>`              : 'Not configured', inline: true },
            { name: '🔔 Ping Role',                value: cfg.pingRoleId                ? `<@&${cfg.pingRoleId}>`               : 'Not configured', inline: true },
            { name: '📝 Logs Channel',             value: cfg.logsChannelId             ? `<#${cfg.logsChannelId}>`             : 'Not configured', inline: true },
            { name: '🚨 Priority Channel',         value: cfg.priorityChannelId         ? `<#${cfg.priorityChannelId}>`         : 'Not configured', inline: true },
            { name: '⚠️ Infraction Channel',       value: cfg.infractionChannelId       ? `<#${cfg.infractionChannelId}>`       : 'Not configured', inline: true },
            { name: '🎉 Promotion Channel',        value: cfg.promotionChannelId        ? `<#${cfg.promotionChannelId}>`        : 'Not configured', inline: true },
            { name: '🆘 Staff Request Channel',    value: cfg.staffRequestChannelId     ? `<#${cfg.staffRequestChannelId}>`     : 'Not configured', inline: true },
            { name: '📊 Shift Channel',            value: cfg.shiftChannelId            ? `<#${cfg.shiftChannelId}>`            : 'Not configured', inline: true },
            { name: '🚩 Flag Channel',             value: cfg.flagChannelId             ? `<#${cfg.flagChannelId}>`             : 'Not configured (uses shift channel)', inline: true },
            {
                name: '📣 Flag Ping Roles',
                value: cfg.flagRoleIds?.length ? cfg.flagRoleIds.map(id => `<@&${id}>`).join(' ') : 'Not configured',
                inline: false,
            },
        ];

        if (nothingProvided) {
            const existing = client.settings.get(interaction.guild.id) || {};
            const statusEmbed = new EmbedBuilder()
                .setTitle('Current Server Configuration')
                .setColor(0x5865F2)
                .addFields(buildConfigFields(existing))
                .setFooter({ text: 'Run /setup with options to update any of these settings.' })
                .setTimestamp();

            return interaction.editReply({ embeds: [statusEmbed] });
        }

        const guildId  = interaction.guild.id;
        const existing = client.settings.get(guildId) || {};
        const updates  = {};

        if (ssuChannel)          updates.ssuChannelId          = ssuChannel.id;
        if (pingRole)            updates.pingRoleId             = pingRole.id;
        if (logsChannel)         updates.logsChannelId          = logsChannel.id;
        if (infractionChannel)   updates.infractionChannelId    = infractionChannel.id;
        if (promotionChannel)    updates.promotionChannelId     = promotionChannel.id;
        if (staffRequestChannel) updates.staffRequestChannelId  = staffRequestChannel.id;
        if (shiftChannel)        updates.shiftChannelId         = shiftChannel.id;
        if (flagChannel)         updates.flagChannelId           = flagChannel.id;

        if (flagRole1 || flagRole2 || flagRole3) {
            const newIds = [flagRole1, flagRole2, flagRole3].filter(Boolean).map(r => r.id);
            const merged = [...new Set([...(existing.flagRoleIds || []), ...newIds])].slice(0, 3);
            updates.flagRoleIds = merged;
        }

        if (priorityChannel) {
            updates.priorityChannelId = priorityChannel.id;
        }

        client.settings.set(guildId, { ...existing, ...updates });

        if (priorityChannel) {
            await priorityChannel.send({ embeds: [buildPriorityEmbed(false)], components: [buildPriorityRow(false)] })
                .then(sent => { updates.priorityMessageId = sent.id; })
                .catch(e => console.error('[Setup] Failed to send priority button:', e.message));
            client.settings.set(guildId, { ...existing, ...updates });
        }

        const saved = client.settings.get(guildId);

        const resultEmbed = new EmbedBuilder()
            .setTitle('✅ Setup Updated')
            .setColor(0x57F287)
            .addFields(buildConfigFields(saved))
            .setFooter({ text: `Updated by ${interaction.user.username}` })
            .setTimestamp();

        return interaction.editReply({ embeds: [resultEmbed] });
    },
};

async function safeReply(interaction, options) {
    try {
        if (interaction.deferred || interaction.replied) return interaction.editReply(options);
        return interaction.reply(options);
    } catch (e) {
        console.error('[Setup] safeReply failed:', e.message);
    }
}
FILE_EOF

echo ">>> Writing src/events/interactionCreate.js"
cat > src/events/interactionCreate.js <<'FILE_EOF'
const { Events, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { getMainGuildId } = require('../utils/guildConfig');

const OWNER_ID = '848356730256883744';
const REQUIRED_ROLE_ID = '1488210128187560169';
const OWNER_ONLY_COMMANDS = ['git'];
const SELF_PERMISSIONED_COMMANDS = ['setup', 'infraction', 'promote', 'staffrequest', 'statlookup', 'my-infractions'];

const log = (level, command, message) => {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [${level}] [CMD:${command}] ${message}`);
};

const buildLogEmbed = (interaction, options) => {
    const user = interaction.user;
    const channel = interaction.channel;

    const embed = new EmbedBuilder()
        .setTitle('Command Log')
        .setColor('#5865F2')
        .addFields(
            { name: 'Command', value: `\`/${interaction.commandName}\``, inline: true },
            { name: 'User', value: `${user} (${user.username})`, inline: true },
            { name: 'Channel', value: `${channel || 'DM'}`, inline: true },
            { name: 'Server', value: interaction.guild?.name || 'DM', inline: true }
        )
        .setTimestamp();

    if (options !== 'none') {
        embed.addFields({ name: 'Options', value: `\`${options}\`` });
    }

    return embed;
};

const queueCommandTelemetry = (interaction, client, options, timestamp) => {
    const user = interaction.user;
    const channel = interaction.channel;

    client.users.fetch(OWNER_ID)
        .then(owner => owner?.send(`**Command Run**\n\`/${interaction.commandName}\` by **${user.username}** in **#${channel?.name || 'DM'}** (${interaction.guild?.name || 'DM'})\nOptions: ${options}\nTime: ${timestamp}`))
        .catch(e => log('WARN', interaction.commandName, `Failed to send owner DM: ${e.message}`));

    const logEmbed = buildLogEmbed(interaction, options);

    const guildSettings = client.settings.get(interaction.guild?.id);
    if (guildSettings?.logsChannelId) {
        const localLogsChannel = client.channels.cache.get(guildSettings.logsChannelId);
        if (localLogsChannel) {
            localLogsChannel.send({ embeds: [logEmbed] })
                .catch(e => log('WARN', interaction.commandName, `Failed to log to local channel: ${e.message}`));
        }
    }

    const mainGuildId = getMainGuildId();
    if (mainGuildId && mainGuildId !== interaction.guild?.id) {
        const mainSettings = client.settings.get(mainGuildId);
        if (mainSettings?.logsChannelId) {
            const mainLogsChannel = client.channels.cache.get(mainSettings.logsChannelId);
            if (mainLogsChannel) {
                mainLogsChannel.send({ embeds: [logEmbed] })
                    .catch(e => log('WARN', interaction.commandName, `Failed to log to main guild channel: ${e.message}`));
            }
        }
    }
};

const sendSafeReply = async (interaction, content, flags = 64) => {
    try {
        if (!interaction.isRepliable()) {
            log('WARN', interaction.commandName || 'unknown', 'Interaction is not repliable');
            return;
        }

        if (interaction.replied) {
            await interaction.followUp({ content, flags });
        } else if (interaction.deferred) {
            await interaction.editReply({ content });
        } else {
            await interaction.reply({ content, flags });
        }
    } catch (error) {
        if (error.code === 10062) {
            log('ERROR', interaction.commandName || 'unknown', `Interaction expired: ${error.message}`);
        } else {
            log('ERROR', interaction.commandName || 'unknown', `Failed to send reply: ${error.message}`);
        }
    }
};

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction, client) {
        try {
            if (!interaction.isChatInputCommand() && !interaction.isModalSubmit()) return;

            if (interaction.isModalSubmit()) {
                if (interaction.customId === 'priority_form') {
                    const { handlePriorityModal } = require('./priorityHandler');
                    await handlePriorityModal(interaction, client);
                    return;
                }

                return;
            }

            if (interaction.isChatInputCommand()) {
                const command = client.commands.get(interaction.commandName);
                const timestamp = new Date().toLocaleString();
                const user = interaction.user;
                const channel = interaction.channel;
                const options = interaction.options.data?.map(o => `${o.name}:${o.value}`).join(', ') || 'none';

                const isOwnerOnlyCommand = OWNER_ONLY_COMMANDS.includes(interaction.commandName);
                const isSelfPermissioned = SELF_PERMISSIONED_COMMANDS.includes(interaction.commandName);

                try {
                    if (isOwnerOnlyCommand) {
                        if (interaction.user.id !== OWNER_ID) {
                            log('WARN', interaction.commandName, `Permission denied for ${user.username} (${user.id}) - owner-only`);
                            return await sendSafeReply(interaction, 'Only the bot owner can use this command.');
                        }
                    } else if (!isSelfPermissioned) {
                        if (!interaction.member) {
                            log('WARN', interaction.commandName, `Permission denied for ${user.username} (${user.id}) - DM context`);
                            return await sendSafeReply(interaction, 'This command cannot be used in DMs.');
                        }
                        const hasRequiredRole = interaction.member.roles.cache.has(REQUIRED_ROLE_ID);
                        const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);

                        if (!hasRequiredRole && !isAdmin) {
                            log('WARN', interaction.commandName, `Permission denied for ${user.username} (${user.id}) - missing role`);
                            return await sendSafeReply(interaction, `You do not have permission to use this command.`);
                        }
                    }
                } catch (permError) {
                    log('ERROR', interaction.commandName, `Permission check failed: ${permError.message}`);
                    return await sendSafeReply(interaction, 'An error occurred while checking permissions.');
                }

                if (!command) {
                    log('ERROR', interaction.commandName, 'Command not found');
                    return;
                }

                log('INFO', interaction.commandName, `Executed by ${user.username} (${user.id}) in #${channel?.name || 'DM'} [${interaction.guild?.name}] | options: ${options}`);

                queueCommandTelemetry(interaction, client, options, timestamp);

                try {
                    await command.execute(interaction, client);
                } catch (error) {
                    log('ERROR', interaction.commandName, `Execution failed: ${error.message}\n${error.stack}`);
                    await sendSafeReply(interaction, 'There was an error while executing this command!');
                }
            }
        } catch (error) {
            log('ERROR', 'InteractionCreate', `Unhandled error: ${error.message}\n${error.stack}`);
        }
    },
};
FILE_EOF

echo ">>> Writing src/events/interactionButton.js"
cat > src/events/interactionButton.js <<'FILE_EOF'
const {
    Events,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    PermissionFlagsBits,
} = require('discord.js');

const hardcodeCommand = require('../commands/hardcode');
const staffRequestCommand = require('../commands/staffrequest');
const infractionCommand = require('../commands/infraction');
const {
    handlePriorityRequestButton,
    handlePriorityApprove,
    handlePriorityDeny,
} = require('./priorityHandler');
const { activeFlags, consecutiveBadScans } = require('./shiftMonitor');

const isHardcodeComponent = interaction => {
    if (!interaction.customId) return false;
    return interaction.customId.startsWith(`${hardcodeCommand.COMPONENT_PREFIX}:`);
};

const parseHardcodeId = customId => {
    const parts = customId.split(':');
    return {
        prefix: parts[0],
        action: parts[1],
        actorId: parts[2],
        page: Number(parts[3] || 0),
        messageId: parts[4],
    };
};

const ensureActor = async (interaction, actorId) => {
    if (!actorId || actorId === '0' || actorId === interaction.user.id) return true;

    await interaction.reply({
        content: 'Only the user who opened this list can use these controls. Run `/hardcode list` for your own controls.',
        flags: 64,
    });
    return false;
};

const updateHardcodeListMessage = async (targetInteraction, client, page, actorId) => {
    const bypasses = hardcodeCommand.getBypasses(client, targetInteraction.guild.id);
    const view = hardcodeCommand.buildListView(bypasses, page, actorId || targetInteraction.user.id);

    if (targetInteraction.isButton() || targetInteraction.isStringSelectMenu()) {
        await targetInteraction.update({ embeds: [view.embed], components: view.components });
        return;
    }

    if (targetInteraction.isModalSubmit()) {
        try {
            const messageId = targetInteraction.customId.split(':')[4];
            const message = await targetInteraction.channel.messages.fetch(messageId);
            if (message) {
                await message.edit({ embeds: [view.embed], components: view.components });
            }
        } catch (e) {
            console.warn('[Hardcode] Could not update original list message (it may have been deleted):', e.message);
        }
    }
};

module.exports = {
    name: Events.InteractionCreate,
    async execute(interaction, client) {
        // ── Button interactions ────────────────────────────────────────────────
        if (interaction.isButton()) {
            // ── Infraction interaction guard ───────────────────────────────────
            if (interaction.customId.startsWith('inf_')) {
                const { PermissionFlagsBits } = require('discord.js');
                const MANAGE_ROLE_ID = infractionCommand.MANAGE_ROLE_ID;
                const hasRole = interaction.member?.roles?.cache?.has(MANAGE_ROLE_ID);
                const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
                if (!hasRole && !isAdmin) {
                    return interaction.reply({ content: 'You do not have permission to use infraction controls.', flags: 64 });
                }

                // Helper: fetch target member quietly
                const fetchTarget = async (userId) => {
                    try { return await interaction.guild.members.fetch(userId); } catch { return null; }
                };

                // ── Resolve ────────────────────────────────────────────────────
                if (interaction.customId.startsWith('inf_resolve:')) {
                    const parts  = interaction.customId.split(':');
                    const infId  = parts[1];
                    const userId = parts[2];

                    const infractions = client.settings.get(`user_infractions_${userId}`) || [];
                    const idx = infractions.findIndex(i => i.id === infId);
                    if (idx === -1) return interaction.reply({ content: `Case \`${infId}\` not found.`, flags: 64 });
                    if (!infractions[idx].active) return interaction.reply({ content: `\`${infId}\` is already resolved.`, flags: 64 });

                    infractions[idx].active     = false;
                    infractions[idx].resolvedBy = interaction.user.id;
                    infractions[idx].resolvedAt = Math.floor(Date.now() / 1000);
                    client.settings.set(`user_infractions_${userId}`, infractions);
                    console.log(`[Infraction] ${infId} resolved by ${interaction.user.username}`);

                    const target      = await fetchTarget(userId);
                    const displayName = target?.displayName ?? `User ${userId}`;
                    const avatarURL   = target?.user?.displayAvatarURL({ dynamic: true });
                    const inf         = infractions[idx];
                    const { embed, components } = infractionCommand.buildCaseEmbed(inf, userId, displayName, avatarURL);
                    embed.setFooter({ text: `Resolved by ${interaction.user.username}` });
                    return interaction.update({ embeds: [embed], components });
                }

                // ── Back to list ───────────────────────────────────────────────
                if (interaction.customId.startsWith('inf_back:')) {
                    const userId      = interaction.customId.split(':')[1];
                    const target      = await fetchTarget(userId);
                    const displayName = target?.displayName ?? `User ${userId}`;
                    const avatarURL   = target?.user?.displayAvatarURL({ dynamic: true });
                    const infractions = client.settings.get(`user_infractions_${userId}`) || [];
                    const { embed, components } = infractionCommand.buildListEmbed(userId, displayName, avatarURL, infractions);
                    embed.setFooter({ text: `Opened by ${interaction.user.username}` });
                    return interaction.update({ embeds: [embed], components });
                }

                // ── Edit (open modal) ──────────────────────────────────────────
                if (interaction.customId.startsWith('inf_edit:')) {
                    const parts  = interaction.customId.split(':');
                    const infId  = parts[1];
                    const userId = parts[2];

                    const infractions = client.settings.get(`user_infractions_${userId}`) || [];
                    const inf = infractions.find(i => i.id === infId);
                    if (!inf) return interaction.reply({ content: `Case \`${infId}\` not found.`, flags: 64 });

                    const modal = new ModalBuilder()
                        .setCustomId(`inf_edit_modal:${infId}:${userId}`)
                        .setTitle(`Edit Case ${infId}`);

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('punishment')
                                .setLabel('Punishment Type')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                                .setValue(inf.punishment)
                                .setPlaceholder('Warning, Strike, Demotion, Termination, Other')
                                .setMaxLength(20),
                        ),
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('reason')
                                .setLabel('Reason')
                                .setStyle(TextInputStyle.Paragraph)
                                .setRequired(true)
                                .setValue((inf.reason || '').slice(0, 1000))
                                .setMaxLength(1000),
                        ),
                    );

                    return interaction.showModal(modal);
                }
            }

            // Hardcode controls
            if (isHardcodeComponent(interaction)) {
                const parsed = parseHardcodeId(interaction.customId);
                if (!(await ensureActor(interaction, parsed.actorId))) return;

                if (parsed.action === 'prev') {
                    return updateHardcodeListMessage(interaction, client, parsed.page - 1, parsed.actorId);
                }
                if (parsed.action === 'next') {
                    return updateHardcodeListMessage(interaction, client, parsed.page + 1, parsed.actorId);
                }
                if (parsed.action === 'refresh') {
                    return updateHardcodeListMessage(interaction, client, parsed.page, parsed.actorId);
                }
                if (parsed.action === 'add_btn') {
                    const modal = new ModalBuilder()
                        .setCustomId(`${hardcodeCommand.COMPONENT_PREFIX}:add_modal:${parsed.actorId}:${parsed.page}:${interaction.message.id}`)
                        .setTitle('Add Hardcode Bypass Entry');

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(
                            new TextInputBuilder()
                                .setCustomId('new_identifier')
                                .setLabel('Roblox Username or User ID')
                                .setStyle(TextInputStyle.Short)
                                .setRequired(true)
                                .setPlaceholder('e.g. CoolRobloxUser or 123456789')
                                .setMaxLength(100)
                        )
                    );

                    return interaction.showModal(modal);
                }
            }

            // ── Shift Contribution Flag — Resolve ────────────────────────────
            if (interaction.customId.startsWith('scflag_resolve:')) {
                const HR_ROLE_ID   = '1487127238058180810';
                const isHR         = interaction.member?.roles?.cache?.has(HR_ROLE_ID);
                const isAdmin      = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);

                if (!isHR && !isAdmin) {
                    return interaction.reply({
                        content: 'Only HR members can resolve Shift Contribution Flags.',
                        flags: 64,
                    });
                }

                const modName = interaction.customId.slice('scflag_resolve:'.length);

                // Reset consecutive scan count so they get a clean slate
                consecutiveBadScans.delete(modName);
                activeFlags.delete(modName);

                // Edit the original flag message to mark it resolved
                try {
                    const targetMsg = interaction.message;
                    const oldEmbed  = targetMsg.embeds[0];

                    const resolvedEmbed = EmbedBuilder.from(oldEmbed)
                        .setColor('#5865F2')
                        .setFooter({ text: `Resolved by ${interaction.user.username}` })
                        .setTimestamp();

                    await interaction.update({
                        embeds:     [resolvedEmbed],
                        components: [],
                    });
                } catch (e) {
                    console.warn('[ShiftMonitor] Could not update flag message on resolve:', e.message);
                    await interaction.reply({
                        content: `Flag for **${modName}** has been resolved by ${interaction.user}.`,
                        flags: 64,
                    });
                }

                console.log(`[ShiftMonitor] Flag resolved for ${modName} by ${interaction.user.tag}`);
                return;
            }

            // Staff request respond button
            if (interaction.customId === 'staffrequest_respond') {
                const reqData = staffRequestCommand.activeRequests.get(interaction.message.id);
                if (!reqData) {
                    return interaction.reply({ content: 'This staff request has expired.', flags: 64 });
                }

                const { respondees, playerCount, maxPlayers, joinUrl } = reqData;

                if (respondees.has(interaction.user.id)) {
                    respondees.delete(interaction.user.id);
                } else {
                    respondees.add(interaction.user.id);
                }

                const { buildRequestEmbed, buildRequestRow } = (() => {
                    const { EmbedBuilder: EB, ActionRowBuilder: ARB, ButtonBuilder: BB, ButtonStyle: BS } = require('discord.js');
                    const LOGO = 'https://i.postimg.cc/T1K1HQCs/FSR-logo-with-tropical-scene.webp';
                    const FOOTER = 'https://i.postimg.cc/ZRqRj6bf/Untitled-design-(18).webp';

                    const buildEmbed = () => {
                        const respondeeList = respondees.size > 0
                            ? [...respondees].map(id => `• <@${id}>`).join('\n')
                            : '*No respondees yet.*';

                        return new EB()
                            .setTitle('Game Assistance')
                            .setColor('#5865F2')
                            .setThumbnail(LOGO)
                            .setDescription(
                                'We are in-need of in-game staff members to assist players with assistance, and to ensure that our server is maintained with a great roleplay experience.'
                            )
                            .addFields(
                                { name: '\u200b', value: `Players In-game: **${playerCount}/${maxPlayers}**`, inline: false },
                                { name: 'Respondees:', value: respondeeList, inline: false },
                            )
                            .setImage(FOOTER)
                            .setTimestamp();
                    };

                    const buildRow = () => new ARB().addComponents(
                        new BB()
                            .setCustomId('staffrequest_respond')
                            .setLabel('Respond')
                            .setStyle(BS.Secondary),
                        new BB()
                            .setLabel('Join In-Game')
                            .setStyle(BS.Link)
                            .setURL(joinUrl || 'https://www.roblox.com/games/2534724415'),
                    );

                    return { buildRequestEmbed: buildEmbed, buildRequestRow: buildRow };
                })();

                await interaction.update({
                    embeds: [buildRequestEmbed()],
                    components: [buildRequestRow()],
                });
                return;
            }

            // Priority — request button
            if (interaction.customId === 'priority_request') {
                return handlePriorityRequestButton(interaction, client);
            }

            // Priority — approve button
            if (interaction.customId.startsWith('priority_approve:')) {
                return handlePriorityApprove(interaction, client);
            }

            // Priority — deny button
            if (interaction.customId.startsWith('priority_deny:')) {
                return handlePriorityDeny(interaction, client);
            }

            // SSU vote buttons
            const ssuVoteCommand = client.commands.get('ssu-vote');
            const activeVotes = ssuVoteCommand?.activeVotes;
            const voteData = activeVotes?.get(interaction.message.id);

            if (!voteData) return;

            if (interaction.customId === 'vote_btn') {
                if (voteData.voters.has(interaction.user.id)) {
                    voteData.voters.delete(interaction.user.id);
                    console.log(`[Vote] ${interaction.user.tag} removed their vote (${voteData.voters.size}/${voteData.targetVotes})`);
                } else {
                    voteData.voters.add(interaction.user.id);
                    console.log(`[Vote] ${interaction.user.tag} voted (${voteData.voters.size}/${voteData.targetVotes})`);
                }

                const progressBar = ssuVoteCommand.buildProgressBar(voteData.voters.size, voteData.targetVotes, interaction.guild);

                const newLabel = `Vote (${voteData.voters.size}/${voteData.targetVotes})`;
                const voteBtn = new ButtonBuilder()
                    .setCustomId('vote_btn')
                    .setLabel(newLabel)
                    .setStyle(ButtonStyle.Success);

                const viewVotesBtn = new ButtonBuilder()
                    .setCustomId('view_votes_btn')
                    .setLabel('View Votes')
                    .setStyle(ButtonStyle.Primary);

                const embed = new EmbedBuilder()
                    .setTitle('Session Poll')
                    .setDescription(`We have now initiated a session vote. Please react below if you're willing to attend today's session. We require **${voteData.targetVotes}** votes to start a session.\n\n${progressBar}`)
                    .setColor('#5865F2')
                    .setImage('https://i.postimg.cc/59HmqpCR/INFormation.png');

                if (voteData.voters.size >= voteData.targetVotes) {
                    voteBtn.setDisabled(true);
                    voteBtn.setLabel(`Goal Reached! (${voteData.voters.size}/${voteData.targetVotes})`);

                    try {
                        const initiator = await client.users.fetch(voteData.initiatorId);
                        if (initiator) {
                            await initiator.send(`Your SSU Vote in **${interaction.guild.name}** has reached its goal of **${voteData.targetVotes}** votes!`);
                        }
                    } catch (e) {
                        console.log('[Vote] Could not DM initiator.');
                    }

                    activeVotes.delete(interaction.message.id);
                }

                const row = new ActionRowBuilder().addComponents(voteBtn, viewVotesBtn);
                await interaction.update({ embeds: [embed], components: [row] });

            } else if (interaction.customId === 'view_votes_btn') {
                const voterIds = Array.from(voteData.voters);

                const emojiBLine = interaction.guild.emojis.cache.find(e => e.name === 'BLine');
                const bLine = emojiBLine ? `${emojiBLine}`.repeat(10) : '';

                if (voterIds.length === 0) {
                    const embed = new EmbedBuilder()
                        .setTitle('Session Votes')
                        .setDescription(`No one has voted yet.${bLine ? '\n\n' + bLine : ''}`)
                        .setColor('#5865F2');
                    return interaction.reply({ embeds: [embed], flags: 64 });
                }

                const mentions = voterIds.map(id => `<@${id}>`).join('\n');
                const embed = new EmbedBuilder()
                    .setTitle('Session Votes')
                    .setDescription(`These are the people who voted. You can remove your vote by clicking Vote again.\n\n${mentions}${bLine ? '\n\n' + bLine : ''}`)
                    .setColor('#5865F2');

                await interaction.reply({ embeds: [embed], flags: 64 });
            }

            return;
        }

        // ── Select menu interactions ───────────────────────────────────────────
        if (interaction.isStringSelectMenu()) {
            // ── Infraction case select ─────────────────────────────────────────
            if (interaction.customId.startsWith('inf_select:')) {
                const { PermissionFlagsBits } = require('discord.js');
                const MANAGE_ROLE_ID = infractionCommand.MANAGE_ROLE_ID;
                const hasRole = interaction.member?.roles?.cache?.has(MANAGE_ROLE_ID);
                const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
                if (!hasRole && !isAdmin) {
                    return interaction.reply({ content: 'You do not have permission to use infraction controls.', flags: 64 });
                }

                const userId      = interaction.customId.split(':')[1];
                const selectedId  = interaction.values[0];
                const infractions = client.settings.get(`user_infractions_${userId}`) || [];
                const inf         = infractions.find(i => i.id === selectedId);

                if (!inf) return interaction.reply({ content: `Case \`${selectedId}\` not found.`, flags: 64 });

                let target;
                try { target = await interaction.guild.members.fetch(userId); } catch { /* ok */ }
                const displayName = target?.displayName ?? `User ${userId}`;
                const avatarURL   = target?.user?.displayAvatarURL({ dynamic: true });

                const { embed, components } = infractionCommand.buildCaseEmbed(inf, userId, displayName, avatarURL);
                embed.setFooter({ text: `Opened by ${interaction.user.username}` });
                return interaction.update({ embeds: [embed], components });
            }

            // Hardcode select menus
            if (isHardcodeComponent(interaction)) {
                const parsed = parseHardcodeId(interaction.customId);
                if (!(await ensureActor(interaction, parsed.actorId))) return;

                const selectedIdentifier = interaction.values[0];
                if (!selectedIdentifier || selectedIdentifier === '__none__') {
                    return interaction.reply({ content: 'No identifier selected.', flags: 64 });
                }

                if (parsed.action === 'remove_select') {
                    const bypasses = hardcodeCommand.getBypasses(client, interaction.guild.id);
                    const nextBypasses = bypasses.filter(entry => entry !== selectedIdentifier);
                    hardcodeCommand.setBypasses(client, interaction.guild.id, nextBypasses);
                    await updateHardcodeListMessage(interaction, client, parsed.page, parsed.actorId);
                    return interaction.followUp({ content: `Removed \`${selectedIdentifier}\` from hardcode bypasses.`, flags: 64 });
                }

                if (parsed.action === 'edit_select') {
                    const modal = new ModalBuilder()
                        .setCustomId(`${hardcodeCommand.COMPONENT_PREFIX}:edit_modal:${parsed.actorId}:${parsed.page}:${interaction.message.id}`)
                        .setTitle('Edit Hardcode Identifier');

                    const oldIdentifierInput = new TextInputBuilder()
                        .setCustomId('old_identifier')
                        .setLabel('Old Identifier')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setValue(selectedIdentifier.slice(0, 100));

                    const newIdentifierInput = new TextInputBuilder()
                        .setCustomId('new_identifier')
                        .setLabel('New Identifier')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                        .setMaxLength(100);

                    modal.addComponents(
                        new ActionRowBuilder().addComponents(oldIdentifierInput),
                        new ActionRowBuilder().addComponents(newIdentifierInput),
                    );

                    return interaction.showModal(modal);
                }
            }
        }

        // ── Modal submit interactions ──────────────────────────────────────────
        // ── Infraction edit modal ──────────────────────────────────────────────
        if (interaction.isModalSubmit() && interaction.customId.startsWith('inf_edit_modal:')) {
            const { PermissionFlagsBits } = require('discord.js');
            const MANAGE_ROLE_ID = infractionCommand.MANAGE_ROLE_ID;
            const hasRole = interaction.member?.roles?.cache?.has(MANAGE_ROLE_ID);
            const isAdmin = interaction.member?.permissions?.has(PermissionFlagsBits.Administrator);
            if (!hasRole && !isAdmin) {
                return interaction.reply({ content: 'You do not have permission to edit infractions.', flags: 64 });
            }

            const parts      = interaction.customId.split(':');
            const infId      = parts[1];
            const userId     = parts[2];
            const infractions = client.settings.get(`user_infractions_${userId}`) || [];
            const idx         = infractions.findIndex(i => i.id === infId);

            if (idx === -1) return interaction.reply({ content: `Case \`${infId}\` not found.`, flags: 64 });

            const VALID_PUNISHMENTS = ['Warning', 'Strike', 'Demotion', 'Termination', 'Other'];
            const rawPunishment = interaction.fields.getTextInputValue('punishment').trim();
            const newPunishment = VALID_PUNISHMENTS.find(p => p.toLowerCase() === rawPunishment.toLowerCase());

            if (!newPunishment) {
                return interaction.reply({
                    content: `Invalid punishment type. Must be one of: ${VALID_PUNISHMENTS.join(', ')}`,
                    flags: 64,
                });
            }

            const newReason = interaction.fields.getTextInputValue('reason').trim();
            infractions[idx].punishment = newPunishment;
            infractions[idx].reason     = newReason;
            infractions[idx].editedBy   = interaction.user.id;
            infractions[idx].editedAt   = Math.floor(Date.now() / 1000);
            client.settings.set(`user_infractions_${userId}`, infractions);
            console.log(`[Infraction] ${infId} edited by ${interaction.user.username} — ${newPunishment}`);

            let target;
            try { target = await interaction.guild.members.fetch(userId); } catch { /* ok */ }
            const displayName = target?.displayName ?? `User ${userId}`;
            const avatarURL   = target?.user?.displayAvatarURL({ dynamic: true });
            const inf         = infractions[idx];
            const { embed, components } = infractionCommand.buildCaseEmbed(inf, userId, displayName, avatarURL);
            embed.setFooter({ text: `Edited by ${interaction.user.username}` });

            return interaction.update({ embeds: [embed], components });
        }

        if (interaction.isModalSubmit() && isHardcodeComponent(interaction)) {
            const parsed = parseHardcodeId(interaction.customId);
            if (!(await ensureActor(interaction, parsed.actorId))) return;

            if (parsed.action === 'add_modal') {
                const identifier = interaction.fields.getTextInputValue('new_identifier').trim();
                const bypasses = hardcodeCommand.getBypasses(client, interaction.guild.id);

                if (bypasses.includes(identifier)) {
                    return interaction.reply({ content: `\`${identifier}\` is already in the bypass list.`, flags: 64 });
                }

                bypasses.push(identifier);
                hardcodeCommand.setBypasses(client, interaction.guild.id, bypasses);
                await updateHardcodeListMessage(interaction, client, parsed.page, parsed.actorId);
                return interaction.reply({ content: `Added \`${identifier}\` to hardcode bypasses.`, flags: 64 });
            }

            if (parsed.action === 'edit_modal') {
                const oldIdentifier = interaction.fields.getTextInputValue('old_identifier').trim();
                const newIdentifier = interaction.fields.getTextInputValue('new_identifier').trim();
                const bypasses = hardcodeCommand.getBypasses(client, interaction.guild.id);
                const oldIndex = bypasses.indexOf(oldIdentifier);

                if (oldIndex === -1) {
                    return interaction.reply({ content: `\`${oldIdentifier}\` was not found in hardcode bypasses.`, flags: 64 });
                }

                if (bypasses.includes(newIdentifier)) {
                    return interaction.reply({ content: `\`${newIdentifier}\` already exists in hardcode bypasses.`, flags: 64 });
                }

                bypasses[oldIndex] = newIdentifier;
                hardcodeCommand.setBypasses(client, interaction.guild.id, bypasses);
                await updateHardcodeListMessage(interaction, client, parsed.page, parsed.actorId);
                return interaction.reply({ content: `Updated \`${oldIdentifier}\` → \`${newIdentifier}\`.`, flags: 64 });
            }
        }
    },
};
FILE_EOF

echo ">>> Patching src/commands/infraction.js"
# Replace the ticket-reference line
node -e "
const fs = require('fs');
const p = 'src/commands/infraction.js';
let s = fs.readFileSync(p, 'utf8');
s = s.replace(/This punishment is not subject to change\\. <@&\\\${HR_ROLE_ID}> reviews concerns in a ticket\\./, 'This punishment is not subject to change. Direct concerns to <@&\${HR_ROLE_ID}>.');
fs.writeFileSync(p, s);
"

echo ">>> Patching package.json (remove discord-html-transcripts)"
node -e "
const fs = require('fs');
const p = JSON.parse(fs.readFileSync('package.json', 'utf8'));
delete p.dependencies['discord-html-transcripts'];
fs.writeFileSync('package.json', JSON.stringify(p, null, 2) + '\n');
"

echo ">>> Reinstalling dependencies"
npm install --no-audit --no-fund

echo ">>> Syntax-checking everything"
find src -name '*.js' -exec node --check {} \;
node --check index.js

echo ">>> Staging + committing"
git add -A
git commit -m "fix: switch ERLC API to api.erlc.gg, repair main loop, remove tickets"

echo ">>> Done. Now push: git push -u origin \$(git branch --show-current)"
