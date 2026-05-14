/**
 * Ticket Manager — stores and retrieves ticket state via Enmap (client.settings).
 *
 * Ticket data shape stored under key `ticket_${channelId}`:
 * {
 *   channelId, guildId, creatorId, claimedBy, reason,
 *   openedAt, ticketNumber, escalationLevel
 * }
 */

function getTicketData(client, channelId) {
    return client.settings.get(`ticket_${channelId}`) || null;
}

function setTicketData(client, channelId, data) {
    const existing = client.settings.get(`ticket_${channelId}`) || {};
    client.settings.set(`ticket_${channelId}`, { ...existing, ...data });
}

function deleteTicketData(client, channelId) {
    client.settings.delete(`ticket_${channelId}`);
}

function nextTicketNumber(client, guildId) {
    const key = `ticket_counter_${guildId}`;
    const current = client.settings.get(key) || 0;
    const next = current + 1;
    client.settings.set(key, next);
    return next;
}

function isTicketChannel(client, channelId) {
    return !!client.settings.get(`ticket_${channelId}`);
}

function getTicketByChannel(client, channelId) {
    return client.settings.get(`ticket_${channelId}`) || null;
}

module.exports = {
    getTicketData,
    setTicketData,
    deleteTicketData,
    nextTicketNumber,
    isTicketChannel,
    getTicketByChannel,
};
