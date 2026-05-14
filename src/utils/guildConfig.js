const parseGuildIdsFromCommaList = (value) => {
    if (!value || typeof value !== 'string') return [];

    return value
        .split(',')
        .map(id => id.trim())
        .filter(id => /^\d{17,20}$/.test(id));
};

const getLeoGuildIds = () => {
    const fromList = parseGuildIdsFromCommaList(process.env.LEO_GUILD_IDS);

    const fromIndexed = Object.entries(process.env)
        .filter(([key, value]) => key.startsWith('LEO_GUILD_') && /^\d{17,20}$/.test((value || '').trim()))
        .map(([, value]) => value.trim());

    return [...new Set([...fromList, ...fromIndexed])];
};

const getMainGuildId = () => {
    const value = (process.env.MAIN_GUILD_ID || '').trim();
    return /^\d{17,20}$/.test(value) ? value : null;
};

const isLeoGuild = (guildId) => getLeoGuildIds().includes(guildId);
const isMainGuild = (guildId) => getMainGuildId() === guildId;

module.exports = {
    getLeoGuildIds,
    getMainGuildId,
    isLeoGuild,
    isMainGuild
};
