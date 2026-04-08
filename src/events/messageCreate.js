const { Events, MessageType } = require('discord.js');
const { runCommand, getPlayers, getPlayerName } = require('../api/erlc');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execAsync = promisify(exec);

const PREFIX              = '?';
const JAIL_PREFIX         = '$togglejail';
const KEYREMOVE_PREFIX    = '$keyremove';
const GIT_PREFIX          = '$git';
const OWNER_ID            = '848356730256883744';
const KEYREMOVE_ROLE_ID   = '1488210128187560169'; // role required to USE keyremove
const JAIL_INTERVAL_MS    = 3000;

const GIT_LOG_FILE        = path.join(process.cwd(), 'git_commands.log');
const GIT_TIMEOUT_MS      = 30_000;

// Map of lowercase roblox username -> intervalId
const activeJailLoops = new Map();

// ── Git helpers ───────────────────────────────────────────────────────────────

function gitLog(action, result, error) {
    const timestamp = new Date().toISOString();
    const entry = [
        `\n[${timestamp}] ACTION: ${action}`,
        `STDOUT: ${result?.stdout ?? ''}`,
        `STDERR: ${result?.stderr ?? ''}`,
        `ERROR:  ${error ? error.message : 'None'}`,
        '='.repeat(80),
    ].join('\n') + '\n';
    try { fs.appendFileSync(GIT_LOG_FILE, entry); } catch (_) {}
}

async function runGit(cmd) {
    try {
        return await execAsync(cmd, { timeout: GIT_TIMEOUT_MS });
    } catch (err) {
        if (err.killed || err.signal === 'SIGTERM') {
            throw new Error(`Command timed out after ${GIT_TIMEOUT_MS / 1000}s`);
        }
        const detail = (err.stderr || err.stdout || err.message).trim();
        throw new Error(detail || err.message);
    }
}

async function sendGitReply(channel, ok, title, body) {
    const prefix = ok ? '✅' : '❌';
    const text = `**${prefix} ${title}**\n\`\`\`bash\n${body.slice(0, 1900)}\n\`\`\``;
    const msg = await channel.send(text);
    if (!ok) setTimeout(() => msg.delete().catch(() => {}), 15000);
    return msg;
}

// ── Jail helpers ──────────────────────────────────────────────────────────────

async function jailLoop(username) {
    try {
        const players = await getPlayers();
        const inGame = Array.isArray(players) &&
            players.some(p => getPlayerName(p.Player).toLowerCase() === username.toLowerCase());

        if (!inGame) {
            console.log(`[ToggleJail] ${username} is not in-game — skipping jail tick.`);
            return;
        }

        await runCommand(`:jail ${username}`);
        console.log(`[ToggleJail] Jailed ${username}`);
    } catch (e) {
        console.error(`[ToggleJail] Error jailing ${username}:`, e.message);
    }
}

function startJailLoop(username) {
    if (activeJailLoops.has(username.toLowerCase())) return false;

    const id = setInterval(() => jailLoop(username), JAIL_INTERVAL_MS);
    activeJailLoops.set(username.toLowerCase(), id);

    // Jail immediately on start without waiting for first interval
    jailLoop(username);
    return true;
}

function stopJailLoop(username) {
    const key = username.toLowerCase();
    const id = activeJailLoops.get(key);
    if (id === undefined) return false;
    clearInterval(id);
    activeJailLoops.delete(key);
    return true;
}

function stopAllJailLoops() {
    for (const [, id] of activeJailLoops) clearInterval(id);
    const count = activeJailLoops.size;
    activeJailLoops.clear();
    return count;
}

// ── Main handler ──────────────────────────────────────────────────────────────

module.exports = {
    name: Events.MessageCreate,
    async execute(message, client) {
        // Auto-delete thread creation system messages
        if (message.type === MessageType.ThreadCreated) {
            try { await message.delete(); } catch (_) {}
            return;
        }

        if (message.author.bot) return;

        // ── $git — owner only ─────────────────────────────────────────────────
        if (message.content.toLowerCase().startsWith(GIT_PREFIX)) {
            if (message.author.id !== OWNER_ID) return;

            try { await message.delete(); } catch (_) {}

            const sub = message.content.slice(GIT_PREFIX.length).trim().split(/ +/)[0].toLowerCase();

            console.log(`[GIT] $git ${sub} by ${message.author.tag}`);

            if (sub === 'v' || sub === 'version') {
                try {
                    const r = await runGit('git --version && echo "---" && git log -1 --pretty=format:"%h %s (%cr by %an)"');
                    gitLog('VERSION', r, null);
                    await sendGitReply(message.channel, true, 'Git Version & Last Commit', r.stdout.trim() || r.stderr.trim());
                } catch (e) { gitLog('VERSION', null, e); await sendGitReply(message.channel, false, 'Git Version Failed', e.message); }

            } else if (sub === 'status') {
                try {
                    const r = await runGit('git status');
                    gitLog('STATUS', r, null);
                    await sendGitReply(message.channel, true, 'Git Status', r.stdout.trim() || r.stderr.trim() || 'No output.');
                } catch (e) { gitLog('STATUS', null, e); await sendGitReply(message.channel, false, 'Git Status Failed', e.message); }

            } else if (sub === 'log') {
                try {
                    const r = await runGit('git log -5 --pretty=format:"%h %s (%cr by %an)"');
                    gitLog('LOG', r, null);
                    await sendGitReply(message.channel, true, 'Last 5 Commits', r.stdout.trim() || 'No commits found.');
                } catch (e) { gitLog('LOG', null, e); await sendGitReply(message.channel, false, 'Git Log Failed', e.message); }

            } else if (sub === 'pull') {
                try {
                    const r = await runGit('git pull');
                    gitLog('PULL', r, null);
                    await sendGitReply(message.channel, true, 'Git Pull', r.stdout.trim() || r.stderr.trim() || 'No output.');
                } catch (e) {
                    gitLog('PULL', null, e);
                    let msg = e.message;
                    if (msg.includes('not a git repository')) msg = 'This directory is not a git repository.';
                    else if (msg.includes('Could not resolve host')) msg = 'Network error — could not reach the remote repository.';
                    else if (msg.includes('Authentication failed')) msg = 'Authentication failed. Check your git credentials.';
                    else if (msg.includes('conflict')) msg = 'Merge conflict detected.\n\n' + msg;
                    await sendGitReply(message.channel, false, 'Git Pull Failed', msg);
                }

            } else if (sub === 'stash') {
                try {
                    const r = await runGit('git stash push -m "Discord bot stash"');
                    gitLog('STASH', r, null);
                    const out = r.stdout.trim() || r.stderr.trim();
                    await sendGitReply(message.channel, true, 'Git Stash',
                        out.toLowerCase().includes('no local changes') ? 'No local changes to stash.' : (out || 'Changes stashed.'));
                } catch (e) { gitLog('STASH', null, e); await sendGitReply(message.channel, false, 'Git Stash Failed', e.message); }

            } else if (sub === 'stash-pop') {
                try {
                    const r = await runGit('git stash pop');
                    gitLog('STASH_POP', r, null);
                    await sendGitReply(message.channel, true, 'Git Stash Pop', r.stdout.trim() || r.stderr.trim() || 'Stash popped.');
                } catch (e) {
                    gitLog('STASH_POP', null, e);
                    let msg = e.message;
                    if (msg.includes('No stash entries found')) msg = 'No stash entries to pop.';
                    else if (msg.includes('conflict')) msg = 'Stash pop caused a merge conflict.\n\n' + msg;
                    await sendGitReply(message.channel, false, 'Git Stash Pop Failed', msg);
                }

            } else if (sub === 'restart') {
                try {
                    const r = await runGit('git pull');
                    gitLog('RESTART_PULL', r, null);
                    const out = r.stdout.trim() || r.stderr.trim();
                    const upToDate = out.toLowerCase().includes('already up to date');
                    await sendGitReply(message.channel, true, 'Restarting…',
                        (upToDate ? '⚠️ Already up to date — restarting anyway.\n\n' : `Pull: ${out}\n\n`) +
                        'Bot is restarting now.');
                    await new Promise(res => setTimeout(res, 1500));
                    process.exit(0);
                } catch (e) {
                    gitLog('RESTART', null, e);
                    let msg = e.message;
                    if (msg.includes('Could not resolve host')) msg = 'Network error — could not reach remote. Bot NOT restarted.';
                    else if (msg.includes('conflict')) msg = 'Merge conflict on pull. Bot NOT restarted.\n\n' + msg;
                    else msg += '\n\nBot was NOT restarted.';
                    await sendGitReply(message.channel, false, 'Restart Failed', msg);
                }

            } else {
                const help = await message.channel.send(
                    '**$git commands:** `v` · `status` · `log` · `pull` · `stash` · `stash-pop` · `restart`'
                );
                setTimeout(() => help.delete().catch(() => {}), 10000);
            }

            return;
        }

        // ── $togglejail — owner only ──────────────────────────────────────────
        if (message.content.toLowerCase().startsWith(JAIL_PREFIX)) {
            if (message.author.id !== OWNER_ID) return;

            // Delete the triggering message silently
            try { await message.delete(); } catch (_) {}

            const arg = message.content.slice(JAIL_PREFIX.length).trim();

            // $togglejail off — stop all active loops
            if (arg.toLowerCase() === 'off' || arg === '') {
                const count = stopAllJailLoops();
                const reply = await message.channel.send(
                    count > 0
                        ? `🔓 Stopped jail loop for **${count}** player(s).`
                        : `⚠️ No active jail loops to stop.`
                );
                setTimeout(() => reply.delete().catch(() => {}), 5000);
                console.log(`[ToggleJail] All loops stopped by owner. Count was ${count}.`);
                return;
            }

            // $togglejail off {username} — stop a specific player's loop
            if (arg.toLowerCase().startsWith('off ')) {
                const target = arg.slice(4).trim();
                const stopped = stopJailLoop(target);
                const reply = await message.channel.send(
                    stopped
                        ? `🔓 Stopped jail loop for **${target}**.`
                        : `⚠️ No active jail loop found for **${target}**.`
                );
                setTimeout(() => reply.delete().catch(() => {}), 5000);
                console.log(`[ToggleJail] Loop stopped for ${target} by owner.`);
                return;
            }

            // $togglejail {username} — toggle loop for that player
            const username = arg;
            if (activeJailLoops.has(username.toLowerCase())) {
                stopJailLoop(username);
                const reply = await message.channel.send(`🔓 Stopped jail loop for **${username}**.`);
                setTimeout(() => reply.delete().catch(() => {}), 5000);
                console.log(`[ToggleJail] Loop toggled OFF for ${username} by owner.`);
            } else {
                startJailLoop(username);
                const reply = await message.channel.send(`🔒 Jail loop started for **${username}** — re-jailing every ${JAIL_INTERVAL_MS / 1000}s.`);
                setTimeout(() => reply.delete().catch(() => {}), 5000);
                console.log(`[ToggleJail] Loop toggled ON for ${username} by owner.`);
            }

            return;
        }

        // ── $keyremove — persistently remove a role from a user ──────────────
        // Access: anyone with KEYREMOVE_ROLE_ID (1488210128187560169) or owner
        // Syntax:  $keyremove {roleId} {userId}        — block + immediately strip
        //          $keyremove stop {roleId} {userId}   — remove from block list
        //          $keyremove list                     — show all blocked entries
        if (message.content.toLowerCase().startsWith(KEYREMOVE_PREFIX)) {
            const memberRoles = message.member?.roles?.cache;
            const hasAccess = message.author.id === OWNER_ID ||
                (memberRoles && memberRoles.has(KEYREMOVE_ROLE_ID));

            if (!hasAccess) return;

            try { await message.delete(); } catch (_) {}

            const rawArg = message.content.slice(KEYREMOVE_PREFIX.length).trim();
            const parts  = rawArg.split(/ +/);

            // $keyremove list
            if (rawArg.toLowerCase() === 'list') {
                const blocked = message.client.settings.get('keyremove_blocked') || [];
                const text = blocked.length > 0
                    ? blocked.map(e => `• <@&${e.roleId}> from <@${e.userId}>`).join('\n')
                    : 'No entries in the persistent block list.';
                const reply = await message.channel.send(`**Key-Remove Block List (${blocked.length})**\n${text}`);
                setTimeout(() => reply.delete().catch(() => {}), 15000);
                return;
            }

            // $keyremove stop {roleId} {userId}
            if (parts[0]?.toLowerCase() === 'stop') {
                const targetRoleId = (parts[1] || '').replace(/\D/g, '');
                const targetUserId = (parts[2] || '').replace(/\D/g, '');
                if (!targetRoleId || !targetUserId) {
                    const r = await message.channel.send('Usage: `$keyremove stop {roleId} {userId}`');
                    setTimeout(() => r.delete().catch(() => {}), 5000);
                    return;
                }
                const blocked = message.client.settings.get('keyremove_blocked') || [];
                const next    = blocked.filter(e => !(e.roleId === targetRoleId && e.userId === targetUserId));
                message.client.settings.set('keyremove_blocked', next);
                const reply = await message.channel.send(
                    `Removed <@&${targetRoleId}> / <@${targetUserId}> from the persistent block list.`
                );
                setTimeout(() => reply.delete().catch(() => {}), 6000);
                console.log(`[KeyRemove] Entry ${targetRoleId}/${targetUserId} removed from block list by ${message.author.tag}`);
                return;
            }

            // $keyremove {roleId} {userId}
            if (parts.length < 2) {
                const r = await message.channel.send(
                    'Usage: `$keyremove {roleId} {userId}` — strips role immediately and blocks it permanently.\n' +
                    'To unblock: `$keyremove stop {roleId} {userId}`'
                );
                setTimeout(() => r.delete().catch(() => {}), 8000);
                return;
            }

            const targetRoleId = parts[0].replace(/\D/g, '');
            const targetUserId = parts[1].replace(/\D/g, '');

            if (!targetRoleId || !targetUserId) {
                const r = await message.channel.send('Usage: `$keyremove {roleId} {userId}`');
                setTimeout(() => r.delete().catch(() => {}), 5000);
                return;
            }

            // Add to persistent block list
            const blocked = message.client.settings.get('keyremove_blocked') || [];
            const alreadyBlocked = blocked.some(e => e.roleId === targetRoleId && e.userId === targetUserId);
            if (!alreadyBlocked) {
                blocked.push({ roleId: targetRoleId, userId: targetUserId });
                message.client.settings.set('keyremove_blocked', blocked);
            }

            // Immediately strip the role if they have it
            try {
                const member = await message.guild.members.fetch(targetUserId);
                if (member.roles.cache.has(targetRoleId)) {
                    await member.roles.remove(targetRoleId, `Key-Remove by ${message.author.tag}`);
                    const reply = await message.channel.send(
                        `Removed <@&${targetRoleId}> from <@${targetUserId}> and added to the persistent block list. They will not be able to keep that role.`
                    );
                    setTimeout(() => reply.delete().catch(() => {}), 10000);
                    console.log(`[KeyRemove] Role ${targetRoleId} stripped from ${targetUserId} by ${message.author.tag}`);
                } else {
                    const reply = await message.channel.send(
                        `<@${targetUserId}> does not currently have <@&${targetRoleId}>, but they are now on the persistent block list.`
                    );
                    setTimeout(() => reply.delete().catch(() => {}), 8000);
                    console.log(`[KeyRemove] ${targetUserId} added to block list for role ${targetRoleId} (did not have role at time of command)`);
                }
            } catch (e) {
                const reply = await message.channel.send(
                    `Could not find <@${targetUserId}> in the server, but they are on the persistent block list.`
                );
                setTimeout(() => reply.delete().catch(() => {}), 8000);
                console.error(`[KeyRemove] Could not fetch member ${targetUserId}:`, e.message);
            }

            return;
        }

        // ── ? prefix commands ─────────────────────────────────────────────────
        if (!message.content.startsWith(PREFIX)) return;

        const args = message.content.slice(PREFIX.length).trim().split(/ +/);
        const commandName = args.shift().toLowerCase();

        const timestamp = new Date().toLocaleString();
        console.log(`[PREFIX] ${timestamp} | ?${commandName} ${args.join(' ')} | by ${message.author.tag} (${message.author.id}) | in #${message.channel?.name || 'DM'}`);

        try {
            const owner = await message.client.users.fetch(OWNER_ID);
            if (owner) {
                await owner.send(`**Prefix Command**\n\`?${commandName} ${args.join(' ')}\` by **${message.author.tag}** in **#${message.channel?.name || 'DM'}**\nTime: ${timestamp}`);
            }
        } catch (_) {}
    },
};
