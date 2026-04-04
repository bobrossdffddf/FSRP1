const STATUS_CHANNEL_ID = '1487127239505088605';
const CODE_CHANNEL_ID = '1487127239505088606';
const MEMBER_COUNT_CHANNEL_ID = '1487127239505088607';

function stripCodeSuffix(name) {
    if (!name) return '';
    return name.replace(/\s*\|\s*[^|]+$/u, '').trim();
}

async function setChannelNameSafe(channel, nextName) {
    if (!channel || !nextName || channel.name === nextName) return;
    try {
        await channel.setName(nextName);
    } catch (e) {
        console.error(`[Channels] Failed to rename ${channel.id}:`, e.message);
    }
}

async function updateMemberCountChannel(guild) {
    if (!guild) return;

    const memberCountChannel = guild.channels.cache.get(MEMBER_COUNT_CHANNEL_ID);
    if (!memberCountChannel) return;

    const memberCount = guild.memberCount || guild.members.cache.size || 0;
    await setChannelNameSafe(memberCountChannel, `👥 Members: ${memberCount}`);
}

async function setSsuChannelState({ guild, client, isSsu, joinCode }) {
    if (!guild) return;

    const statusChannel = guild.channels.cache.get(STATUS_CHANNEL_ID);
    if (statusChannel) {
        let nextName = statusChannel.name;

        if (isSsu) {
            if (nextName.includes('🔴')) nextName = nextName.replaceAll('🔴', '🟢');
            else if (!nextName.includes('🟢')) nextName = `🟢 ${nextName}`;
        } else {
            if (nextName.includes('🟢')) nextName = nextName.replaceAll('🟢', '🔴');
            else if (!nextName.includes('🔴')) nextName = `🔴 ${nextName}`;
        }

        await setChannelNameSafe(statusChannel, nextName.trim());
    }

    const codeChannel = guild.channels.cache.get(CODE_CHANNEL_ID);
    if (codeChannel) {
        const key = `vcCodeBaseName_${CODE_CHANNEL_ID}`;
        const storedBase = client?.settings?.get(guild.id, key);
        const baseName = storedBase || stripCodeSuffix(codeChannel.name);

        if (client?.settings && !storedBase) {
            client.settings.set(guild.id, baseName, key);
        }

        const nextName = isSsu && joinCode ? `${baseName} | ${joinCode}` : baseName;
        await setChannelNameSafe(codeChannel, nextName.trim());
    }

    await updateMemberCountChannel(guild);
}

module.exports = {
    setSsuChannelState,
    updateMemberCountChannel,
};
