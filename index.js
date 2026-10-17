import { Client, GatewayIntentBits, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle, StringSelectMenuBuilder, StringSelectMenuOptionBuilder, AttachmentBuilder } from 'discord.js';
import { MongoClient, ObjectId } from 'mongodb';
import QRCode from 'qrcode';

// ================= COLOQUE SEUS DADOS AQUI =================
const TOKEN = 'MTU2MTAxNDg1NjE1NTY2ODU2MA.G4O3h3.PVWUzuMWtA5kinUbfgfK4KOG7B2QItjOdg6vBA';
const CLIENT_ID = '1561014856155668560';
// ==========================================================

const MONGO_URL = 'mongodb+srv://miguelhiago29_db_user:oDnzyQo90GKbtySj@cluster0.bzprmad.mongodb.net/bot_vendas?retryWrites=true&w=majority';

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
let db, configCollection, categoriasCollection, produtosCollection;

MongoClient.connect(MONGO_URL).then(async (mongoClient) => {
    db = mongoClient.db();
    configCollection = db.collection('config');
    categoriasCollection = db.collection('categorias');
    produtosCollection = db.collection('produtos');
    console.log('✅ Conectado ao MongoDB!');
}).catch(err => console.error('Erro no MongoDB:', err));

// Função para gerar o código PIX (Copia e Cola)
function gerarPix(chave, nome, cidade, valor) {
    const tlv = (id, val) => `${id}${val.length.toString().padStart(2, '0')}${val}`;
    const crc16 = (payload) => {
        let crc = 0xffff;
        for (let i = 0; i < payload.length; i++) {
            crc ^= payload.charCodeAt(i) << 8;
            for (let j = 0; j < 8; j++) {
                crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
            }
        }
        return crc.toString(16).toUpperCase().padStart(4, '0');
    };
    const sanitize = (str) => str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9 ]/g, '').trim().toUpperCase();
    const chaveLimpa = chave.replace(/\D/g, '');
    
    const merchantAccount = tlv('26', tlv('00', 'BR.GOV.BCB.PIX') + tlv('01', chaveLimpa));
    const payloadSemCRC = tlv('00', '01') + merchantAccount + tlv('52', '0000') + tlv('53', '986') + tlv('54', valor.toFixed(2)) + tlv('58', 'BR') + tlv('59', sanitize(nome).slice(0, 25)) + tlv('60', sanitize(cidade).slice(0, 15)) + tlv('62', tlv('05', '***'));
    const payloadComCRC = payloadSemCRC + '6304';
    return payloadComCRC + crc16(payloadComCRC);
}

client.once(Events.ClientReady, async (c) => {
    console.log(`🤖 Bot ligado como ${c.user.tag}`);
    try {
        await c.application.commands.create({ name: 'painel', description: 'Abre o painel admin' });
        await c.application.commands.create({ name: 'loja', description: 'Abre a loja' });
    } catch (e) { console.error('Erro comandos:', e); }
});

client.on(Events.InteractionCreate, async (interaction) => {
    // COMANDOS
    if (interaction.isChatInputCommand()) {
        if (interaction.commandName === 'painel') {
            const embed = new EmbedBuilder().setTitle('⚙️ Painel da Loja').setColor(0x5865F2).setDescription('Gerencie sua loja abaixo.');
            const row1 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('pix_config').setLabel('Configurar Pix').setEmoji('💳').setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('cat_add').setLabel('Nova Categoria').setEmoji('📁').setStyle(ButtonStyle.Success),
                new ButtonBuilder().setCustomId('prod_add').setLabel('Novo Produto').setEmoji('📦').setStyle(ButtonStyle.Success)
            );
            const row2 = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('loja_publicar').setLabel('Publicar Loja no Canal').setEmoji('📢').setStyle(ButtonStyle.Danger)
            );
            await interaction.reply({ embeds: [embed], components: [row1, row2], ephemeral: true });
        }
        if (interaction.commandName === 'loja') {
            await abrirLoja(interaction.channel);
            await interaction.reply({ content: 'Loja aberta!', ephemeral: true });
        }
    }

    // BOTÕES DO PAINEL
    if (interaction.isButton()) {
        if (interaction.customId === 'pix_config') {
            const modal = new ModalBuilder().setCustomId('modal_pix').setTitle('Configurar PIX');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('chave').setLabel('Chave PIX (CPF)').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nome').setLabel('Seu Nome').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cidade').setLabel('Sua Cidade').setStyle(TextInputStyle.Short).setRequired(true))
            );
            await interaction.showModal(modal);
        }
        if (interaction.customId === 'cat_add') {
            const modal = new ModalBuilder().setCustomId('modal_cat').setTitle('Nova Categoria');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nome').setLabel('Nome da Categoria (ex: V4)').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cor').setLabel('Cor do Embed (Hex, ex: #FF0000)').setStyle(TextInputStyle.Short).setRequired(true))
            );
            await interaction.showModal(modal);
        }
        if (interaction.customId === 'prod_add') {
            const cats = await categoriasCollection.find({ guildId: interaction.guildId }).toArray();
            if (!cats.length) return interaction.reply({ content: 'Crie uma categoria primeiro.', ephemeral: true });
            
            const modal = new ModalBuilder().setCustomId('modal_prod').setTitle('Novo Produto');
            modal.addComponents(
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('cat_id').setLabel('ID da Categoria (Copie do chat)').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('nome').setLabel('Nome do Produto').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('preco').setLabel('Preço (ex: 15.50)').setStyle(TextInputStyle.Short).setRequired(true)),
                new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('emoji').setLabel('Emoji do Produto (ex: 🍎)').setStyle(TextInputStyle.Short).setRequired(false))
            );
            await interaction.showModal(modal);
        }
        if (interaction.customId === 'loja_publicar') {
            await abrirLoja(interaction.channel);
            await interaction.reply({ content: '✅ Loja publicada com sucesso!', ephemeral: true });
        }
        
        // BOTÃO COMPRAR PRODUTO
        if (interaction.customId.startsWith('comprar_')) {
            const prodId = interaction.customId.split('_')[1];
            const config = await configCollection.findOne({ guildId: interaction.guildId });
            if (!config || !config.chave) return interaction.reply({ content: '❌ O admin ainda não configurou o PIX.', ephemeral: true });
            
            const prod = await produtosCollection.findOne({ _id: new ObjectId(prodId) });
            if (!prod) return interaction.reply({ content: 'Produto não encontrado.', ephemeral: true });
            
            const payload = gerarPix(config.chave, config.nome, config.cidade, prod.preco);
            const qrBuffer = await QRCode.toBuffer(payload, { width: 400 });
            const attachment = new AttachmentBuilder(qrBuffer, { name: 'pix.png' });
            
            const embed = new EmbedBuilder()
                .setTitle(`💳 Pagamento: ${prod.nome}`)
                .setDescription(`Valor: **R$ ${prod.preco.toFixed(2)}**\n\nEscaneie o QR Code ou clique no botão para copiar o código PIX.`)
                .setColor(0x2ecc71)
                .setImage('attachment://pix.png');
                
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId(`copiar_${payload}`).setLabel('Copiar PIX').setEmoji('📋').setStyle(ButtonStyle.Primary)
            );
            
            await interaction.reply({ embeds: [embed], files: [attachment], components: [row], ephemeral: true });
        }
        
        // BOTÃO COPIAR PIX
        if (interaction.customId.startsWith('copiar_')) {
            const payload = interaction.customId.replace('copiar_', '');
            await interaction.reply({ content: `\`\`\`\n${payload}\n\`\`\``, ephemeral: true });
        }
    }

    // FORMULÁRIOS (MODAIS)
    if (interaction.isModalSubmit()) {
        if (interaction.customId === 'modal_pix') {
            await configCollection.updateOne(
                { guildId: interaction.guildId },
                { $set: { chave: interaction.fields.getTextInputValue('chave'), nome: interaction.fields.getTextInputValue('nome'), cidade: interaction.fields.getTextInputValue('cidade') } },
                { upsert: true }
            );
            await interaction.reply({ content: '✅ PIX configurado com sucesso!', ephemeral: true });
        }
        if (interaction.customId === 'modal_cat') {
            const res = await categoriasCollection.insertOne({
                guildId: interaction.guildId,
                nome: interaction.fields.getTextInputValue('nome'),
                cor: interaction.fields.getTextInputValue('cor')
            });
            await interaction.reply({ content: `✅ Categoria criada!\n**ID da Categoria:** \`${res.insertedId}\`\n*(Copie esse ID para criar o produto)*`, ephemeral: true });
        }
        if (interaction.customId === 'modal_prod') {
            await produtosCollection.insertOne({
                guildId: interaction.guildId,
                categoriaId: interaction.fields.getTextInputValue('cat_id').trim(),
                nome: interaction.fields.getTextInputValue('nome'),
                preco: parseFloat(interaction.fields.getTextInputValue('preco').replace(',', '.')),
                estoque: 999, // Estoque infinito por padrão para facilitar
                emoji: interaction.fields.getTextInputValue('emoji') || null
            });
            await interaction.reply({ content: '✅ Produto adicionado com sucesso!', ephemeral: true });
        }
    }
});

// Função que monta a loja visualmente
async function abrirLoja(channel) {
    const guildId = channel.guildId;
    const cats = await categoriasCollection.find({ guildId }).toArray();
    if (!cats.length) return channel.send('Nenhuma categoria cadastrada.');

    for (const cat of cats) {
        const prods = await produtosCollection.find({ categoriaId: cat._id.toString() }).toArray();
        if (!prods.length) continue;

        const embed = new EmbedBuilder()
            .setTitle(`🛒 ${cat.nome}`)
            .setColor(cat.cor || '#5865F2')
            .setDescription('Clique no menu abaixo para ver as opções de compra.');

        const menu = new StringSelectMenuBuilder().setCustomId(`menu_${cat._id}`).setPlaceholder(`Ver produtos de ${cat.nome}`);
        prods.slice(0, 25).forEach(p => {
            const opt = new StringSelectMenuOptionBuilder()
                .setLabel(p.nome)
                .setValue(p._id.toString())
                .setDescription(`Preço: R$ ${p.preco.toFixed(2)}`);
            if (p.emoji) opt.setEmoji(p.emoji);
            menu.addOptions(opt);
        });

        const row = new ActionRowBuilder().addComponents(menu);
        await channel.send({ embeds: [embed], components: [row] });
    }
}

client.login(TOKEN);
