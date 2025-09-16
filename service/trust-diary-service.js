#!/usr/bin/env node

import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { EventEmitter } from 'events';
import nacl from 'tweetnacl';
import naclUtil from 'tweetnacl-util';
import { joinRoom } from 'trystero/torrent';
import wrtc from '@roamhq/wrtc';
import express from 'express';
import cors from 'cors';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Trust Diary Service - Persistent P2P WebRTC Service
 *
 * Architecture:
 * - Always-on Node.js service maintaining WebRTC presence
 * - Persistent room on WebTorrent trackers
 * - Authentication via cryptographic signatures
 * - Admin can connect with full access
 * - Trusted users can connect with read access
 * - Room ID derived from service's public key + salt for obscurity
 */

class TrustDiaryService extends EventEmitter {
    constructor(config = {}) {
        super();

        this.config = {
            port: config.port || 3333,
            dataDir: config.dataDir || './diary-data',
            roomSalt: config.roomSalt || 'trust-diary-v1',
            ...config
        };

        // Service identity
        this.identity = null;
        this.trustedKeys = new Map();
        this.entries = [];
        this.connections = new Map();

        // P2P room
        this.room = null;
        this.roomId = null;

        // WebSocket for local connections
        this.wss = null;
        this.server = null;
    }

    async initialize() {
        console.log('🚀 Initializing Trust Diary Service...');

        // Load or generate identity
        await this.loadIdentity();

        // Load trusted keys and entries
        await this.loadTrustedKeys();
        await this.loadEntries();

        // Start HTTP/WebSocket server for admin UI
        await this.startLocalServer();

        // Start P2P presence
        await this.startP2PRoom();

        console.log('✅ Service initialized');
        console.log(`📍 Admin UI: http://localhost:${this.config.port}`);
        console.log(`🔑 Service Public Key: ${this.getPublicKeyString().substring(0, 32)}...`);
        console.log(`🌐 P2P Room ID: ${this.roomId}`);
    }

    async loadIdentity() {
        const identityPath = path.join(this.config.dataDir, 'identity.json');

        try {
            await fs.mkdir(this.config.dataDir, { recursive: true });
            const data = await fs.readFile(identityPath, 'utf8');
            const stored = JSON.parse(data);

            this.identity = {
                keyPair: {
                    publicKey: naclUtil.decodeBase64(stored.publicKey),
                    secretKey: naclUtil.decodeBase64(stored.secretKey)
                },
                boxKeyPair: {
                    publicKey: naclUtil.decodeBase64(stored.boxPublicKey),
                    secretKey: naclUtil.decodeBase64(stored.boxSecretKey)
                }
            };

            console.log('📂 Loaded existing identity');
        } catch (err) {
            // Generate new identity
            this.identity = {
                keyPair: nacl.sign.keyPair(),
                boxKeyPair: nacl.box.keyPair()
            };

            const toStore = {
                publicKey: naclUtil.encodeBase64(this.identity.keyPair.publicKey),
                secretKey: naclUtil.encodeBase64(this.identity.keyPair.secretKey),
                boxPublicKey: naclUtil.encodeBase64(this.identity.boxKeyPair.publicKey),
                boxSecretKey: naclUtil.encodeBase64(this.identity.boxKeyPair.secretKey),
                createdAt: new Date().toISOString()
            };

            await fs.writeFile(identityPath, JSON.stringify(toStore, null, 2));
            console.log('🔐 Generated new identity');
        }
    }

    async loadTrustedKeys() {
        const trustedPath = path.join(this.config.dataDir, 'trusted.json');

        try {
            const data = await fs.readFile(trustedPath, 'utf8');
            const trusted = JSON.parse(data);

            trusted.forEach(entry => {
                this.trustedKeys.set(entry.publicKey, {
                    boxPublicKey: entry.boxPublicKey,
                    name: entry.name,
                    trustedAt: entry.trustedAt,
                    permissions: entry.permissions || ['read']
                });
            });

            console.log(`👥 Loaded ${this.trustedKeys.size} trusted keys`);
        } catch (err) {
            console.log('👥 No trusted keys found');
        }
    }

    async saveTrustedKeys() {
        const trustedPath = path.join(this.config.dataDir, 'trusted.json');

        const trusted = Array.from(this.trustedKeys.entries()).map(([publicKey, info]) => ({
            publicKey,
            ...info
        }));

        await fs.writeFile(trustedPath, JSON.stringify(trusted, null, 2));
    }

    async loadEntries() {
        const entriesPath = path.join(this.config.dataDir, 'entries.json');

        try {
            const data = await fs.readFile(entriesPath, 'utf8');
            this.entries = JSON.parse(data);
            console.log(`📝 Loaded ${this.entries.length} entries`);
        } catch (err) {
            this.entries = [{
                id: 1,
                content: "Trust Diary Service started",
                timestamp: Date.now(),
                author: "Service"
            }];
            await this.saveEntries();
        }
    }

    async saveEntries() {
        const entriesPath = path.join(this.config.dataDir, 'entries.json');
        await fs.writeFile(entriesPath, JSON.stringify(this.entries, null, 2));
    }

    getPublicKeyString() {
        return naclUtil.encodeBase64(this.identity.keyPair.publicKey);
    }

    getBoxPublicKeyString() {
        return naclUtil.encodeBase64(this.identity.boxKeyPair.publicKey);
    }

    generateRoomId() {
        // Room ID based on service public key + salt
        // This makes it discoverable if you know the service's public key
        const material = `${this.config.roomSalt}:${this.getPublicKeyString()}`;
        const hash = nacl.hash(naclUtil.decodeUTF8(material));
        return naclUtil.encodeBase64(hash).substring(0, 20);
    }

    async startP2PRoom() {
        this.roomId = this.generateRoomId();

        console.log('🌐 Starting P2P room...');

        // Join room with persistent presence (with Node.js WebRTC support)
        this.room = joinRoom(
            { appId: 'trust-diary-service', password: this.roomId, rtcConfig: { wrtc } },
            this.roomId
        );

        // Set up P2P handlers
        this.room.onPeerJoin(peerId => {
            console.log(`👤 Peer joined: ${peerId.substring(0, 8)}...`);
            this.handlePeerJoin(peerId);
        });

        this.room.onPeerLeave(peerId => {
            console.log(`👋 Peer left: ${peerId.substring(0, 8)}...`);
            this.connections.delete(peerId);
        });

        // Set up authenticated channels (max 12 bytes for action names)
        const [sendChallenge, getChallenge] = this.room.makeAction('challenge');
        const [sendResponse, getResponse] = this.room.makeAction('response');
        const [sendEntry, getEntry] = this.room.makeAction('entry');
        const [sendAnnouncement, getAnnouncement] = this.room.makeAction('announce');

        this.p2pActions = {
            sendChallenge,
            sendResponse,
            sendEntry,
            sendAnnouncement
        };

        // Handle authentication challenges
        getChallenge(async (data, peerId) => {
            await this.handleAuthChallenge(data, peerId);
        });

        getResponse(async (data, peerId) => {
            await this.handleAuthResponse(data, peerId);
        });

        // Broadcast presence announcement periodically
        this.startPresenceBroadcast();
    }

    handlePeerJoin(peerId) {
        // Send authentication challenge
        const challenge = nacl.randomBytes(32);

        this.connections.set(peerId, {
            state: 'challenging',
            challenge: naclUtil.encodeBase64(challenge),
            joinedAt: Date.now()
        });

        this.p2pActions.sendChallenge({
            challenge: naclUtil.encodeBase64(challenge),
            servicePublicKey: this.getPublicKeyString(),
            serviceBoxPublicKey: this.getBoxPublicKeyString()
        });
    }

    async handleAuthChallenge(data, peerId) {
        // Peer is challenging us (shouldn't happen for service, but handle it)
        console.log(`🔐 Received challenge from ${peerId.substring(0, 8)}`);
    }

    async handleAuthResponse(data, peerId) {
        const conn = this.connections.get(peerId);
        if (!conn || conn.state !== 'challenging') {
            console.log(`⚠️ Unexpected auth response from ${peerId.substring(0, 8)}`);
            return;
        }

        try {
            // Verify the signature
            const signature = naclUtil.decodeBase64(data.signature);
            const publicKey = naclUtil.decodeBase64(data.publicKey);
            const challenge = naclUtil.decodeBase64(conn.challenge);

            const verified = nacl.sign.detached.verify(
                challenge,
                signature,
                publicKey
            );

            if (!verified) {
                console.log(`❌ Authentication failed for ${peerId.substring(0, 8)}`);
                return;
            }

            // Check if this key is trusted
            const publicKeyStr = data.publicKey;
            const trustedInfo = this.trustedKeys.get(publicKeyStr);

            if (!trustedInfo) {
                console.log(`⛔ Untrusted key from ${peerId.substring(0, 8)}`);
                conn.state = 'untrusted';
                return;
            }

            // Authentication successful
            conn.state = 'authenticated';
            conn.publicKey = publicKeyStr;
            conn.permissions = trustedInfo.permissions;
            conn.name = trustedInfo.name;

            console.log(`✅ Authenticated: ${trustedInfo.name} (${peerId.substring(0, 8)}...)`);

            // Send current entries to authenticated peer
            this.sendEntriesToPeer(peerId);

        } catch (err) {
            console.error(`❌ Auth error for ${peerId.substring(0, 8)}:`, err);
        }
    }

    sendEntriesToPeer(peerId) {
        const conn = this.connections.get(peerId);
        if (!conn || conn.state !== 'authenticated') return;

        // Encrypt entries for this peer
        const trustedInfo = this.trustedKeys.get(conn.publicKey);
        if (!trustedInfo) return;

        this.entries.forEach(entry => {
            const encrypted = this.encryptForPeer(entry, trustedInfo.boxPublicKey);
            this.p2pActions.sendEntry(encrypted);
        });
    }

    encryptForPeer(data, peerBoxPublicKey) {
        const message = naclUtil.decodeUTF8(JSON.stringify(data));
        const nonce = nacl.randomBytes(nacl.box.nonceLength);
        const encrypted = nacl.box(
            message,
            nonce,
            naclUtil.decodeBase64(peerBoxPublicKey),
            this.identity.boxKeyPair.secretKey
        );

        return {
            nonce: naclUtil.encodeBase64(nonce),
            encrypted: naclUtil.encodeBase64(encrypted)
        };
    }

    startPresenceBroadcast() {
        // Broadcast encrypted announcements periodically
        const broadcast = () => {
            const announcement = {
                type: 'service_presence',
                name: 'Trust Diary Service',
                timestamp: Date.now(),
                entriesCount: this.entries.length,
                publicKey: this.getPublicKeyString()
            };

            // Encrypt for each trusted peer
            this.trustedKeys.forEach((info, publicKey) => {
                const encrypted = this.encryptForPeer(announcement, info.boxPublicKey);
                if (this.p2pActions.sendAnnouncement) {
                    this.p2pActions.sendAnnouncement(encrypted);
                }
            });
        };

        // Broadcast every 30 seconds
        setInterval(broadcast, 30000);
        broadcast(); // Initial broadcast
    }

    async startLocalServer() {
        const app = express();
        app.use(cors());
        app.use(express.json());
        app.use(express.static(path.join(__dirname, '../admin-ui')));

        // API endpoints
        app.get('/api/status', (req, res) => {
            res.json({
                running: true,
                roomId: this.roomId,
                publicKey: this.getPublicKeyString(),
                boxPublicKey: this.getBoxPublicKeyString(),
                trustedCount: this.trustedKeys.size,
                entriesCount: this.entries.length,
                connections: Array.from(this.connections.entries()).map(([id, conn]) => ({
                    id: id.substring(0, 8),
                    state: conn.state,
                    name: conn.name
                }))
            });
        });

        app.get('/api/entries', (req, res) => {
            // TODO: Add authentication
            res.json(this.entries);
        });

        app.post('/api/entries', async (req, res) => {
            // TODO: Add authentication
            const entry = {
                id: this.entries.length + 1,
                content: req.body.content,
                timestamp: Date.now(),
                author: "Admin"
            };

            this.entries.push(entry);
            await this.saveEntries();

            // Broadcast to connected peers
            this.broadcastEntry(entry);

            res.json(entry);
        });

        app.get('/api/trusted', (req, res) => {
            const trusted = Array.from(this.trustedKeys.entries()).map(([key, info]) => ({
                publicKey: key,
                ...info
            }));
            res.json(trusted);
        });

        app.post('/api/trusted', async (req, res) => {
            const { publicKey, boxPublicKey, name, permissions } = req.body;

            this.trustedKeys.set(publicKey, {
                boxPublicKey,
                name: name || 'Unknown',
                permissions: permissions || ['read'],
                trustedAt: Date.now()
            });

            await this.saveTrustedKeys();

            res.json({ success: true });
        });

        app.delete('/api/trusted/:key', async (req, res) => {
            this.trustedKeys.delete(req.params.key);
            await this.saveTrustedKeys();
            res.json({ success: true });
        });

        this.server = createServer(app);
        this.wss = new WebSocketServer({ server: this.server });

        this.wss.on('connection', (ws) => {
            console.log('🔌 Admin WebSocket connected');

            ws.on('message', async (message) => {
                try {
                    const data = JSON.parse(message);
                    await this.handleAdminMessage(ws, data);
                } catch (err) {
                    console.error('WebSocket error:', err);
                }
            });
        });

        await new Promise((resolve) => {
            this.server.listen(this.config.port, resolve);
        });
    }

    async handleAdminMessage(ws, data) {
        // Handle admin commands via WebSocket
        switch (data.type) {
            case 'subscribe':
                // Send updates to admin UI
                this.on('entry', (entry) => {
                    ws.send(JSON.stringify({ type: 'entry', data: entry }));
                });
                break;

            case 'add_entry':
                const entry = {
                    id: this.entries.length + 1,
                    content: data.content,
                    timestamp: Date.now(),
                    author: "Admin"
                };

                this.entries.push(entry);
                await this.saveEntries();
                this.broadcastEntry(entry);
                this.emit('entry', entry);
                break;
        }
    }

    broadcastEntry(entry) {
        // Broadcast to all authenticated P2P connections
        this.connections.forEach((conn, peerId) => {
            if (conn.state === 'authenticated') {
                const trustedInfo = this.trustedKeys.get(conn.publicKey);
                if (trustedInfo) {
                    const encrypted = this.encryptForPeer(entry, trustedInfo.boxPublicKey);
                    this.p2pActions.sendEntry(encrypted);
                }
            }
        });
    }

    async shutdown() {
        console.log('🛑 Shutting down service...');

        if (this.room) {
            this.room.leave();
        }

        if (this.wss) {
            this.wss.close();
        }

        if (this.server) {
            this.server.close();
        }

        console.log('👋 Service stopped');
    }
}

// Start the service
const service = new TrustDiaryService({
    port: process.env.PORT || 3333,
    dataDir: process.env.DATA_DIR || './diary-data',
    roomSalt: process.env.ROOM_SALT || 'trust-diary-v1'
});

service.initialize().catch(console.error);

// Graceful shutdown
process.on('SIGINT', async () => {
    await service.shutdown();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    await service.shutdown();
    process.exit(0);
});

export default TrustDiaryService;