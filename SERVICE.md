# Trust Diary Service - Persistent P2P Model

## Overview

This is a **persistent service model** for the Trust Diary that runs as an always-on Node.js service maintaining a continuous WebRTC presence on the P2P network.

## Key Differences from Browser Model

### Browser Model (Original)
- Ephemeral P2P connections
- Room ID based on both Tom and Bob's keys
- Both parties must be online simultaneously
- No persistent presence

### Service Model (New)
- **Always-on service** maintaining persistent P2P presence
- **Room ID based only on service's public key** + salt
- **Authentication-based access** with cryptographic signatures
- **Asynchronous communication** - readers can connect anytime
- **Admin UI** for service management

## Architecture

```
┌─────────────────────┐
│   Admin Browser     │
│  (localhost:3333)   │
└──────────┬──────────┘
           │ HTTP/WS
┌──────────▼──────────┐       WebTorrent Trackers
│  Trust Diary Service├──────────────►┌──────────┐
│   (Node.js Process) │               │ Tracker  │
│                     │◄──────────────┤ Network  │
│  - Identity Keys    │   Room ID     └──────────┘
│  - Trusted Users    │      ▲
│  - Diary Entries    │      │
└─────────────────────┘      │
                             │
                    ┌────────▼────────┐
                    │  Reader Browser  │
                    │ (Trusted User)   │
                    └──────────────────┘
```

## How It Works

### 1. Service Initialization
```javascript
// Service generates persistent identity
const identity = {
    keyPair: nacl.sign.keyPair(),      // Ed25519 for signatures
    boxKeyPair: nacl.box.keyPair()     // X25519 for encryption
}

// Room ID = Hash(salt + servicePublicKey)
// Anyone knowing the service's public key can calculate the room
const roomId = generateRoomId(servicePublicKey, 'trust-diary-v1')
```

### 2. Discovery Protection
The room ID is derived from:
- **Service's public key** (must be known to find the room)
- **Salt** (additional obscurity, default: 'trust-diary-v1')

This means:
- ✅ You can discover the room if you know the service's public key
- ❌ Random scanners can't find it without the public key
- ✅ The room is always at the same "address" for trusted users

### 3. Authentication Flow

```
Reader → Service: Join P2P room
Service → Reader: Authentication challenge (32 random bytes)
Reader → Service: Signed challenge + public keys
Service: Verify signature & check trusted list
Service → Reader: Encrypted entries (if authenticated)
```

### 4. Encryption Model

Each message is encrypted specifically for the recipient:
```javascript
// Service encrypts for specific reader
const encrypted = nacl.box(
    message,
    nonce,
    readerBoxPublicKey,  // Reader's encryption key
    serviceBoxSecretKey   // Service's secret key
)
```

Only the intended reader can decrypt, even if others are in the room.

## Usage

### Starting the Service

```bash
# Install dependencies
npm install

# Start the service
npm run service

# Or with auto-reload for development
npm run service:dev
```

### Admin Interface

```bash
# Open admin UI (http://localhost:3333)
npm run admin
```

Admin features:
- View service identity keys
- Add/remove trusted users
- Write diary entries
- Monitor active connections
- See authentication status

### Reader Connection

1. **Reader generates identity** (automatic on page load)
2. **Reader shares keys with admin** (copy button provided)
3. **Admin adds reader as trusted** (via admin UI)
4. **Reader enters service keys** and connects
5. **Automatic authentication** via cryptographic signature
6. **Encrypted entries sync** to reader

### Configuration

Environment variables:
```bash
PORT=3333                    # Admin UI port
DATA_DIR=./diary-data        # Persistent storage
ROOM_SALT=trust-diary-v1     # Room ID salt
```

## Security Features

### Protected Discovery
- Room ID requires knowing service's public key
- Salt adds additional obscurity layer
- No directory listing of active rooms

### Cryptographic Authentication
- Challenge-response with Ed25519 signatures
- Proves possession of private key
- No passwords or tokens needed

### End-to-End Encryption
- Each message encrypted for specific recipient
- Uses NaCl box (X25519-XSalsa20-Poly1305)
- Even if room is discovered, content is protected

### Trust Management
- Explicit trust list maintained by service
- Permissions system (read, write, admin)
- Easy revocation via admin UI

## Data Persistence

The service stores:
```
diary-data/
├── identity.json    # Service keypairs
├── trusted.json     # Trusted users list
└── entries.json     # Diary entries
```

## Advantages of This Model

1. **Always Available** - Service runs 24/7, readers connect anytime
2. **Centralized Trust** - Service owner controls access
3. **Audit Trail** - Service logs all connections and auth attempts
4. **Scalable** - Can handle multiple simultaneous readers
5. **Admin Control** - Web UI for management without editing files

## Comparison to Original Model

| Feature | Browser P2P | Service Model |
|---------|------------|---------------|
| Persistence | Ephemeral | Always-on |
| Discovery | Both keys needed | Service key only |
| Authentication | Implicit (know keys) | Explicit (cryptographic) |
| Availability | Both online | Service always online |
| Management | Manual | Admin UI |
| Audit | None | Full logging |

## Running Multiple Services

You can run multiple diary services on different ports:

```bash
# Personal diary
PORT=3333 DATA_DIR=./personal-diary npm run service

# Work diary
PORT=3334 DATA_DIR=./work-diary npm run service

# Project diary
PORT=3335 DATA_DIR=./project-diary npm run service
```

Each maintains its own identity, trusted users, and P2P presence.

## Future Enhancements

- [ ] Multi-writer support (trusted users can add entries)
- [ ] Entry encryption at rest
- [ ] Backup/restore functionality
- [ ] Federation between services
- [ ] Mobile reader app
- [ ] Entry categories/tags
- [ ] Search functionality
- [ ] Media attachments