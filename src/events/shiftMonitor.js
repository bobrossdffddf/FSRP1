const { Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { getModCalls, getPlayerName } = require('../api/erlc');
const { getMemberByDiscordId, getShiftsForMember, getServerShifts } = require('../api/melonly');

// ── Tunables ──────────────────────────────────────────────────────────────────
const POLL_INTERVAL_MS   = 60_000;       // poll ERLC every 60s
const EVAL_INTERVAL_MS   = 5 * 60_000;  // evaluate staff every 5 min
const WARN_THRESHOLD     = 0.60;        // below 60% fair share → warning
const SHOUTOUT_THRESHOLD = 1.30;        // above 130% fair share → shoutout
const WARN_COOLDOWN_MS   = 15 * 60_000; // 15 min between warnings per person
const SCANS_TO_FLAG      = 2;           // consecutive bad scans before escalating to flag

// ── Assets ────────────────────────────────────────────────────────────────────
const LOGO_URL   = 'https://i.postimg.cc/T1K1HQCs/FSR-logo-with-tropical-scene.webp';
const FOOTER_URL = 'https://i.postimg.cc/ZRqRj6bf/Untitled-design-(18).webp';

// ── Session state ─────────────────────────────────────────────────────────────
const seenHandledCallKeys = new Set();
const modCallCounts       = new Map(); // modRobloxName → callCount
const modLastCallTime     = new Map(); // modRobloxName → unixTimestamp
let   sessionTotalCalls   = 0;
let   lastEvalTime        = 0;

// ── Per-scan state ────────────────────────────────────────────────────────────
const lastWarnTime        = new Map(); // modName → Date.now()
const consecutiveBadScans = new Map(); // modName → number
const activeFlags         = new Map(); // modName → { messageId, channelId }

// ── Shift tracking state ──────────────────────────────────────────────────────
const knownActiveShiftIds = new Set(); // shift IDs currently on shift

// ── Exports ───────────────────────────────────────────────────────────────────
function resetSessionData() {
    seenHandledCallKeys.clear();
    modCallCounts.clear();
    modLastCallTime.clear();
    sessionTotalCalls = 0;
    lastEvalTime      = 0;
    lastWarnTime.clear();
    consecutiveBadScans.clear();
    activeFlags.clear();
    knownActiveShiftIds.clear();
    console.log('[ShiftMonitor] Session data reset.');
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDuration(ms) {
    const totalSec = Math.floor(ms / 1000);
    const hours    = Math.floor(totalSec / 3600);
    const minutes  = Math.floor((totalSec % 3600) / 60);
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''} and ${minutes} minute${minutes !== 1 ? 's' : ''}`;
    return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
}

function timeAgo(timestamp) {
    if (!timestamp) return 'unknown';
    const diff    = Date.now() - timestamp * 1000;
    const minutes = Math.floor(diff / 60_000);
    const hours   = Math.floor(minutes / 60);
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
        const nick       = normalizeString(m.nickname);
        const globalName = normalizeString(m.user.globalName);
        const username   = normalizeString(m.user.username);
        return nick.includes(normalized) || globalName.includes(normalized) || username.includes(normalized);
    });
}

// ── Melonly shift tracking ────────────────────────────────────────────────────
async function pollShiftChanges() {
    try {
        const resp = await getServerShifts(1, 50);
        const shifts = resp?.data || [];

        const currentActiveIds = new Set();

        for (const shift of shifts) {
            if (shift.endedAt && shift.endedAt !== 0) continue; // already ended

            const shiftId   = shift.id || shift._id;
            const staffName = shift.member?.username || shift.member?.displayName || shift.memberId || 'Unknown';
            const startedAt = shift.createdAt ? new Date(shift.createdAt * 1000).toLocaleTimeString() : 'unknown time';

            if (shiftId) currentActiveIds.add(shiftId);

            // Newly detected active shift → log "on shift"
            if (shiftId && !knownActiveShiftIds.has(shiftId)) {
                knownActiveShiftIds.add(shiftId);
                console.log(`[ShiftMonitor] 🟢 ON SHIFT  — ${staffName} started a shift at ${startedAt} (ID: ${shiftId})`);
            }
        }

        // Detect ended shifts (were active last poll, no longer active)
        for (const id of knownActiveShiftIds) {
            if (!currentActiveIds.has(id)) {
                knownActiveShiftIds.delete(id);
                console.log(`[ShiftMonitor] 🔴 OFF SHIFT — shift ${id} ended`);
            }
        }

        if (currentActiveIds.size > 0) {
            console.log(`[ShiftMonitor] Active shifts: ${currentActiveIds.size}`);
        }
    } catch (e) {
        console.warn('[ShiftMonitor] pollShiftChanges error:', e.message);
    }
}

// ── ERLC mod call polling ─────────────────────────────────────────────────────
async function pollModCalls() {
    try {
        const calls = await getModCalls();
        if (!Array.isArray(calls)) return;

        for (const call of calls) {
            if (!call.Moderator) continue;
            const modName    = getPlayerName(call.Moderator);
            const callerName = getPlayerName(call.Caller);
            const ts         = call.Timestamp || 0;
            const key        = `${callerName}:${ts}`;

            if (!seenHandledCallKeys.has(key)) {
                seenHandledCallKeys.add(key);
                modCallCounts.set(modName, (modCallCounts.get(modName) || 0) + 1);
                modLastCallTime.set(modName, ts);
                sessionTotalCalls++;
                console.log(`[ShiftMonitor] New mod call handled by ${modName}. Session total: ${sessionTotalCalls}`);
            }
        }
    } catch (e) {
        console.warn('[ShiftMonitor] pollModCalls error:', e.message);
    }
}

// ── Melonly: fetch active shift for a Discord member ──────────────────────────
async function getMelonlyShiftLength(discordMember, sessionStartTime) {
    if (!discordMember) return sessionStartTime ? Date.now() - sessionStartTime : null;
    try {
        const melonlyMember = await getMemberByDiscordId(discordMember.id);
        if (!melonlyMember?.id) throw new Error('not found');

        const resp = await getShiftsForMember(melonlyMember.id, 1, 20);
        const shifts = resp?.data || [];

        const activeShift = shifts.find(s => !s.endedAt || s.endedAt === 0);
        if (activeShift?.createdAt) {
            return (Date.now() / 1000 - activeShift.createdAt) * 1000;
        }
    } catch {
        // fall through to session-based fallback
    }
    return sessionStartTime ? Date.now() - sessionStartTime : null;
}

// ── Build the Shift Contribution Flag embed + button ──────────────────────────
function buildFlagEmbed(options) {
    const {
        discordMember, modName, callCount, sessionTotalCalls,
        numActiveStaff, shiftLengthMs, scanCount,
    } = options;

    const fairShareCount  = Math.floor(sessionTotalCalls / numActiveStaff);
    const expectedSharePct = Math.round(100 / numActiveStaff);
    const behind           = fairShareCount - callCount;
    const memberMention    = discordMember ? `${discordMember}` : `**${modName}**`;
    const displayName      = discordMember?.displayName || modName;
    const avatarURL        = discordMember?.user?.displayAvatarURL?.({ dynamic: true });

    const embed = new EmbedBuilder()
        .setColor('#ED4245')
        .setThumbnail(LOGO_URL)
        .setTitle('Shift Contribution Flag')
        .setDescription(`${memberMention}, Your current shift pace needs attention.`)
        .addFields(
            { name: 'Shift Length',    value: `\`${formatDuration(shiftLengthMs || 0)}\``, inline: true },
            { name: 'Calls Handled',   value: `\`${callCount}/${sessionTotalCalls}\``,      inline: true },
            { name: 'Required Calls',  value: `${fairShareCount}`,                          inline: true },
            { name: 'Expected Share',  value: `\`${expectedSharePct}%\``,                   inline: true },
            { name: 'Last Mod Call',   value: `\`${timeAgo(modLastCallTime.get(modName))}\``, inline: true },
            { name: '\u200b',          value: '\u200b',                                     inline: true },
            {
                name: 'Reason',
                value: `Shift deficit confirmed for **${scanCount}** scans. The user is behind by **${behind}** call(s).`,
                inline: false,
            },
            {
                name: 'What To Do To Improve',
                value: `Pick up at least **${behind}** more mod call${behind !== 1 ? 's' : ''} soon so you can recover your pace.`,
                inline: false,
            },
        )
        .setImage(FOOTER_URL)
        .setFooter({ text: 'Awaiting staff review' })
        .setTimestamp();

    if (avatarURL) {
        embed.setAuthor({ name: displayName, iconURL: avatarURL });
    } else {
        embed.setAuthor({ name: displayName });
    }

    return embed;
}

function buildFlagRow(modName) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder()
            .setCustomId(`scflag_resolve:${modName}`)
            .setLabel('Resolve')
            .setStyle(ButtonStyle.Success),
    );
}

// ── Main evaluation loop ──────────────────────────────────────────────────────
async function evaluateStaff(client) {
    const guildId = process.env.MAIN_GUILD_ID;
    if (!guildId) return;

    const guild    = client.guilds.cache.get(guildId);
    if (!guild) return;

    const settings = client.settings.get(guildId) || {};
    if (!settings.sessionActive || !settings.sessionStartTime) return;
    if (sessionTotalCalls === 0) return;

    const shiftChannelId = settings.shiftChannelId;
    const flagChannelId  = settings.flagChannelId || shiftChannelId;

    if (!shiftChannelId && !flagChannelId) return;

    const shiftChannel = shiftChannelId ? client.channels.cache.get(shiftChannelId) : null;
    const flagChannel  = flagChannelId  ? client.channels.cache.get(flagChannelId)  : shiftChannel;

    const numActiveStaff   = Math.max(modCallCounts.size, 1);
    const fairShareCount   = Math.floor(sessionTotalCalls / numActiveStaff);
    const expectedSharePct = Math.round(100 / numActiveStaff);
    const sessionLengthMs  = Date.now() - settings.sessionStartTime;

    const flagRoleIds = settings.flagRoleIds || [];

    for (const [modName, callCount] of modCallCounts.entries()) {
        const shareRatio    = numActiveStaff === 1 ? 1 : callCount / (sessionTotalCalls / numActiveStaff);
        const discordMember = findDiscordMember(guild, modName);
        const now           = Date.now();

        if (shareRatio < WARN_THRESHOLD) {
            const behind     = fairShareCount - callCount;
            const scanCount  = (consecutiveBadScans.get(modName) || 0) + 1;
            consecutiveBadScans.set(modName, scanCount);

            const alreadyFlagged = activeFlags.has(modName);
            const lastWarn       = lastWarnTime.get(modName) || 0;
            const onCooldown     = (now - lastWarn) < WARN_COOLDOWN_MS;

            // ── Escalate to flag ──────────────────────────────────────────────
            if (scanCount >= SCANS_TO_FLAG && !alreadyFlagged && flagChannel) {
                try {
                    const shiftLengthMs = await getMelonlyShiftLength(discordMember, settings.sessionStartTime);

                    const embed = buildFlagEmbed({
                        discordMember, modName, callCount, sessionTotalCalls,
                        numActiveStaff, shiftLengthMs, scanCount,
                    });

                    const rolePings = flagRoleIds.map(id => `<@&${id}>`).join(' ');
                    const memberPing = discordMember ? `${discordMember}` : '';
                    const content = [rolePings, memberPing].filter(Boolean).join(' ');

                    const sent = await flagChannel.send({
                        content: content || undefined,
                        embeds:  [embed],
                        components: [buildFlagRow(modName)],
                    });

                    activeFlags.set(modName, { messageId: sent.id, channelId: flagChannel.id });
                    lastWarnTime.set(modName, now);
                    console.log(`[ShiftMonitor] Flag sent for ${modName} (scan ${scanCount})`);
                } catch (e) {
                    console.error('[ShiftMonitor] Failed to send flag:', e.message);
                }

            // ── Regular warning ───────────────────────────────────────────────
            } else if (!alreadyFlagged && !onCooldown && shiftChannel) {
                const embed = new EmbedBuilder()
                    .setColor('#FEE75C')
                    .setThumbnail(LOGO_URL)
                    .setTitle('Shift Contribution Warning')
                    .setDescription(
                        `${discordMember ? discordMember : `**${modName}**`}, Your current shift pace needs attention.`
                    )
                    .addFields(
                        { name: 'Shift Length',   value: `\`${formatDuration(sessionLengthMs)}\``,              inline: true },
                        { name: 'Calls Handled',  value: `\`${callCount}/${sessionTotalCalls}\``,               inline: true },
                        { name: 'Required Calls', value: `${fairShareCount}`,                                   inline: true },
                        { name: 'Expected Share', value: `\`${expectedSharePct}%\``,                            inline: true },
                        { name: 'Last Mod Call',  value: `\`${timeAgo(modLastCallTime.get(modName))}\``,        inline: true },
                        { name: '\u200b',          value: '\u200b',                                             inline: true },
                        { name: 'Reason',          value: `You are behind pace by **${behind}** call(s).`,     inline: false },
                        {
                            name:  'What To Do To Improve',
                            value: `Pick up at least **${behind}** more mod call${behind !== 1 ? 's' : ''} soon so you can recover your pace.`,
                            inline: false,
                        },
                    )
                    .setImage(FOOTER_URL)
                    .setFooter({ text: 'FSRP Shift Monitor' })
                    .setTimestamp();

                if (discordMember) {
                    embed.setAuthor({
                        name:    discordMember.displayName,
                        iconURL: discordMember.user.displayAvatarURL({ dynamic: true }),
                    });
                }

                try {
                    await shiftChannel.send({
                        content: discordMember ? `${discordMember}` : `**${modName}**`,
                        embeds:  [embed],
                    });
                    lastWarnTime.set(modName, now);
                    console.log(`[ShiftMonitor] Warning sent for ${modName} (scan ${scanCount})`);
                } catch (e) {
                    console.error('[ShiftMonitor] Failed to send warning:', e.message);
                }
            }

        } else if (shareRatio >= SHOUTOUT_THRESHOLD) {
            // Reset bad scan streak when they catch up
            consecutiveBadScans.delete(modName);

            const lastWarn  = lastWarnTime.get(modName) || 0;
            const onCooldown = (now - lastWarn) < WARN_COOLDOWN_MS;
            if (onCooldown || !shiftChannel) continue;

            const embed = new EmbedBuilder()
                .setColor('#57F287')
                .setThumbnail(LOGO_URL)
                .setTitle('Shift Shoutout')
                .setDescription(
                    `✓ ${discordMember ? discordMember : `**${modName}**`} has been putting in strong work this shift.`
                )
                .addFields(
                    { name: 'Current Contribution', value: `${callCount}/${sessionTotalCalls} calls`, inline: true },
                    { name: 'Share',                value: `${Math.round((callCount / sessionTotalCalls) * 100)}%`, inline: true },
                )
                .setImage(FOOTER_URL)
                .setFooter({ text: 'FSRP Shift Monitor' })
                .setTimestamp();

            if (discordMember) {
                embed.setAuthor({
                    name:    discordMember.displayName,
                    iconURL: discordMember.user.displayAvatarURL({ dynamic: true }),
                });
            }

            try {
                await shiftChannel.send({
                    content: discordMember ? `${discordMember}` : `**${modName}**`,
                    embeds:  [embed],
                });
                lastWarnTime.set(modName, now);
                console.log(`[ShiftMonitor] Shoutout sent for ${modName}`);
            } catch (e) {
                console.error('[ShiftMonitor] Failed to send shoutout:', e.message);
            }

        } else {
            // Staff is back in range — reset bad scan streak
            consecutiveBadScans.delete(modName);
        }
    }
}

// ── Module export ─────────────────────────────────────────────────────────────
module.exports = {
    name: Events.ClientReady,
    once: true,
    resetSessionData,
    activeFlags,
    consecutiveBadScans,
    buildFlagEmbed,

    async execute(client) {
        console.log('[ShiftMonitor] Shift monitoring started.');

        const pollLoop = async () => {
            try {
                const guildId  = process.env.MAIN_GUILD_ID;
                const settings = guildId ? (client.settings.get(guildId) || {}) : {};

                if (settings.sessionActive) {
                    await pollModCalls();
                    await pollShiftChanges();

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
