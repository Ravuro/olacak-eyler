// events/interactionCreate.js
const { EmbedBuilder, MessageFlags, PermissionsBitField, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, AttachmentBuilder } = require('discord.js');
const { Op } = require('sequelize');
const { Settings, Tickets, TicketCategories, TicketRatings } = require('../database');
const kurulumCommand = require('../commands/yonetim/kurulum');
const rolKurulumCommand = require('../commands/yonetim/rol-kurulum');
const { setupItems, checkSetup } = kurulumCommand;

/**
 * IC İsim başvurusu butonlarını yönetir.
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handleIcIsimButtons(interaction) {
    if (!interaction.customId.startsWith('ic_isim')) return;
    
    const [action, subAction, targetId, isim] = interaction.customId.split('-');

    if (interaction.user.id === targetId) {
        return interaction.reply({ content: 'Kendi başvurunuzu değerlendiremezsiniz.', flags: MessageFlags.Ephemeral });
    }

    const kayitYetkiliRolId = (await Settings.findOne({ where: { key: 'kayit-yetkili-rol' } }))?.value;
    if (!kayitYetkiliRolId || !interaction.member.roles.cache.has(kayitYetkiliRolId)) {
        return interaction.reply({ content: 'Bu işlemi yapmak için "Kayıt Yetkilisi" rolüne sahip olmalısınız.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferUpdate();
    const targetMember = await interaction.guild.members.fetch(targetId).catch(() => null);
    if (!targetMember) {
        return interaction.followUp({ content: 'Kullanıcı sunucuda bulunamadı.', flags: MessageFlags.Ephemeral });
    }

    if (subAction === 'onayla') {
        const onayRolId = (await Settings.findOne({ where: { key: 'icIsimRole' } }))?.value;
        if (onayRolId) {
            const rol = interaction.guild.roles.cache.get(onayRolId);
            if (rol) await targetMember.roles.add(rol).catch(console.error);
        }
        await targetMember.setNickname(isim, 'IC İsim başvurusu onaylandı.').catch(console.error);
        await interaction.message.edit({ content: `✅ **${interaction.user.tag}** tarafından onaylandı.`, embeds: [], components: [] });
        await targetMember.send(`Tebrikler! **${interaction.guild.name}** sunucusundaki \`${isim}\` isimli başvurunuz onaylandı.`).catch(() => {});
    } else if (subAction === 'reddet') {
        await interaction.message.edit({ content: `❌ **${interaction.user.tag}** tarafından reddedildi.`, embeds: [], components: [] });
        await targetMember.send(`Üzgünüz, **${interaction.guild.name}** sunucusundaki isim başvurunuz reddedildi.`).catch(() => {});
    }
}

/**
 * Kurulum paneli butonlarını yönetir.
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handleKurulumButtons(interaction) {
    if (!interaction.customId.startsWith('kurulum_')) return;
    await interaction.deferUpdate();

    const action = interaction.customId.split('_')[1];
    const guild = interaction.guild;

    if (action === 'sifirla') {
        const keysToDestroy = setupItems.map(item => item.key).concat(setupItems.filter(k => k.statusKey).map(k => k.statusKey));
        const settingsToDelete = await Settings.findAll({ where: { key: keysToDestroy } });
        for (const setting of settingsToDelete) {
            try {
                const itemInfo = setupItems.find(item => item.key === setting.key);
                if (itemInfo?.type === 'channel') {
                    const channel = await guild.channels.fetch(setting.value).catch(() => null);
                    if (channel) await channel.delete('Kurulum sıfırlandı.');
                } else if (itemInfo?.type === 'role') {
                    const role = await guild.roles.fetch(setting.value).catch(() => null);
                    if (role && role.editable) await role.delete('Kurulum sıfırlandı.');
                }
            } catch (error) {
                console.error(`Sıfırlama sırasında varlık silinemedi (ID: ${setting.value}):`, error);
            }
        }
        await Settings.destroy({ where: { key: keysToDestroy } });
        await interaction.followUp({ content: 'Tüm ayarlar, ilgili kanallar ve roller başarıyla sıfırlandı!', flags: MessageFlags.Ephemeral });
    } else if (action === 'kanallar') {
        const channelsToSetup = setupItems.filter(item => item.type === 'channel');
        let logCategory = guild.channels.cache.find(c => c.name === 'MODERASYON' && c.type === ChannelType.GuildCategory);
        if (!logCategory) {
            logCategory = await guild.channels.create({ name: 'MODERASYON', type: ChannelType.GuildCategory, permissionOverwrites: [{ id: guild.id, deny: [PermissionsBitField.Flags.ViewChannel] }] });
        }
        for (const item of channelsToSetup) {
            const setting = await Settings.findOne({ where: { key: item.key } });
            if (setting && !guild.channels.cache.has(setting.value)) await setting.destroy();
            const existing = await Settings.findOne({ where: { key: item.key } });
            if (!existing) {
                const newChannel = await guild.channels.create({ name: `${item.icon}・${item.name}`, type: ChannelType.GuildText, parent: logCategory.id });
                await Settings.upsert({ key: item.key, value: newChannel.id });
                if (item.statusKey) await Settings.upsert({ key: item.statusKey, value: true });
            }
        }
        await interaction.followUp({ content: 'Tüm eksik log kanalları başarıyla oluşturuldu ve ilgili sistemler aktif edildi!', flags: MessageFlags.Ephemeral });
    } else if (action === 'roller') {
        const rolesToSetup = setupItems.filter(item => item.type === 'role');
        for (const item of rolesToSetup) {
             const setting = await Settings.findOne({ where: { key: item.key } });
             if (setting && !guild.roles.cache.has(setting.value)) await setting.destroy();
             const existing = await Settings.findOne({ where: { key: item.key } });
             if (!existing) {
                 const newRole = await guild.roles.create({ name: item.name, mentionable: true });
                 await Settings.upsert({ key: item.key, value: newRole.id });
                 if (item.key === 'otorolRole') await Settings.upsert({ key: 'otorolStatus', value: true });
             }
        }
        await interaction.followUp({ content: 'Tüm eksik temel roller başarıyla oluşturuldu ve ayarlandı!', flags: MessageFlags.Ephemeral });
    }

    const currentStatus = await checkSetup();
    const newEmbed = new EmbedBuilder()
        .setTitle('🤖 Bot Kurulum Yardımcısı (Güncellendi)')
        .setColor(action === 'sifirla' ? '#E74C3C' : '#2ECC71')
        .setDescription('İşlem tamamlandı. Mevcut durum aşağıdadır.')
        .addFields(setupItems.map(item => ({ name: `${item.icon || ''} ${item.name.replace(/-/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}`, value: currentStatus[item.key], inline: true })));
    await interaction.editReply({ embeds: [newEmbed], components: interaction.message.components });
}

/**
 * Gelişmiş Ticket sistemi butonlarını ve modallarını yönetir.
 * @param {import('discord.js').Interaction} interaction
 */
async function handleTicketInteractions(interaction) {
    if (!interaction.customId?.startsWith('ticket_')) return;

    const [type, action, ...params] = interaction.customId.split('_');

    if (interaction.isButton() && action === 'create') {
        const categoryId = params[0];
        const category = await TicketCategories.findByPk(categoryId);
        if (!category) return interaction.reply({ content: 'Bu kategori artık mevcut değil.', flags: MessageFlags.Ephemeral });

        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const user = interaction.user;
        
        let openTicket = await Tickets.findOne({ where: { userId: user.id, status: { [Op.ne]: 'closed' } } });
        if (openTicket) {
            const channelExists = interaction.guild.channels.cache.has(openTicket.channelId);
            if (channelExists) return interaction.editReply(`Zaten açık bir destek talebiniz bulunuyor: <#${openTicket.channelId}>`);
            else await openTicket.destroy();
        }
        
        const ticketChannel = await interaction.guild.channels.create({
            name: `${category.name.toLowerCase().replace(/ /g, '-')}-${user.username}`, type: ChannelType.GuildText,
            permissionOverwrites: [
                { id: interaction.guild.id, deny: [PermissionsBitField.Flags.ViewChannel] },
                { id: user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
                { id: category.supportRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages] },
            ],
        });

        const ticket = await Tickets.create({ channelId: ticketChannel.id, userId: user.id, guildId: interaction.guild.id, categoryId: category.categoryId });
        
        const embed = new EmbedBuilder()
            .setTitle(`${category.name} Talebi`).setColor('#2ECC71').setFooter({ text: `Ticket ID: ${ticket.channelId} | Durum: Açık` })
            .setDescription(`Hoş geldiniz, ${user}! Lütfen sorununuzu detaylıca açıklayın. **${category.name}** ekibi en kısa sürede size yardımcı olacaktır.`);
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('ticket_close_modal').setLabel('Kapat').setStyle(ButtonStyle.Danger),
            new ButtonBuilder().setCustomId('ticket_claim').setLabel('Üstlen').setStyle(ButtonStyle.Primary)
        );
        await ticketChannel.send({ content: `<@&${category.supportRoleId}>, yeni bir **${category.name}** talebi var!`, embeds: [embed], components: [row] });
        await interaction.editReply(`Destek talebiniz başarıyla oluşturuldu: ${ticketChannel}`);
        return;
    }

    if (interaction.isButton() && action === 'rate') {
        const rating = parseInt(params[0]);
        const ticketId = params[1];
        const originalTicket = await Tickets.findOne({ where: { channelId: ticketId } });
        if (!originalTicket) {
            return interaction.update({ content: 'Bu değerlendirme artık geçerli değil veya bir hata oluştu.', components: [] });
        }
        await TicketRatings.create({ ticketId: ticketId, userId: interaction.user.id, rating: rating, staffId: originalTicket.claimedBy });
        await interaction.update({ content: `Değerlendirmeniz için teşekkür ederiz! **${rating}** puan verdiniz.`, components: [] });
        return;
    }

    const ticket = await Tickets.findOne({ where: { channelId: interaction.channel.id } });
    if (!ticket) return;

    if (interaction.isButton()) {
        const category = await TicketCategories.findByPk(ticket.categoryId);
        const supportRoleId = category?.supportRoleId;
        if (supportRoleId && !interaction.member.roles.cache.has(supportRoleId)) {
             return interaction.reply({ content: 'Bu işlemi yapmak için ilgili Destek Ekibi rolüne sahip olmalısınız.', flags: MessageFlags.Ephemeral });
        }
        
        if (interaction.customId === 'ticket_claim') {
            await interaction.deferUpdate();
            await ticket.update({ status: 'claimed', claimedBy: interaction.user.id });
            const originalEmbed = interaction.message.embeds[0];
            const newEmbed = EmbedBuilder.from(originalEmbed).setColor('#F1C40F').setFooter({ text: `Ticket ID: ${ticket.channelId} | Durum: Bu taleple ${interaction.user.tag} ilgileniyor.` });
            const newButtons = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('ticket_close_modal').setLabel('Kapat').setStyle(ButtonStyle.Danger),
                new ButtonBuilder().setCustomId('ticket_claim').setLabel('Üstlenildi').setStyle(ButtonStyle.Primary).setDisabled(true)
            );
            await interaction.editReply({ embeds: [newEmbed], components: [newButtons] });
        }
        
        if (interaction.customId === 'ticket_close_modal') {
            const modal = new ModalBuilder().setCustomId('ticket_close_reason').setTitle('Destek Talebini Kapat');
            const reasonInput = new TextInputBuilder().setCustomId('reason').setLabel('Kapatma Sebebi').setStyle(TextInputStyle.Paragraph).setRequired(true);
            modal.addComponents(new ActionRowBuilder().addComponents(reasonInput));
            await interaction.showModal(modal);
        }
    }

    if (interaction.isModalSubmit() && interaction.customId === 'ticket_close_reason') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const reason = interaction.fields.getTextInputValue('reason');
        
        const messages = await interaction.channel.messages.fetch({ limit: 100 });
        const transcript = messages.reverse().map(m => `[${new Date(m.createdAt).toLocaleString()}] ${m.author.tag}: ${m.content}`).join('\n');
        const attachment = new AttachmentBuilder(Buffer.from(transcript, 'utf-8'), { name: `transcript-${interaction.channel.name}.txt` });

        const ticketOwner = await interaction.client.users.fetch(ticket.userId).catch(() => null);
        if (ticketOwner) {
            const ratingRow = new ActionRowBuilder().addComponents(
                ...[1, 2, 3, 4, 5].map(star => 
                    new ButtonBuilder().setCustomId(`ticket_rate_${star}_${ticket.channelId}`).setLabel('⭐'.repeat(star)).setStyle(ButtonStyle.Primary)
                )
            );
            try {
                await ticketOwner.send({
                    content: `Merhaba! **${interaction.guild.name}** sunucusundaki destek talebiniz kapatılmıştır. Hizmetimizi değerlendirmek için aşağıdan puan verebilirsiniz. Konuşma kaydınız ektedir.`,
                    files: [attachment],
                    components: [ratingRow]
                });
            } catch (dmError) { console.error(`Kullanıcıya DM gönderilemedi (ID: ${ticketOwner.id}):`, dmError); }
        }

        const ticketLogId = (await Settings.findOne({ where: { key: 'ticketLog' } }))?.value;
        if (ticketLogId) {
            const logChannel = await interaction.guild.channels.fetch(ticketLogId).catch(() => null);
            if (logChannel) {
                const logEmbed = new EmbedBuilder()
                    .setColor('#E74C3C').setTitle('Ticket Kapatıldı')
                    .addFields(
                        { name: 'Kapatan Yetkili', value: interaction.user.toString(), inline: true },
                        { name: 'Ticket Sahibi', value: ticketOwner ? ticketOwner.toString() : 'Bilinmiyor', inline: true },
                        { name: 'Sebep', value: reason }
                    ).setTimestamp();
                const logAttachment = new AttachmentBuilder(Buffer.from(transcript, 'utf-8'), { name: `transcript-${interaction.channel.name}.txt` });
                await logChannel.send({ embeds: [logEmbed], files: [logAttachment] });
            }
        }

        await ticket.update({ status: 'closed', closeReason: reason });
        
        await interaction.editReply({ content: 'Talep başarıyla kapatıldı. Kanal 5 saniye içinde silinecektir.' });
        
        await interaction.channel.send({ content: `Bu talep **${interaction.user.tag}** tarafından kapatıldı.\n**Sebep:** ${reason}\nBu kanal 5 saniye içinde silinecektir.` });
        setTimeout(() => interaction.channel.delete('Ticket kapatıldı.').catch(console.error), 5000);
    }
}

/**
 * Rol Kurulumu butonlarını yönetir.
 * @param {import('discord.js').ButtonInteraction} interaction
 */
async function handleRolKurulumButtons(interaction) {
    if (!interaction.customId.startsWith('rolkurulum_')) return;
    await interaction.deferUpdate();

    if (interaction.customId === 'rolkurulum_iptal') {
        return interaction.editReply({ content: 'Rol kurulum işlemi iptal edildi.', embeds: [], components: [] });
    }

    if (interaction.customId === 'rolkurulum_onayla') {
        const { roleHierarchy } = rolKurulumCommand;
        const guild = interaction.guild;
        const createdRoles = new Map();
        let createdCount = 0;

        await interaction.followUp({ content: 'Rol kurulumu başlatıldı, bu işlem biraz sürebilir...', flags: MessageFlags.Ephemeral });

        for (const roleData of [...roleHierarchy].reverse()) {
            const existingRole = guild.roles.cache.find(r => r.name === roleData.name);
            if (!existingRole) {
                const newRole = await guild.roles.create({
                    name: roleData.name,
                    color: roleData.color || '#808080',
                    permissions: [],
                    mentionable: roleData.type !== 'separator',
                });
                createdRoles.set(roleData.name, newRole.id);
                createdCount++;
            } else {
                createdRoles.set(roleData.name, existingRole.id);
            }
        }

        const permissionMap = {};
        roleHierarchy.forEach(roleData => {
            if (roleData.permissions) {
                roleData.permissions.forEach(permKey => {
                    if (!permissionMap[permKey]) {
                        permissionMap[permKey] = [];
                    }
                    const roleId = createdRoles.get(roleData.name);
                    if (roleId) {
                        permissionMap[permKey].push(roleId);
                    }
                });
            }
        });

        for (const [permKey, roleIds] of Object.entries(permissionMap)) {
            const setting = await Settings.findOne({ where: { key: permKey } });
            const existingRoleIds = setting?.value || [];
            const mergedRoleIds = [...new Set([...existingRoleIds, ...roleIds])];
            await Settings.upsert({ key: permKey, value: mergedRoleIds });
        }

        await interaction.editReply({ content: `Kurulum tamamlandı! **${createdCount}** yeni rol oluşturuldu ve tüm yetkiler bu rollere göre atandı.`, embeds: [], components: [] });
    }
}

/**
 * Komut kullanımını loglar.
 */
async function logCommandUsage(interaction) {
    try {
        const logChannelId = (await Settings.findOne({ where: { key: 'botKomutLog' } }))?.value;
        if (!logChannelId) return;
        const logChannel = await interaction.guild.channels.fetch(logChannelId).catch(() => null);
        if (!logChannel) return;
        const options = interaction.options.data.map(opt => {
            let value = opt.value;
            if (opt.role) value = `<@&${opt.role.id}>`;
            if (opt.user) value = `<@${opt.user.id}>`;
            if (opt.channel) value = `<#${opt.channel.id}>`;
            return `\`${opt.name}\`: ${value}`;
        }).join('\n') || 'Yok';
        const embed = new EmbedBuilder()
            .setColor('#3498DB').setTitle('Komut Kullanıldı')
            .addFields(
                { name: 'Kullanan', value: interaction.user.toString(), inline: true },
                { name: 'Komut', value: `\`${interaction.toString()}\``, inline: true },
                { name: 'Kanal', value: interaction.channel.toString(), inline: true },
                { name: 'Parametreler', value: options, inline: false }
            ).setTimestamp();
        await logChannel.send({ embeds: [embed] });
    } catch (error) {
        console.error("Komut loglama sırasında hata:", error);
    }
}

// Ana olay dinleyicisi
module.exports = {
    name: 'interactionCreate',
    async execute(interaction, client) {
        if (interaction.isButton() || interaction.isModalSubmit()) {
            await handleIcIsimButtons(interaction).catch(console.error);
            await handleKurulumButtons(interaction).catch(console.error);
            await handleTicketInteractions(interaction).catch(console.error);
            await handleRolKurulumButtons(interaction).catch(console.error);
            return;
        }

        if (!interaction.isChatInputCommand()) return;
        const command = client.commands.get(interaction.commandName);
        if (!command) return;

        try {
            await command.execute(interaction, client);
            await logCommandUsage(interaction);
        } catch (error) {
            console.error(`Komut yürütülürken hata oluştu: ${interaction.commandName}`, error);
            const errorEmbed = new EmbedBuilder()
                .setColor('#FF0000').setTitle('Bir Hata Oluştu!')
                .setDescription('Bu komutu çalıştırırken beklenmedik bir sorunla karşılaşıldı.')
                .setTimestamp();
            try {
                if (interaction.replied || interaction.deferred) {
                    await interaction.followUp({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
                } else {
                    await interaction.reply({ embeds: [errorEmbed], flags: MessageFlags.Ephemeral });
                }
            } catch (replyError) {
                console.error('Hata mesajı gönderilemedi:', replyError);
            }
        }
    },
};
