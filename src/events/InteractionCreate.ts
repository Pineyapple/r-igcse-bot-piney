import {
	ChatInputCommandInteraction,
	ContextMenuCommandInteraction,
	EmbedBuilder,
	Events,
	type Interaction,
} from "discord.js";
import BaseEvent from "../registry/Structure/BaseEvent";
import type { DiscordClient } from "../registry/DiscordClient";
import { logger } from "..";
import { GuildPreferencesCache } from "@/redis";

export default class InteractionCreateEvent extends BaseEvent {
	constructor() {
		super(Events.InteractionCreate);
	}

	async execute(client: DiscordClient<true>, interaction: Interaction) {
		try {
			if (interaction.isChatInputCommand())
				this.handleCommand(client, interaction);
			else if (interaction.isContextMenuCommand())
				this.handleMenu(client, interaction);
		} catch (error) {
			logger.error(error);

			if (!interaction.inCachedGuild()) return;

			const embed = new EmbedBuilder()
				.setAuthor({
					name: "An Exception Occured",
					iconURL: client.user.displayAvatarURL(),
				})
				.setDescription(
					`Channel: <#${interaction.channelId}> \nUser: <@${interaction.user.id}>\nError: ${error}`,
				);

			const guildPreferences = await GuildPreferencesCache.get(
				interaction.guildId,
			);

			const botlogChannelId = guildPreferences.botlogChannelId;
			if (!botlogChannelId) return;

			const botlogChannel = client.channels.cache.get(botlogChannelId);
			if (!botlogChannel || !botlogChannel.isTextBased()) return;

			await botlogChannel.send({ embeds: [embed] });
		}
	}

	async handleCommand(
		client: DiscordClient<true>,
		interaction: ChatInputCommandInteraction,
	) {
		const command = client.commands.get(interaction.commandName);
		if (!command) return;

		await command.execute(client, interaction);
	}
	async handleMenu(
		client: DiscordClient<true>,
		interaction: ContextMenuCommandInteraction,
	) {
		const menu = client.menus.get(interaction.commandName);
		if (!menu) return;

		await menu.execute(client, interaction);
	}
}
