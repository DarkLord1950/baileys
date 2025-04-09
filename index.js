const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys')
const { Boom } = require('@hapi/boom')
const qrcode = require('qrcode-terminal')
const fs = require('fs')

async function startSock() {
    // Buat folder untuk menyimpan data autentikasi
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys')
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        defaultQueryTimeoutMs: undefined
    })

    // Tambahkan handler khusus untuk QR code
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update
        
        if(qr) {
            console.log('QR Code:')
            qrcode.generate(qr, {small: true})
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

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        console.log('📩 Received messages:', type)
        const msg = messages[0]
        if (!msg.message) return

        const from = msg.key.remoteJid
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text

        if (text) {
            console.log(`💬 New message from ${from}: ${text}`)
            await sock.sendMessage(from, { text: 'Halo! Ini adalah bot WhatsApp siap konek ke n8n 😎' })
        }
    })

    sock.ev.on('creds.update', saveCreds)
}

startSock()