const { AttachmentBuilder, EmbedBuilder } = require('discord.js');

// Lazy-load discord-html-transcripts so the bot doesn't crash if the package
// hasn't been installed yet — we fall back to a plain text transcript.
let transcripts = null;
try {
    transcripts = require('discord-html-transcripts');
} catch (err) {
    console.warn(
        '[Transcript] discord-html-transcripts not installed — falling back to plain text. ' +
        'Run `npm i discord-html-transcripts` to enable HTML transcripts with inline images.'
    );
}

/**
 * Build a transcript for a closing ticket.
 *
 * Returns: { embed, attachment, messageCount }
 *   - embed:        EmbedBuilder summary to post alongside the transcript
 *   - attachment:   AttachmentBuilder (HTML if package present, .txt otherwise)
 *   - messageCount: number of messages in the channel
 */
async function buildTranscript(channel, ticketData, closedBy) {
    // ── Always grab a message count for the summary embed ────────────────────
    let messageCount = 0;
    try {
        const all = await fetchAllMessages(channel);
        messageCount = all.length;
    } catch { /* non-fatal */ }

    let attachment = null;

    // ── Preferred path: HTML transcript with inlined images ──────────────────
    if (transcripts && typeof transcripts.createTranscript === 'function') {
        try {
            attachment = await transcripts.createTranscript(channel, {
                limit:       -1,                // all messages
                saveImages:  true,              // inline images as data URIs so they survive channel deletion
                returnType:  'attachment',
                filename:    `transcript-${ticketData.ticketNumber || channel.name}.html`,
                poweredBy:   false,
                footerText:  `Exported {number} message{s}`,
            });
        } catch (err) {
            console.error('[Transcript] HTML build failed, falling back to text:', err.message);
        }
    }

    // ── Fallback: hand-rolled plain text transcript ──────────────────────────
    if (!attachment) {
        attachment = await buildTextTranscript(channel, ticketData, closedBy);
    }

    const embed = new EmbedBuilder()
        .setTitle(`Ticket Transcript — #${channel.name}`)
        .setColor(0x2B2D75)
        .addFields(
            { name: 'Ticket',         value: `#${ticketData.ticketNumber || '?'}`,        inline: true },
            { name: 'Opened By',      value: ticketData.creatorId ? `<@${ticketData.creatorId}>` : '—', inline: true },
            { name: 'Closed By',      value: closedBy ? `${closedBy}` : 'Unknown',        inline: true },
            { name: 'Ticket Reason',  value: ticketData.reason || 'No reason provided',   inline: false },
            { name: 'Total Messages', value: `${messageCount}`,                           inline: true },
            { name: 'Opened At',      value: ticketData.openedAt
                ? `<t:${Math.floor(ticketData.openedAt / 1000)}:f>`
                : '—', inline: true },
            { name: 'Closed At',      value: `<t:${Math.floor(Date.now() / 1000)}:f>`,    inline: true },
        )
        .setTimestamp()
        .setFooter({ text: 'Ticket System' });

    return { embed, attachment, messageCount };
}

/**
 * Fallback text transcript — only used when discord-html-transcripts is
 * unavailable. Preserves attachment URLs even though they expire after
 * channel deletion (still better than nothing).
 */
async function buildTextTranscript(channel, ticketData, closedBy) {
    const messages = await fetchAllMessages(channel);

    const lines = [];
    lines.push('═══════════════════════════════════════════════════════');
    lines.push(`  TICKET TRANSCRIPT — #${channel.name}`);
    lines.push(`  Ticket #${ticketData.ticketNumber || '?'}`);
    lines.push(`  Opened By: ${ticketData.creatorId ? `<@${ticketData.creatorId}>` : 'Unknown'}`);
    lines.push(`  Closed By: ${closedBy?.username || 'Unknown'}`);
    lines.push(`  Opened At: ${ticketData.openedAt ? new Date(ticketData.openedAt).toUTCString() : 'Unknown'}`);
    lines.push(`  Closed At: ${new Date().toUTCString()}`);
    lines.push(`  Reason:    ${ticketData.reason || 'No reason provided'}`);
    lines.push('═══════════════════════════════════════════════════════');
    lines.push('');

    for (const msg of messages) {
        const time        = msg.createdAt.toUTCString();
        const author      = `${msg.author.username}${msg.author.bot ? ' [BOT]' : ''}`;
        const content     = msg.content || '';
        const embeds      = msg.embeds.length > 0 ? `[${msg.embeds.length} embed(s)]` : '';
        const attachments = msg.attachments.size > 0
            ? [...msg.attachments.values()].map(a => `[Attachment: ${a.name} ${a.url}]`).join(' ')
            : '';
        const parts = [content, embeds, attachments].filter(Boolean).join(' ');
        lines.push(`[${time}] ${author}: ${parts || '[no text content]'}`);
    }

    lines.push('');
    lines.push('═══════════════════════════════════════════════════════');
    lines.push('  END OF TRANSCRIPT');
    lines.push('═══════════════════════════════════════════════════════');

    const buffer = Buffer.from(lines.join('\n'), 'utf-8');
    return new AttachmentBuilder(buffer, {
        name: `transcript-${ticketData.ticketNumber || channel.name}.txt`,
    });
}

/**
 * Fetch every message from a channel, oldest first.
 */
async function fetchAllMessages(channel) {
    const collected = new Map();

    // Seed from cache
    for (const msg of channel.messages.cache.values()) collected.set(msg.id, msg);

    let before = collected.size > 0
        ? [...collected.values()].reduce((a, b) => (a.createdTimestamp < b.createdTimestamp ? a : b)).id
        : undefined;

    // Paginate backwards
    while (true) {
        const options = { limit: 100 };
        if (before) options.before = before;

        const batch = await channel.messages.fetch(options).catch(() => null);
        if (!batch || batch.size === 0) break;

        for (const msg of batch.values()) collected.set(msg.id, msg);
        before = batch.last()?.id;
        if (batch.size < 100) break;
    }

    return [...collected.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

module.exports = { buildTranscript };
