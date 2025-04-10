const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const qrcode = require('qrcode-terminal')
const axios = require('axios')

// Konfigurasi n8n Webhook
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || 'http://localhost:5678/webhook/whatsapp'

// Tambahkan ini untuk mencegah loop
let processedMessages = new Set();
// Set akan membersihkan diri setelah 5 menit untuk menghemat memori
setInterval(() => {
  processedMessages.clear();
}, 5 * 60 * 1000);

async function startSock() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        defaultQueryTimeoutMs: undefined
    })

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update
        
        if(qr) {
            console.log('============ SCAN QR CODE BELOW ============')
            qrcode.generate(qr, {small: true})
            console.log('============================================')
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom) && 
                lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut
            console.log('Connection closed due to ', lastDisconnect.error, ', reconnecting ', shouldReconnect)
            if (shouldReconnect) startSock()
        } else if (connection === 'open') {
            console.log('✅ Bot terhubung ke WhatsApp!')
        }
    })

    // Handler untuk pesan masuk
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        // Hanya proses jika tipe notifikasi adalah 'notify'
        if (type !== 'notify') return;
        
        const msg = messages[0]
        
        // Jika tidak ada pesan atau key, abaikan
        if (!msg || !msg.message || !msg.key) return;
        
        // Cek apakah pesan sudah diproses (mencegah duplikasi)
        const messageId = msg.key.id;
        if (processedMessages.has(messageId)) {
            console.log(`🔄 Pesan dengan ID ${messageId} sudah diproses sebelumnya, diabaikan.`);
            return;
        }
        
        // Tambahkan pesan ke set pesan yang sudah diproses
        processedMessages.add(messageId);
        
        const from = msg.key.remoteJid
        const isGroup = from.endsWith('@g.us')
        
        // Abaikan pesan dari diri sendiri atau dari status
        if (msg.key.fromMe || from === 'status@broadcast') return;
        
        // Ambil pengirim pesan
        const sender = isGroup ? msg.key.participant : from
        
        // Cek apakah ada konten pesan text
        const textContent = msg.message.conversation || 
                          msg.message.extendedTextMessage?.text || 
                          msg.message.imageMessage?.caption ||
                          msg.message.videoMessage?.caption;
        
        if (textContent) {
            console.log(`💬 New message from ${from}: ${textContent}`)
            
            // Data yang akan dikirim ke n8n
            const webhookData = {
                from: from,
                sender: sender,
                text: textContent,
                isGroup: isGroup,
                timestamp: msg.messageTimestamp,
                messageId: messageId
            }
            
            try {
                // Kirim data ke n8n webhook
                const response = await axios.post(N8N_WEBHOOK_URL, webhookData)
                console.log('✅ Pesan terkirim ke n8n:', response.data)
                
                // Jika n8n mengirim respons, kirim ke WhatsApp
                if (response.data && response.data.reply) {
                    await sock.sendMessage(from, { text: response.data.reply })
                } else {
                    // OPTIONAL: Kirim pesan default. Hapus line ini jika tidak ingin bot selalu membalas
                    // await sock.sendMessage(from, { text: 'Pesan Anda telah diterima dan sedang diproses.' })
                }
            } catch (error) {
                console.error('❌ Gagal mengirim pesan ke n8n:', error.message)
                // Kirim pesan error ke pengguna (opsional, bisa dimatikan jika tidak dibutuhkan)
                // await sock.sendMessage(from, { text: 'Maaf, ada masalah dalam memproses pesan Anda.' })
            }
        }
    })

    sock.ev.on('creds.update', saveCreds)
}

startSock()