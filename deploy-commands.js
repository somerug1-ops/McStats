require('dotenv').config();
const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const usernameOption = builder =>
  builder.addStringOption(opt =>
    opt.setName('username').setDescription('Minecraft username to look up').setRequired(true)
  );

const itemOption = builder =>
  builder.addStringOption(opt =>
    opt.setName('item').setDescription('Minecraft item name (tab to fill)').setRequired(true).setAutocomplete(true)
  );

const commands = [
  usernameOption(new SlashCommandBuilder().setName('lookup').setDescription('Look up a Minecraft account')),
  usernameOption(new SlashCommandBuilder().setName('info').setDescription('Same as /lookup, get info on a Minecraft account')),
  itemOption(new SlashCommandBuilder().setName('item').setDescription('Look up a Minecraft item & its crafting recipe')),
].map(cmd => cmd.toJSON());

const rest = new REST().setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`registering ${commands.length} commands`);

    const data = await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );

    console.log(`done, registered ${data.length} commands`);
  } catch (err) {
    console.error(err);
  }
})();
