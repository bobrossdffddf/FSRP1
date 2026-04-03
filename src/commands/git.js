const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');

const OWNER_ID = '848356730256883744';
const logFile = path.join(process.cwd(), 'git_commands.log');

const gitLog = (action, error, stdout, stderr) => {
    const timestamp = new Date().toISOString();
    const logEntry = `\n[${timestamp}] ACTION: ${action}\nSTDOUT: ${stdout}\nSTDERR: ${stderr}\nERROR: ${error ? error.message : 'None'}\n${'='.repeat(80)}\n`;
    try {
        fs.appendFileSync(logFile, logEntry);
    } catch (e) {
        console.error(`[GIT] Failed to write to log file: ${e.message}`);
    }
};

const sendGitResponse = async (interaction, type, output, error = null) => {
    try {
        const timestamp = new Date().toISOString();
        let content = '';

        if (error) {
            content = `[${timestamp}] ❌ ${type} Failed\n\`\`\`bash\n${error.message}\n\`\`\``;
            console.error(`[GIT] ${type} error: ${error.message}`);
        } else {
            content = `[${timestamp}] ✅ ${type} Successful\n\`\`\`bash\n${output.slice(0, 1900)}\n\`\`\``;
        }

        if (interaction.replied) {
            await interaction.followUp({ content, flags: 0 }).catch(e => {
                console.error(`[GIT] Failed to send followUp: ${e.message}`);
            });
        } else if (interaction.deferred) {
            await interaction.editReply({ content }).catch(e => {
                console.error(`[GIT] Failed to editReply: ${e.message}`);
            });
        } else {
            await interaction.reply({ content, flags: 0 }).catch(e => {
                console.error(`[GIT] Failed to reply: ${e.message}`);
            });
        }
    } catch (e) {
        console.error(`[GIT] Error in sendGitResponse: ${e.message}`);
    }
};

module.exports = {
    data: new SlashCommandBuilder()
        .setName('git')
        .setDescription('Git management commands (Owner only)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand(subcommand =>
            subcommand.setName('v')
                .setDescription('Show git version and last commit'))
        .addSubcommand(subcommand =>
            subcommand.setName('stash')
                .setDescription('Stash current changes'))
        .addSubcommand(subcommand =>
            subcommand.setName('restart')
                .setDescription('Pull latest changes and restart application')),

    async execute(interaction, client) {
        try {
            const subcommand = interaction.options.getSubcommand();
            const timestamp = new Date().toISOString();

            console.log(`[GIT] [${timestamp}] Subcommand: ${subcommand} by ${interaction.user.tag}`);

            if (subcommand === 'v') {
                try {
                    await interaction.deferReply({ flags: 64 });
                } catch (e) {
                    console.error(`[GIT] Failed to defer reply for 'v': ${e.message}`);
                    return;
                }

                exec('git --version && git log -1 --oneline', (error, stdout, stderr) => {
                    try {
                        gitLog('VERSION', error, stdout, stderr);
                        if (error) {
                            console.error(`[GIT] Git version command failed: ${error.message}`);
                            sendGitResponse(interaction, 'Git Version', '', error);
                        } else {
                            console.log(`[GIT] Git version retrieved successfully`);
                            sendGitResponse(interaction, 'Git Version & Last Commit', stdout || stderr);
                        }
                    } catch (e) {
                        console.error(`[GIT] Error in 'v' callback: ${e.message}`);
                        sendGitResponse(interaction, 'Git Version', '', new Error(e.message));
                    }
                });

            } else if (subcommand === 'stash') {
                try {
                    await interaction.reply('🔄 Stashing current git changes...');
                } catch (e) {
                    console.error(`[GIT] Failed to send initial reply for 'stash': ${e.message}`);
                    return;
                }

                exec('git stash', (error, stdout, stderr) => {
                    try {
                        gitLog('STASH', error, stdout, stderr);
                        if (error) {
                            console.error(`[GIT] Git stash failed: ${error.message}`);
                            sendGitResponse(interaction, 'Stash', '', error);
                        } else {
                            console.log(`[GIT] Git stash completed successfully`);
                            sendGitResponse(interaction, 'Stash', stdout || stderr);
                        }
                    } catch (e) {
                        console.error(`[GIT] Error in 'stash' callback: ${e.message}`);
                        sendGitResponse(interaction, 'Stash', '', new Error(e.message));
                    }
                });

            } else if (subcommand === 'restart') {
                try {
                    await interaction.reply('🔄 Pulling latest git repository and restarting application...');
                } catch (e) {
                    console.error(`[GIT] Failed to send initial reply for 'restart': ${e.message}`);
                    return;
                }

                console.log(`[GIT] Executing: git pull && (pm2 restart all || kill 1)`);
                exec('git pull && (pm2 restart all || kill 1)', (error, stdout, stderr) => {
                    try {
                        gitLog('RESTART', error, stdout, stderr);
                        const alreadyUpToDate = stdout.includes('Already up to date');

                        if (error && !alreadyUpToDate) {
                            console.error(`[GIT] Git restart failed: ${error.message}`);
                            sendGitResponse(interaction, 'Restart', '', error);
                        } else {
                            console.log(`[GIT] Git restart completed successfully`);
                            sendGitResponse(interaction, 'Restart', stdout || stderr);
                        }
                    } catch (e) {
                        console.error(`[GIT] Error in 'restart' callback: ${e.message}`);
                        sendGitResponse(interaction, 'Restart', '', new Error(e.message));
                    }
                });
            }
        } catch (error) {
            console.error(`[GIT] Unhandled error in git command: ${error.message}\n${error.stack}`);
            try {
                if (!interaction.replied && !interaction.deferred) {
                    await interaction.reply({ content: `❌ An error occurred while executing the git command:\n\`\`\`\n${error.message}\n\`\`\``, flags: 64 });
                } else if (interaction.deferred) {
                    await interaction.editReply({ content: `❌ An error occurred while executing the git command:\n\`\`\`\n${error.message}\n\`\`\`` });
                }
            } catch (replyError) {
                console.error(`[GIT] Failed to send error reply: ${replyError.message}`);
            }
        }
    },
};
