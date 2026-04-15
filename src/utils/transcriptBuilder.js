const { AttachmentBuilder, EmbedBuilder } = require('discord.js');

async function buildTranscript(channel, ticketData, closedBy) {
    const messages = [];

    // Use cached messages as a starting point to avoid redundant API calls
    if (channel.messages.cache.size > 0) {
        messages.push(...channel.messages.cache.values());
    }

    // Determine the oldest message ID we already have
    let oldestCachedId = messages.length > 0
        ? messages.reduce((a, b) => (a.createdTimestamp < b.createdTimestamp ? a : b)).id
        : null;

    // Fetch any messages older than what we have cached
    while (true) {
        const options = { limit: 100 };
        if (oldestCachedId) options.before = oldestCachedId;

        const fetched = await channel.messages.fetch(options).catch(() => null);
        if (!fetched || fetched.size === 0) break;

        const newMessages = [...fetched.values()].filter(m => !channel.messages.cache.has(m.id));
        messages.push(...newMessages);

        oldestCachedId = fetched.last()?.id;
        if (fetched.size < 100) break;
    }

    // Sort oldest first, de-duplicate
    const unique = [...new Map(messages.map(m => [m.id, m])).values()];
    unique.sort((a, b) => a.createdTimestamp - b.createdTimestamp);

    // Format into text
    const lines = [];
    lines.push('═══════════════════════════════════════════════════════');
    lines.push(`  TICKET TRANSCRIPT — #${channel.name}`);
    lines.push(`  Ticket #${ticketData.ticketNumber || '?'}`);
    lines.push(`  Opened By: ${ticketData.creatorId ? `<@${ticketData.creatorId}>` : 'Unknown'}`);
    lines.push(`  Closed By: ${closedBy?.username || 'Unknown'}`);
    lines.push(`  Opened At: ${ticketData.openedAt ? new Date(ticketData.openedAt).toUTCString() : 'Unknown'}`);
    lines.push(`  Closed At: ${new Date().toUTCString()}`);
    lines.push(`  Reason: ${ticketData.reason || 'No reason provided'}`);
    lines.push('═══════════════════════════════════════════════════════');
    lines.push('');

    for (const msg of unique) {
        if (msg.author.bot && unique.indexOf(msg) === 0) continue;
        const time        = msg.createdAt.toUTCString();
        const author      = `${msg.author.username}${msg.author.bot ? ' [BOT]' : ''}`;
        const content     = msg.content || '';
        const embeds      = msg.embeds.length > 0 ? `[${msg.embeds.length} embed(s)]` : '';
        const attachments = msg.attachments.size > 0
            ? [...msg.attachments.values()].map(a => `[Attachment: ${a.url}]`).join(' ')
            : '';

        const parts = [content, embeds, attachments].filter(Boolean).join(' ');
        lines.push(`[${time}] ${author}: ${parts || '[no text content]'}`);
    }

    lines.push('');
    lines.push('═══════════════════════════════════════════════════════');
    lines.push('  END OF TRANSCRIPT');
    lines.push('═══════════════════════════════════════════════════════');

    const buffer = Buffer.from(lines.join('\n'), 'utf-8');
    const attachment = new AttachmentBuilder(buffer, {
        name: `transcript-ticket-${ticketData.ticketNumber || channel.name}.txt`,
    });

    const embed = new EmbedBuilder()
        .setTitle(`📄 Ticket Transcript — #${channel.name}`)
        .setColor(0x2B2D75)
        .addFields(
            { name: 'Ticket Number', value: `#${ticketData.ticketNumber || '?'}`,         inline: true },
            { name: 'Opened By',     value: `<@${ticketData.creatorId}>`,                 inline: true },
            { name: 'Closed By',     value: `${closedBy?.username || 'Unknown'}`,         inline: true },
            { name: 'Ticket Reason', value: ticketData.reason || 'No reason provided',    inline: false },
            { name: 'Total Messages',value: `${unique.length}`,                           inline: true },
        )
        .setTimestamp()
        .setFooter({ text: 'Ticket System' });

    return { embed, attachment };
}

module.exports = { buildTranscript };
