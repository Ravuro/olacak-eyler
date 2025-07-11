// commands/kayit/wl-kayit.js
const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, MessageFlags } = require('discord.js');
const { Settings, Registrations } = require('../../database');
require('dotenv').config();

// Steam kimliğini HEX'e çeviren yardımcı fonksiyon
async function getSteamHex(steamIdentity) {
    let steamID64 = '';
    const match = steamIdentity.match(/(?:profiles\/|id\/)?(\d{17})/);
    if (match && match[1]) {
        steamID64 = match[1];
    } else if (/^\d{17}$/.test(steamIdentity)) {
        steamID64 = steamIdentity;
    } else {
        const apiKey = process.env.STEAM_API_KEY;
        if (!apiKey) return null;
        const urlMatch = steamIdentity.match(/steamcommunity\.com\/(?:id|profiles)\/([^/]+)/);
        if (!urlMatch || !urlMatch[1]) return null;
        const vanityOrId = urlMatch[1];
        try {
            const apiUrl = `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?key=${apiKey}&vanityurl=${vanityOrId}`;
            const response = await fetch(apiUrl);
            const data = await response.json();
            if (data.response && data.response.success === 1 && data.response.steamid) {
                steamID64 = data.response.steamid;
            } else {
                return null;
            }
        } catch { return null; }
    }
    return 'steam:' + BigInt(steamID64).toString(16);
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('wl-kayit')
        .setDescription('Whitelist kayıt sistemi.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles)
        .addUserOption(option => option.setName('kullanici').setDescription('Kaydedilecek Discord kullanıcısı').setRequired(true))
        .addStringOption(option => option.setName('steam-link').setDescription('Kullanıcının Steam profil linki').setRequired(true)),
    async execute(interaction, client) {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const member = interaction.options.getMember('kullanici');
        const steamLink = interaction.options.getString('steam-link');
        const staff = interaction.member;

        const kayitliRolId = (await Settings.findOne({ where: { key: 'wlKayitliRol' } }))?.value;
        const kayitsizRolId = (await Settings.findOne({ where: { key: 'wlKayitsizRol' } }))?.value;
        const logChannelId = (await Settings.findOne({ where: { key: 'kayitLog' } }))?.value;

        if (!kayitliRolId) {
            return interaction.editReply('Kayıtlı rolü ayarlanmamış! Lütfen önce `/kurulum` ile veya ilgili komutla ayarlayın.');
        }

        if (kayitsizRolId) await member.roles.remove(kayitsizRolId).catch(console.error);
        await member.roles.add(kayitliRolId).catch(console.error);

        // İstatistik için veritabanına kaydet
        await Registrations.create({
            staffId: staff.id,
            registeredUserId: member.id,
            guildId: interaction.guild.id,
        });
        
        await interaction.editReply(`**${member.user.tag}** başarıyla kaydedildi!`);

        // Detaylı log oluştur
        if (logChannelId) {
            const logChannel = await client.channels.fetch(logChannelId).catch(() => null);
            if (logChannel) {
                const steamHex = await getSteamHex(steamLink) || 'Hesaplanamadı';
                const website = (await Settings.findOne({ where: { key: 'sunucu-website' } }))?.value;

                const embed = new EmbedBuilder()
                    .setColor('#3498DB')
                    .setAuthor({ name: `${interaction.guild.name} | Kayıt Bilgileri`, iconURL: interaction.guild.iconURL() })
                    .setDescription(
                        `**Kayıt Eden:** ${staff}\n` +
                        `**Kayıt Edilen:** ${member}\n` +
                        `**Steam Profili:** ${steamLink}\n` +
                        `**Hex ID:** \`${steamHex}\``
                    )
                    .setTimestamp();
                if (website) embed.setFooter({ text: `WL Kayıt | ${website}` });

                await logChannel.send({ embeds: [embed] });
            }
        }
    },
};
