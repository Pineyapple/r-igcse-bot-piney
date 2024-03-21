import type GoStudyCommand from "@/commands/miscellaneous/GoStudy";
import type PracticeCommand from "@/commands/study/Practice";
import { StickyMessage } from "@/mongo";
import { ChannelLockdown } from "@/mongo/schemas/ChannelLockdown";
import { Keyword } from "@/mongo/schemas/Keyword";
import { KeywordCache, StickyMessageCache } from "@/redis";
import { syncInteractions } from "@/registry";
import Logger from "@/utils/Logger";
import {
	ActivityType,
	CategoryChannel,
	Colors,
	EmbedBuilder,
	Events,
	ForumChannel,
	PermissionFlagsBits,
	TextChannel,
	ThreadChannel,
	VoiceChannel
} from "discord.js";
import { client } from "..";
import type { DiscordClient } from "../registry/DiscordClient";
import BaseEvent from "../registry/Structure/BaseEvent";

export default class ClientReadyEvent extends BaseEvent {
	constructor() {
		super(Events.ClientReady);
	}

	async execute(client: DiscordClient<true>) {
		if (!client.user) return;

		Logger.info(`Logged in as \x1b[1m${client.user.tag}\x1b[0m`);

		client.user.setPresence({
			activities: [{ type: ActivityType.Watching, name: "r/IGCSE" }],
			status: "online"
		});

		const { format: timeFormatter } = new Intl.DateTimeFormat("en-GB", {
			year: "numeric",
			month: "numeric",
			day: "numeric"
		});

		const mainGuild = client.guilds.cache.get(process.env.MAIN_GUILD_ID);
		if (mainGuild) {
			const channelCount = {
				category: 0,
				text: 0,
				voice: 0,
				forum: 0
			};

			for (const channel of mainGuild.channels.cache)
				if (channel instanceof TextChannel) channelCount.text++;
				else if (channel instanceof CategoryChannel)
					channelCount.category++;
				else if (channel instanceof VoiceChannel) channelCount.voice++;
				else if (channel instanceof ForumChannel) channelCount.forum++;

			const readyEmbed = new EmbedBuilder()
				.setTitle(`${client.user.tag} restarted successfully!`)
				.setColor(Colors.Green)
				.setAuthor({
					name: client.user.tag,
					iconURL: client.user.displayAvatarURL()
				})
				.addFields([
					{
						name: "Bot Information",
						value: `\`\`\`Name: ${client.user.tag}
Created on: ${timeFormatter(client.user.createdAt)}
Joined on: ${timeFormatter(mainGuild.joinedAt)}
Verified: ${client.user.flags?.has("VerifiedBot") ?? "false"}
No. of guilds: ${client.guilds.cache.size}
ID: ${client.user.id}\`\`\``,
						inline: false
					},
					{
						name: "Guild Information",
						value: `\`\`\`Name: ${mainGuild.name}
Owner: ${(await mainGuild.fetchOwner()).user.tag}
Created on: ${timeFormatter(mainGuild.createdAt)}
Members: ${mainGuild.memberCount}
Boosts: ${mainGuild.premiumSubscriptionCount}
ID: ${mainGuild.id}\`\`\``,
						inline: false
					},

					{
						name: "Channels & Commands",
						value: `\`\`\`No. of roles: ${mainGuild.roles.cache.size}
No. of members: ${mainGuild.memberCount}
No. of bots: ${mainGuild.members.cache.filter((member) => member.user.bot).size}
No. of catagories: ${channelCount.category}
No. of text-channels: ${channelCount.text}
No. of voice-channels: ${channelCount.voice}
No. of forum-channels: ${channelCount.forum}
No. of slash-commands: ${client.commands.size}\`\`\``,
						inline: false
					}
				]);

			await Logger.channel(mainGuild, process.env.ERROR_LOGS_CHANNEL_ID, {
				embeds: [readyEmbed]
			});
		}

		const practiceCommand = client.commands.get("practice") as
			| PracticeCommand
			| undefined;

		if (practiceCommand) {
			Logger.info("Starting practice questions loop");
			setInterval(() => practiceCommand.sendQuestions(client), 3500);
		}

		const goStudyCommand = client.commands.get("gostudy") as
			| GoStudyCommand
			| undefined;

		if (goStudyCommand) {
			Logger.info("Starting go study loop");
			setInterval(() => goStudyCommand.expireForcedMute(client), 60000);
		}

		await syncInteractions(client, "1214367926820544512")
			.then(() => Logger.info("Synced application commands globally"))
			.catch(Logger.error);

		await this.loadKeywordsCache()
			.then(() => Logger.info("Populated Keywords Cache"))
			.catch(Logger.error);

		setInterval(
			async () =>
				await this.refreshStickyMessageCache().catch(Logger.error),
			60000
		);

		setInterval(
			async () =>
				await this.refreshChannelLockdowns().catch(Logger.error),
			120000
		);
	}

	private async loadKeywordsCache() {
		const keywords = await Keyword.find();

		// eslint-disable-next-line @typescript-eslint/no-unused-vars
		for (const { _id, ...rest } of keywords.map((keyword) =>
			keyword.toObject()
		))
			KeywordCache.append(rest);
	}

	private async refreshStickyMessageCache() {
		const time = Date.now();

		const stickyMessages = await StickyMessage.find();

		for (const stickyMessage of stickyMessages) {
			const stickTime = parseInt(stickyMessage.stickTime);
			const unstickTime = parseInt(stickyMessage.unstickTime);

			if (stickTime <= time && unstickTime >= time)
				await StickyMessageCache.set(stickyMessage.id, {
					channelId: stickyMessage.channelId,
					messageId: stickyMessage.messageId,
					embeds: stickyMessage.embeds
				});
			else if (unstickTime <= time) {
				await StickyMessage.deleteOne({
					messageId: stickyMessage.messageId
				});

				await StickyMessageCache.remove(stickyMessage.id);
			}
		}
	}

	private async refreshChannelLockdowns() {
		const time = Date.now();

		const lockdownData = await ChannelLockdown.find();

		for (const lockdown of lockdownData) {
			const startTime = parseInt(lockdown.startTimestamp);
			const endTime = parseInt(lockdown.endTimestamp);

			if (startTime <= time && endTime >= time) {
				const channel = client.channels.cache.get(lockdown.channelId);

				if (channel instanceof ThreadChannel && !channel.locked)
					await channel.setLocked(true);
				else if (
					channel instanceof TextChannel ||
					channel instanceof ForumChannel
				) {
					const permissions = channel.permissionsFor(
						channel.guild.roles.everyone
					);

					if (permissions.has(PermissionFlagsBits.SendMessages))
						await channel.permissionOverwrites.edit(
							channel.guild.roles.everyone,
							{
								SendMessages: false,
								SendMessagesInThreads: false
							}
						);
				}
			} else if (endTime <= time)
				await ChannelLockdown.deleteOne({
					channelId: lockdown.channelId
				});
		}
	}
}
