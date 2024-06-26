const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const fs = require('node:fs');
require("dotenv").config({ path: "../../.env" });
const config = require("./config.json");

const commands = [];
const commandFiles = fs.readdirSync("./commands", { recursive: true }).filter(file => file.endsWith(".js"));

const clientId = config.clientID;

for (const file of commandFiles) {
	const command = require(`./commands/${file}`);
	commands.push(command.data.toJSON());
}

const rest = new REST({ version: '9' }).setToken(process.env.DISCORD_BOT_TOKEN);

(async () => {
	try {
		console.log("Started refreshing application (/) commands.");

		await rest.put(
			Routes.applicationCommands(clientId),
			{ body: commands },
		);

		console.log("Successfully reloaded application (/) commands globally.");
	} catch (error) {
		console.error(error);
	}
})();