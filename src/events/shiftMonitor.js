const { Events, EmbedBuilder } = require('discord.js');
const { getModCalls, getServerInfo, getPlayerName } = require('../api/erlc');

const POLL_INTERVAL_MS = 60_000;
const EVAL_INTERVAL_MS = 5 * 60_000;
const WARN_SHARE_THRESHOLD = 0.60;
const SHOUTOUT_SHARE_THRESHOLD = 1.30;
const MSG_COOLDOWN_MS = 15 * 60_000;

const LOGO_URL = 'https://i.postimg.cc/T1K1HQCs/FSR-logo-with-tropical-scene.webp';
const FOOTER_URL = 'https://i.postimg.cc/ZRqRj6bf/Untitled-design-(18).webp';

const seenHandledCallKeys = new Set();
const modCallCounts = new Map();
const modLastCallTime = new Map();
let sessionTotalCalls = 0;
let lastEvalTime = 0;
const lastMsgTime = new Map();

function resetSessionData() {
    seenHandledCallKeys.clear();
    modCallCounts.clear();
    modLastCallTime.clear();
    sessionTotalCalls = 0;
    lastEvalTime = 0;
    lastMsgTime.clear();
    console.log('[ShiftMonitor] Session data reset.');
}

function formatDuration(ms) {
    const totalSec = Math.floor(ms / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    if (hours > 0) return `${hours}h ${minutes}m`;
    return `${minutes} minutes`;
}

function timeAgo(timestamp) {
    if (!timestamp) return 'unknown';
    const diff = Date.now() - timestamp * 1000;
    const minutes = Math.floor(diff / 60_000);
    const hours = Math.floor(minutes / 60);
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
    return 'just now';
}

function normalizeString(str) {
    if (!str) return '';
    return str.toLowerCase().replace(/\s+/g, ' ').trim();
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

async function pollModCalls() {
    try {
        const calls = await getModCalls();
        if (!Array.isArray(calls)) return;

        for (const call of calls) {
            if (!call.Moderator) continue;
            const modName = getPlayerName(call.Moderator);
            const callerName = getPlayerName(call.Caller);
            const ts = call.Timestamp || 0;
            const key = `${callerName}:${ts}`;

            if (!seenHandledCallKeys.has(key)) {
                seenHandledCallKeys.add(key);
                modCallCounts.set(modName, (modCallCounts.get(modName) || 0) + 1);
                modLastCallTime.set(modName, ts);
                sessionTotalCalls++;
                console.log(`[ShiftMonitor] New mod call handled by ${modName}. Total: ${sessionTotalCalls}`);
            }
        }
    } catch (e) {
        console.warn('[ShiftMonitor] pollModCalls error:', e.message);
    }
}

async function evaluateStaff(client) {
    const guildId = process.env.MAIN_GUILD_ID;
    if (!guildId) return;

    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    const settings = client.settings.get(guildId) || {};
    if (!settings.shiftChannelId) return;

    const shiftChannel = client.channels.cache.get(settings.shiftChannelId);
    if (!shiftChannel) return;

    if (!settings.sessionActive || !settings.sessionStartTime) return;
    if (sessionTotalCalls === 0) return;

    const numActiveStaff = Math.max(modCallCounts.size, 1);
    const sessionLengthMs = Date.now() - settings.sessionStartTime;
    const fairShareCount = Math.ceil(sessionTotalCalls / numActiveStaff);
    const expectedSharePct = Math.round(100 / numActiveStaff);

    for (const [modName, callCount] of modCallCounts.entries()) {
        const shareRatio = callCount / (sessionTotalCalls / numActiveStaff);
        const discordMember = findDiscordMember(guild, modName);
        const now = Date.now();
        const lastMsg = lastMsgTime.get(modName) || 0;

        if (now - lastMsg < MSG_COOLDOWN_MS) continue;

        if (shareRatio < WARN_SHARE_THRESHOLD) {
            const behind = fairShareCount - callCount;

            const embed = new EmbedBuilder()
                .setColor('#FEE75C')
                .setThumbnail(LOGO_URL)
                .setTitle('Shift Contribution Warning')
                .setDescription(
                    `${discordMember ? discordMember : `**${modName}**`}, Your current shift pace needs attention.`
                )
                .addFields(
                    { name: 'Shift Length', value: formatDuration(sessionLengthMs), inline: true },
                    { name: 'Calls Handled', value: `${callCount}/${sessionTotalCalls}`, inline: true },
                    { name: 'Required Calls', value: `${fairShareCount}`, inline: true },
                    { name: 'Expected Share', value: `${expectedSharePct}%`, inline: true },
                    { name: 'Last Mod Call', value: timeAgo(modLastCallTime.get(modName)), inline: true },
                    { name: '\u200b', value: '\u200b', inline: true },
                    { name: 'Reason', value: `You are behind pace by **${behind}** call(s).`, inline: false },
                    {
                        name: 'What To Do To Improve',
                        value: `Pick up at least **${behind}** more mod call${behind !== 1 ? 's' : ''} soon so you can recover your pace.`,
                        inline: false,
                    },
                )
                .setImage(FOOTER_URL)
                .setFooter({ text: 'FSRP Shift Monitor' })
                .setTimestamp();

            if (discordMember) {
                embed.setAuthor({
                    name: discordMember.displayName,
                    iconURL: discordMember.user.displayAvatarURL({ dynamic: true }),
                });
            }

            try {
                await shiftChannel.send({
                    content: discordMember ? `${discordMember}` : `**${modName}**`,
                    embeds: [embed],
                });
                lastMsgTime.set(modName, now);
                console.log(`[ShiftMonitor] Warning sent for ${modName}`);
            } catch (e) {
                console.error('[ShiftMonitor] Failed to send warning:', e.message);
            }

        } else if (shareRatio >= SHOUTOUT_SHARE_THRESHOLD) {
            const embed = new EmbedBuilder()
                .setColor('#57F287')
                .setThumbnail(LOGO_URL)
                .setTitle('Shift Shoutout')
                .setDescription(
                    `✓ ${discordMember ? discordMember : `**${modName}**`} has been putting in strong work this shift.`
                )
                .addFields(
                    { name: 'Current Contribution', value: `${callCount}/${sessionTotalCalls} calls`, inline: true },
                    { name: 'Share', value: `${Math.round((callCount / sessionTotalCalls) * 100)}%`, inline: true },
                )
                .setImage(FOOTER_URL)
                .setFooter({ text: 'FSRP Shift Monitor' })
                .setTimestamp();

            if (discordMember) {
                embed.setAuthor({
                    name: discordMember.displayName,
                    iconURL: discordMember.user.displayAvatarURL({ dynamic: true }),
                });
            }

            try {
                await shiftChannel.send({
                    content: discordMember ? `${discordMember}` : `**${modName}**`,
                    embeds: [embed],
                });
                lastMsgTime.set(modName, now);
                console.log(`[ShiftMonitor] Shoutout sent for ${modName}`);
            } catch (e) {
                console.error('[ShiftMonitor] Failed to send shoutout:', e.message);
            }
        }
    }
}

module.exports = {
    name: Events.ClientReady,
    once: true,
    resetSessionData,

    async execute(client) {
        console.log('[ShiftMonitor] Shift monitoring started.');

        const pollLoop = async () => {
            try {
                const guildId = process.env.MAIN_GUILD_ID;
                const settings = guildId ? (client.settings.get(guildId) || {}) : {};

                if (settings.sessionActive) {
                    await pollModCalls();

                    const now = Date.now();
                    if (now - lastEvalTime >= EVAL_INTERVAL_MS) {
                        lastEvalTime = now;
                        await evaluateStaff(client);
                    }
                }
            } catch (e) {
                console.error('[ShiftMonitor] Poll loop error:', e.message);
            }
            setTimeout(pollLoop, POLL_INTERVAL_MS);
        };

        setTimeout(pollLoop, 5000);
    },
};
