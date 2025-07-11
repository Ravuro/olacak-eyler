// commands/yonetim/olusum.js
const { SlashCommandBuilder, EmbedBuilder, PermissionsBitField, ChannelType, MessageFlags } = require('discord.js');
const { Olusum, Settings } = require('../../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('olusum')
        .setDescription('Oluşum (ekip/grup) yönetimi komutları.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommand(subcommand =>
            subcommand.setName('ekle')
                .setDescription('Yeni bir oluşum ekler, rolünü ve kanalını oluşturur.')
                .addStringOption(option => option.setName('isim').setDescription('Oluşumun ismi').setRequired(true))
                .addUserOption(option => option.setName('lider').setDescription('Oluşumun lideri olacak kullanıcı').setRequired(true))
        )
        .addSubcommand(subcommand =>
            subcommand.setName('sil')
                .setDescription('Bir oluşumu rolü ve kanalıyla birlikte siler.')
                .addRoleOption(option => option.setName('olusum-rolu').setDescription('Silinecek oluşumun rolü').setRequired(true))
        )
        .addSubcommand(subcommand => subcommand.setName('liste').setDescription('Sunucudaki tüm oluşumları listeler.'))
        .addSubcommand(subcommand =>
            subcommand.setName('kategori-ayarla')
                .setDescription('Oluşum kanallarının oluşturulacağı kategoriyi ayarlar.')
                .addChannelOption(option => option.setName('kategori').setDescription('Kategori kanalı').setRequired(true).addChannelTypes(ChannelType.GuildCategory))
        ),
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        // DÜZELTME: Güvenilir yöntem olan MessageFlags.Ephemeral kullanıldı.
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        try {
            if (subcommand === 'ekle') {
                const isim = interaction.options.getString('isim');
                const lider = interaction.options.getMember('lider');

                const olusumRol = await interaction.guild.roles.create({ name: isim, mentionable: true }).catch(console.error);
                if (!olusumRol) return interaction.editReply('Rol oluşturulurken bir hata oluştu.');

                await lider.roles.add(olusumRol);

                const kategoriId = (await Settings.findOne({ where: { key: 'olusumKategori' } }))?.value;
                let kategori = kategoriId ? await interaction.guild.channels.fetch(kategoriId).catch(() => null) : null;
                if (!kategori) {
                    kategori = await interaction.guild.channels.create({ name: 'OLUŞUMLAR', type: ChannelType.GuildCategory });
                    await Settings.upsert({ key: 'olusumKategori', value: kategori.id });
                }

                await interaction.guild.channels.create({
                    name: isim.toLowerCase().replace(/ /g, '-'),
                    type: ChannelType.GuildText,
                    parent: kategori.id,
                    permissionOverwrites: [
                        { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                        { id: olusumRol.id, allow: [PermissionsBitField.Flags.ViewChannel] }
                    ],
                });

                await Olusum.create({ name: isim, leaderId: lider.id, roleId: olusumRol.id });
                await interaction.editReply(`**${isim}** oluşumu başarıyla oluşturuldu. Rol ve özel kanal hazırlandı, lider <@${lider.id}> olarak atandı.`);

            } else if (subcommand === 'sil') {
                const rol = interaction.options.getRole('olusum-rolu');
                const olusumData = await Olusum.findOne({ where: { roleId: rol.id } });
                if (!olusumData) return interaction.editReply('Bu role ait bir oluşum kaydı bulunamadı.');

                const channel = interaction.guild.channels.cache.find(c => c.name === olusumData.name.toLowerCase().replace(/ /g, '-'));
                if (channel) await channel.delete('Oluşum silindi.');

                await rol.delete('Oluşum silindi.');
                await olusumData.destroy();
                await interaction.editReply(`**${olusumData.name}** oluşumu başarıyla silindi.`);

            } else if (subcommand === 'liste') {
                const olusumlar = await Olusum.findAll();
                if (olusumlar.length === 0) return interaction.editReply('Sunucuda kayıtlı hiçbir oluşum bulunmuyor.');
                const description = olusumlar.map(o => `**${o.name}** - Lider: <@${o.leaderId}> - Rol: <@&${o.roleId}>`).join('\n');
                const embed = new EmbedBuilder().setTitle('Oluşum Listesi').setDescription(description).setColor('#3498db');
                await interaction.editReply({ embeds: [embed] });

            } else if (subcommand === 'kategori-ayarla') {
                const kategori = interaction.options.getChannel('kategori');
                await Settings.upsert({ key: 'olusumKategori', value: kategori.id });
                await interaction.editReply(`Oluşum kanallarının oluşturulacağı kategori başarıyla **${kategori.name}** olarak ayarlandı.`);
            }
        } catch (error) {
            console.error('Oluşum komutunda hata:', error);
            await interaction.editReply('İşlem sırasında bir hata oluştu.');
        }
    },
};
