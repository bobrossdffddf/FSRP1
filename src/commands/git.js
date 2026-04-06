const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { exec } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');

const execAsync = promisify(exec);

const OWNER_ID = '848356730256883744';
const EXEC_TIMEOUT_MS = 30_000;
const logFile = path.join(process.cwd(), 'git_commands.log');

// ── Logging ──────────────────────────────────────────────────────────────────

const gitLog = (action, result, error) => {
    const timestamp = new Date().toISOString();
    const entry = [
        `\n[${timestamp}] ACTION: ${action}`,
        `STDOUT: ${result?.stdout ?? ''}`,
        `STDERR: ${result?.stderr ?? ''}`,
        `ERROR:  ${error ? error.message : 'None'}`,
        '='.repeat(80),
    ].join('\n') + '\n';

    try {
        fs.appendFileSync(logFile, entry);
    } catch (e) {
        console.error(`[GIT] Failed to write log: ${e.message}`);
    }
};

// ── Shell runner ──────────────────────────────────────────────────────────────

/**
 * Runs a shell command with a timeout.
 * Returns { stdout, stderr } or throws with a descriptive message.
 */
const run = async (cmd, timeoutMs = EXEC_TIMEOUT_MS) => {
    try {
        return await execAsync(cmd, { timeout: timeoutMs });
    } catch (err) {
        if (err.killed || err.signal === 'SIGTERM') {
            throw new Error(`Command timed out after ${timeoutMs / 1000}s: \`${cmd}\``);
        }
        // git exits non-zero for things that aren't real failures — surface stderr
        const detail = (err.stderr || err.stdout || err.message).trim();
        throw new Error(detail || err.message);
    }
};

// ── Embed helpers ─────────────────────────────────────────────────────────────

const buildEmbed = (ok, title, description) =>
    new EmbedBuilder()
        .setColor(ok ? 0x57F287 : 0xED4245)
        .setTitle(`${ok ? '✅' : '❌'} ${title}`)
        .setDescription(`\`\`\`bash\n${description.slice(0, 4000)}\n\`\`\``)
        .setTimestamp();

// ── Interaction helper ────────────────────────────────────────────────────────

const editWithEmbed = async (interaction, ok, title, description) => {
    const embed = buildEmbed(ok, title, description);
    try {
        await interaction.editReply({ embeds: [embed] });
    } catch (e) {
        console.error(`[GIT] Failed to edit reply: ${e.message}`);
    }
};

// ── Command ───────────────────────────────────────────────────────────────────

module.exports = {
    data: new SlashCommandBuilder()
        .setName('git')
        .setDescription('Git management commands (Owner only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(sub =>
            sub.setName('v')
                .setDescription('Show git version and last commit'))
        .addSubcommand(sub =>
            sub.setName('status')
                .setDescription('Show working tree status'))
        .addSubcommand(sub =>
            sub.setName('log')
                .setDescription('Show last 5 commits'))
        .addSubcommand(sub =>
            sub.setName('pull')
                .setDescription('Pull latest changes from remote'))
        .addSubcommand(sub =>
            sub.setName('stash')
                .setDescription('Stash current changes'))
        .addSubcommand(sub =>
            sub.setName('stash-pop')
                .setDescription('Pop the most recent stash'))
        .addSubcommand(sub =>
            sub.setName('restart')
                .setDescription('Pull latest changes and restart the bot')),

    async execute(interaction, client) {
        // ── Owner guard ───────────────────────────────────────────────────────
        if (interaction.user.id !== OWNER_ID) {
            return interaction.reply({
                content: '❌ Only the bot owner can run git commands.',
                flags: 64,
            });
        }

        const sub = interaction.options.getSubcommand();
        const timestamp = new Date().toISOString();
        console.log(`[GIT] [${timestamp}] /${sub} invoked by ${interaction.user.tag}`);

        // Always defer — git commands can be slow
        try {
            await interaction.deferReply({ flags: 64 });
        } catch (e) {
            console.error(`[GIT] Failed to defer: ${e.message}`);
            return;
        }

        // ── Subcommands ───────────────────────────────────────────────────────

        if (sub === 'v') {
            try {
                const result = await run('git --version && echo "---" && git log -1 --pretty=format:"%h %s (%cr by %an)"');
                gitLog('VERSION', result, null);
                await editWithEmbed(interaction, true, 'Git Version & Last Commit', result.stdout.trim() || result.stderr.trim());
            } catch (err) {
                gitLog('VERSION', null, err);
                console.error(`[GIT] v error: ${err.message}`);
                await editWithEmbed(interaction, false, 'Git Version Failed', err.message);
            }

        } else if (sub === 'status') {
            try {
                const result = await run('git status');
                gitLog('STATUS', result, null);
                const out = result.stdout.trim() || result.stderr.trim() || 'No output.';
                await editWithEmbed(interaction, true, 'Git Status', out);
            } catch (err) {
                gitLog('STATUS', null, err);
                console.error(`[GIT] status error: ${err.message}`);
                await editWithEmbed(interaction, false, 'Git Status Failed', err.message);
            }

        } else if (sub === 'log') {
            try {
                const result = await run('git log -5 --pretty=format:"%h %s (%cr by %an)"');
                gitLog('LOG', result, null);
                const out = result.stdout.trim() || 'No commits found.';
                await editWithEmbed(interaction, true, 'Last 5 Commits', out);
            } catch (err) {
                gitLog('LOG', null, err);
                console.error(`[GIT] log error: ${err.message}`);
                await editWithEmbed(interaction, false, 'Git Log Failed', err.message);
            }

        } else if (sub === 'pull') {
            try {
                const result = await run('git pull');
                gitLog('PULL', result, null);
                const out = result.stdout.trim() || result.stderr.trim() || 'No output.';
                await editWithEmbed(interaction, true, 'Git Pull', out);
            } catch (err) {
                gitLog('PULL', null, err);
                console.error(`[GIT] pull error: ${err.message}`);

                let msg = err.message;
                if (msg.includes('not a git repository')) msg = 'This directory is not a git repository.';
                else if (msg.includes('Could not resolve host')) msg = 'Network error — could not reach the remote repository.';
                else if (msg.includes('Authentication failed')) msg = 'Authentication failed. Check your git credentials.';
                else if (msg.includes('conflict')) msg = 'Merge conflict detected. Resolve conflicts before pulling.\n\n' + msg;

                await editWithEmbed(interaction, false, 'Git Pull Failed', msg);
            }

        } else if (sub === 'stash') {
            try {
                const result = await run('git stash push -m "Discord bot stash"');
                gitLog('STASH', result, null);

                const out = result.stdout.trim() || result.stderr.trim();

                // "No local changes to save" is not an error — handle it kindly
                if (out.toLowerCase().includes('no local changes')) {
                    await editWithEmbed(interaction, true, 'Git Stash', 'No local changes to stash. Working tree is clean.');
                } else {
                    await editWithEmbed(interaction, true, 'Git Stash', out || 'Changes stashed successfully.');
                }
            } catch (err) {
                gitLog('STASH', null, err);
                console.error(`[GIT] stash error: ${err.message}`);

                let msg = err.message;
                if (msg.includes('not a git repository')) msg = 'This directory is not a git repository.';
                else if (msg.includes('You do not have the initial commit yet')) msg = 'Cannot stash — no commits exist yet in this repository.';

                await editWithEmbed(interaction, false, 'Git Stash Failed', msg);
            }

        } else if (sub === 'stash-pop') {
            try {
                const result = await run('git stash pop');
                gitLog('STASH_POP', result, null);
                const out = result.stdout.trim() || result.stderr.trim() || 'Stash popped successfully.';
                await editWithEmbed(interaction, true, 'Git Stash Pop', out);
            } catch (err) {
                gitLog('STASH_POP', null, err);
                console.error(`[GIT] stash-pop error: ${err.message}`);

                let msg = err.message;
                if (msg.includes('No stash entries found')) msg = 'No stash entries to pop. Run `/git stash` first.';
                else if (msg.includes('conflict')) msg = 'Stash pop caused a merge conflict. Resolve conflicts manually.\n\n' + msg;

                await editWithEmbed(interaction, false, 'Git Stash Pop Failed', msg);
            }

        } else if (sub === 'restart') {
            try {
                const pullResult = await run('git pull');
                gitLog('RESTART_PULL', pullResult, null);

                const pullOut = pullResult.stdout.trim() || pullResult.stderr.trim();
                const alreadyUpToDate = pullOut.toLowerCase().includes('already up to date');

                await editWithEmbed(
                    interaction,
                    true,
                    'Restarting…',
                    (alreadyUpToDate ? '⚠️ Already up to date — restarting anyway.\n\n' : `Pull successful:\n${pullOut}\n\n`) +
                    'Bot is restarting now. It will be back online in a few seconds.'
                );

                // Give Discord time to deliver the message before we die
                await new Promise(r => setTimeout(r, 1500));
                process.exit(0);

            } catch (err) {
                gitLog('RESTART', null, err);
                console.error(`[GIT] restart error: ${err.message}`);

                let msg = err.message;
                if (msg.includes('Could not resolve host')) msg = 'Network error — could not reach the remote repository. Bot was NOT restarted.';
                else if (msg.includes('conflict')) msg = 'Merge conflict on pull. Resolve conflicts first. Bot was NOT restarted.\n\n' + msg;
                else msg += '\n\nBot was NOT restarted.';

                await editWithEmbed(interaction, false, 'Restart Failed', msg);
            }
        }
    },
};
