// commands/rol-oyunu/ic-isim.js
// Bu dosyayı "commands" içinde yeni bir "rol-oyunu" klasörü oluşturup içine koyun.
const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionsBitField, ChannelType, MessageFlags } = require('discord.js');
const { Settings } = require('../../database');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('ic-isim')
        .setDescription('IC isim başvuru sistemini yönetir.')
        .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator)
        .addSubcommand(subcommand =>
            subcommand.setName('kanal-ayarla')
                .setDescription('İsim başvurularının yapılacağı kanalı ayarlar.')
                .addChannelOption(option => option.setName('kanal').setDescription('Başvuru kanalı').setRequired(true).addChannelTypes(ChannelType.GuildText))
        )
        .addSubcommand(subcommand =>
            subcommand.setName('rol-ayarla')
                .setDescription('Onaylanan başvurulara verilecek rolü ayarlar.')
                .addRoleOption(option => option.setName('rol').setDescription('Onay rolü').setRequired(true))
        ),
    async execute(interaction) {
        const subcommand = interaction.options.getSubcommand();
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        if (subcommand === 'kanal-ayarla') {
            const kanal = interaction.options.getChannel('kanal');
            await Settings.upsert({ key: 'icIsimChannel', value: kanal.id });
            await interaction.editReply(`IC İsim başvuru kanalı <#${kanal.id}> olarak ayarlandı. Bu kanala gönderilen mesajlar artık başvuru olarak değerlendirilecek.`);
        } else if (subcommand === 'rol-ayarla') {
            const rol = interaction.options.getRole('rol');
            await Settings.upsert({ key: 'icIsimRole', value: rol.id });
            await interaction.editReply(`IC İsim onay rolü <@&${rol.id}> olarak ayarlandı.`);
        }
    },
};
