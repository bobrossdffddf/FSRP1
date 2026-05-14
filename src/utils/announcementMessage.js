async function upsertAnnouncementMessage({
    client,
    guildId,
    channel,
    content = '',
    embeds = [],
    components = [],
    announcementMessageId,
}) {
    const settings = client.settings.get(guildId) || {};
    const storedId = announcementMessageId || settings.announcementMessageId;

    // Delete the old message if it exists so the new one appears at the bottom
    if (storedId) {
        try {
            const old = await channel.messages.fetch(storedId);
            await old.delete();
            console.log(`[upsert] Deleted old message ${storedId}`);
        } catch (e) {
            console.log(`[upsert] Could not delete old message ${storedId}: ${e.message}`);
        }
    }

    const sentMessage = await channel.send({ content, embeds, components });
    client.settings.set(guildId, { ...settings, announcementMessageId: sentMessage.id });
    console.log(`[upsert] Sent new message ${sentMessage.id}`);
    return sentMessage;
}

module.exports = {
    upsertAnnouncementMessage,
};
