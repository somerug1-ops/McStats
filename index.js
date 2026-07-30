require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, AttachmentBuilder, Events } = require('discord.js');
const fetch = require('node-fetch');
const { autocompleteItems, getItemData, renderRecipeCanvas } = require('./item-lookup');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const cooldowns = new Map();
const COOLDOWN_MS = 4000;

const CAPE_MAP = {
  '953cac8b779fe41383e675ee2b86071a71658f2180f56fbce8aa315ea70e2ed6': 'Minecon 2011 Cape',
  'a2e8d97cedbe3a11e82e281504144445e7d073b57c006ae3cc705b66c99c56': 'Minecon 2012 Cape',
  '153b1a0dfcfee953c9f0c2e3914a84d4c57c5a083f21133379532846174a7': 'Minecon 2013 Cape',
  'b0cc08840700447322d953a02b965f1d65a13a603bf64b17c803c21446fe1635': 'Minecon 2015 Cape',
  'e7dfea16e8ca4e66f018028f1663bfe30b6b10a2e4fe3551c262a48ea6cc': 'Minecon 2016 Cape',
  '2340c0e03dd24a11b15a8b33c2a7e9e32abb2051b2481d0ba7defd635ca7a933': 'Migrator Cape',
  '17912790ff164b93196f08ba71d0e62129304776d0f347334f8a6eae509f8a56': 'Vanilla Cape',
  '5920623e1f57b6f63116fb4ae6909459345e89d89ab5ffabf53f93a9d98e82e0': '15th Anniversary Cape',
  '52e37ef31cfc24d455ec325e3698ea4d95bfad3e6e87f827289b7b9f36f3c1b3': 'Cherry Blossom Cape',
  '1f2a9693175c2e1f2b6a50b86a63ffbe7e6f6630f9a26d70d745c43d3b76b6b7': 'TikTok Cape',
  '3e8f85f85e4860b080ebf79155be52467d028448f86050b18f3a388f8d667c46': 'Twitch Cape',
  '80491763ee3958c279c944888edfb40efceeb4ae9edcd4112e457f5c5310': 'Mojang Studios Cape',
};

function identifyCape(capeUrl) {
  if (!capeUrl) return null;
  for (const [hash, name] of Object.entries(CAPE_MAP)) {
    if (capeUrl.includes(hash)) return name;
  }
  return 'Official Mojang Cape';
}

async function getMojangUser(username) {
  const res = await fetch(`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(username)}`);
  if (res.status === 204 || res.status === 404) return null;
  if (!res.ok) throw new Error(`Mojang lookup failed with status ${res.status}`);
  return res.json();
}

async function handleLookup(interaction) {
  const username = interaction.options.getString('username');
  const now = Date.now();
  const lastUsed = cooldowns.get(interaction.user.id) || 0;

  if (now - lastUsed < COOLDOWN_MS) {
    const wait = ((COOLDOWN_MS - (now - lastUsed)) / 1000).toFixed(1);
    await interaction.reply({ content: `Please slow down! Try again in ${wait}s`, ephemeral: true });
    return;
  }
  cooldowns.set(interaction.user.id, now);

  await interaction.deferReply();

  let mojangData;
  try {
    mojangData = await getMojangUser(username);
  } catch (err) {
    await interaction.editReply(`Error connecting to Mojang API: ${err.message}`);
    return;
  }

  if (!mojangData) {
    await interaction.editReply(`Could not find a Minecraft account named **${username}**`);
    return;
  }

  const uuid = mojangData.id;
  const dashedUuid = uuid.replace(/(\w{8})(\w{4})(\w{4})(\w{4})(\w{12})/, '$1-$2-$3-$4-$5');

  const [profileRes, ashconRes, playerDbRes, craftyRes] = await Promise.allSettled([
    fetch(`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`).then(r => r.ok ? r.json() : null),
    fetch(`https://api.ashcon.app/mojang/v2/user/${uuid}`).then(r => r.ok ? r.json() : null),
    fetch(`https://playerdb.co/api/player/minecraft/${uuid}`).then(r => r.ok ? r.json() : null),
    fetch(`https://api.crafty.gg/api/v2/players/${encodeURIComponent(username)}`).then(r => r.ok ? r.json() : null)
  ]);

  const profile = profileRes.value;
  const ashcon = ashconRes.value;
  const playerDb = playerDbRes.value;
  const crafty = craftyRes.value;

  let skinUrl = `https://crafthead.net/skin/${uuid}`;
  let rawCapeUrl = null;
  let modelType = 'Classic (Steve)';

  if (profile?.properties) {
    const texProp = profile.properties.find(p => p.name === 'textures');
    if (texProp) {
      try {
        const decoded = JSON.parse(Buffer.from(texProp.value, 'base64').toString());
        if (decoded.textures?.SKIN?.url) {
          skinUrl = decoded.textures.SKIN.url.replace('http://', 'https://');
        }
        if (decoded.textures?.CAPE?.url) {
          rawCapeUrl = decoded.textures.CAPE.url.replace('http://', 'https://');
        }
        if (decoded.textures?.SKIN?.metadata?.model === 'slim') {
          modelType = 'Slim (Alex)';
        }
      } catch (e) {}
    }
  }

  if (!rawCapeUrl && ashcon?.textures?.cape?.url) {
    rawCapeUrl = ashcon.textures.cape.url.replace('http://', 'https://');
  }

  let capePngUrl = rawCapeUrl ? `https://crafthead.net/cape/${uuid}` : null;

  const pastNamesSet = new Set();

  if (crafty?.data?.usernames) {
    for (const item of crafty.data.usernames) {
      if (item.username && item.username.toLowerCase() !== mojangData.name.toLowerCase()) {
        pastNamesSet.add(item.username);
      }
    }
  }

  if (ashcon?.username_history) {
    for (const item of ashcon.username_history) {
      if (item.username && item.username.toLowerCase() !== mojangData.name.toLowerCase()) {
        pastNamesSet.add(item.username);
      }
    }
  }

  if (playerDb?.data?.player?.meta?.name_history) {
    for (const item of playerDb.data.player.meta.name_history) {
      if (item.name && item.name.toLowerCase() !== mojangData.name.toLowerCase()) {
        pastNamesSet.add(item.name);
      }
    }
  }

  const pastNamesList = Array.from(pastNamesSet);
  const formattedPastNames = pastNamesList.length > 0
    ? pastNamesList.map(n => `\`${n}\``).join(', ')
    : 'None on record';

  let capeText = 'No cape detected';
  if (capePngUrl) {
    const capeName = identifyCape(rawCapeUrl || capePngUrl);
    capeText = `**${capeName}**\n[Download Cape PNG](${capePngUrl})`;
  }

  const createdAtText = ashcon?.created_at ? ashcon.created_at : null;

  const bust3dUrl = `https://render.crafty.gg/3d/bust/${encodeURIComponent(mojangData.name)}?width=300&height=360&x=-30&z=50`;
  const full3dUrl = `https://render.crafty.gg/3d/full/${encodeURIComponent(mojangData.name)}?width=300&height=360&x=-30&z=50`;

  const embed = new EmbedBuilder()
    .setTitle(`Minecraft Profile: ${mojangData.name}`)
    .setURL(`https://namemc.com/profile/${uuid}`)
    .setColor(0x55FF55)
    .setThumbnail(bust3dUrl)
    .setImage(full3dUrl)
    .addFields(
      { name: 'UUID', value: `\`${dashedUuid}\``, inline: false },
      { name: 'Skin Model', value: modelType, inline: true },
      { name: 'Cape Status', value: capeText, inline: true }
    );

  if (createdAtText) {
    embed.addFields({ name: 'Account Created', value: createdAtText, inline: true });
  }

  embed.addFields({ name: 'Previous Usernames', value: formattedPastNames, inline: false });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Download Skin PNG')
      .setStyle(ButtonStyle.Link)
      .setURL(skinUrl),
    new ButtonBuilder()
      .setLabel('View 3D Body')
      .setStyle(ButtonStyle.Link)
      .setURL('https://skin3d.cosmicfi.dev/'),
    new ButtonBuilder()
      .setLabel('View on NameMC')
      .setStyle(ButtonStyle.Link)
      .setURL(`https://namemc.com/profile/${uuid}`)
  );

  if (capePngUrl) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel('Download Cape PNG')
        .setStyle(ButtonStyle.Link)
        .setURL(capePngUrl)
    );
  }

  await interaction.editReply({ embeds: [embed], components: [row] });
}

async function handleItemLookup(interaction) {
  const query = interaction.options.getString('item');
  const result = getItemData(query);

  if (!result || !result.item) {
    await interaction.reply({ content: `Could not find Minecraft item **${query}**`, ephemeral: true });
    return;
  }

  await interaction.deferReply();

  const { item, recipes } = result;
  const wikiUrl = `https://minecraft.wiki/w/${encodeURIComponent(item.displayName.replace(/ /g, '_'))}`;
  const iconUrl = `https://minecraft.wiki/w/Special:FilePath/${encodeURIComponent(item.displayName.replace(/ /g, '_'))}.png`;

  let description = '';
  try {
    const wikiApiUrl = `https://minecraft.wiki/api.php?action=query&titles=${encodeURIComponent(item.displayName.replace(/ /g, '_'))}&prop=extracts&exintro=true&explaintext=true&format=json`;
    const wikiRes = await fetch(wikiApiUrl);
    if (wikiRes.ok) {
      const wikiData = await wikiRes.json();
      const pages = wikiData.query?.pages;
      if (pages) {
        const page = Object.values(pages)[0];
        if (page?.extract) {
          const firstSentence = page.extract.split(/(?<=[.!?])\s/)[0];
          description = firstSentence.length > 200 ? firstSentence.slice(0, 197) + '...' : firstSentence;
        }
      }
    }
  } catch (e) {}

  const embed = new EmbedBuilder()
    .setTitle(item.displayName)
    .setURL(wikiUrl)
    .setColor(0x55FF55)
    .setThumbnail(iconUrl);

  if (description) {
    embed.setDescription(description);
  }

  embed.addFields(
    { name: 'Namespaced ID', value: `\`minecraft:${item.name}\``, inline: true },
    { name: 'Numerical ID', value: `\`${item.id}\``, inline: true },
    { name: 'Stack Size', value: `\`${item.stackSize}\``, inline: true }
  );

  if (item.maxDurability) {
    embed.addFields({ name: 'Max Durability', value: `\`${item.maxDurability}\``, inline: true });
  }

  const files = [];

  if (recipes && recipes.length > 0) {
    try {
      const recipeBuffer = await renderRecipeCanvas(recipes[0], item);
      const attachment = new AttachmentBuilder(recipeBuffer, { name: 'crafting_recipe.png' });
      files.push(attachment);
      embed.setImage('attachment://crafting_recipe.png');
    } catch (err) {
      console.error('Failed to render crafting recipe canvas:', err);
    }
  }

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('View on Minecraft Wiki')
      .setStyle(ButtonStyle.Link)
      .setURL(wikiUrl)
  );

  await interaction.editReply({ embeds: [embed], components: [row], files });
}

client.on('interactionCreate', async interaction => {
  if (interaction.isAutocomplete()) {
    if (interaction.commandName === 'item') {
      try {
        const focusedValue = interaction.options.getFocused();
        const choices = autocompleteItems(focusedValue);
        await interaction.respond(choices);
      } catch (err) {
        console.error('Autocomplete error:', err);
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'lookup' || interaction.commandName === 'info') {
    try {
      await handleLookup(interaction);
    } catch (err) {
      console.error(err);
      if (interaction.deferred) {
        await interaction.editReply('An unexpected error occurred while looking up that profile.');
      } else {
        await interaction.reply('An unexpected error occurred while looking up that profile.');
      }
    }
  } else if (interaction.commandName === 'item') {
    try {
      await handleItemLookup(interaction);
    } catch (err) {
      console.error(err);
      if (interaction.deferred) {
        await interaction.editReply('An unexpected error occurred while looking up that item.');
      } else {
        await interaction.reply('An unexpected error occurred while looking up that item.');
      }
    }
  }
});

client.on('error', err => {
  if (err?.code === 10062 || err?.code === 40060) return;
  console.error('Client error:', err);
});

process.on('unhandledRejection', err => {
  if (err?.code === 10062 || err?.code === 40060) return;
  console.error('Unhandled rejection:', err);
});

client.once(Events.ClientReady, () => {
  console.log(`logged in as ${client.user.tag}`);
});

client.login(process.env.DISCORD_TOKEN);
