# Trust Diary - P2P Browser Demo

A pure browser-based P2P trust diary demonstrating cryptographic trust relationships and WebRTC connectivity via WebTorrent trackers.

## What This Is

This is a minimal implementation of a trust-gated P2P communication system that runs entirely in the browser. Two users (Tom and Bob) can establish a secure, private communication channel using only cryptographic keys and WebTorrent's tracker network for discovery.

## Core Concepts

### Trust Model
- **No passwords** - Authentication via Ed25519 keypairs
- **Explicit trust** - Tom must explicitly trust Bob's public key
- **Deterministic rooms** - Room ID derived from both parties' keys
- **Encrypted announcements** - Only trusted parties can decrypt

### Technical Architecture
- **Crypto**: NaCl (TweetNaCl) for Ed25519 signatures and X25519 encryption
- **P2P**: Trystero library for WebRTC via WebTorrent trackers
- **Storage**: LocalStorage for persistent identity and entries
- **Discovery**: WebTorrent tracker network (not BitTorrent DHT)

## How It Works

1. **Identity Generation**: Both parties generate Ed25519 signing keys and X25519 encryption keys
2. **Trust Establishment**: Bob shares his public keys with Tom, who adds them to trusted list
3. **Room Creation**: Deterministic room ID created from hash of both public keys
4. **P2P Connection**: Both join same Trystero room via WebTorrent trackers
5. **Data Sync**: Entries automatically sync between connected peers

## Files

```
client/
├── tom-jsbin.html   # Tom's diary interface (owner)
└── bob-jsbin.html   # Bob's reader interface
```

## Usage

### Option 1: JSBin (Recommended)
1. Open [JSBin](https://jsbin.com)
2. Paste `tom-jsbin.html` in one tab
3. Paste `bob-jsbin.html` in another tab
4. Follow connection steps below

### Option 2: Local Files
1. Open `tom-jsbin.html` in one browser tab
2. Open `bob-jsbin.html` in another tab
3. Follow connection steps below

### Connection Steps
1. **Bob**: Copy identity (public + encryption keys)
2. **Tom**: Paste Bob's keys and click "Trust Bob"
3. **Tom**: Click "Start P2P"
4. **Tom**: Copy identity keys
5. **Bob**: Paste Tom's keys and click "Connect"
6. **Success**: Both show "Peers: 1" and entries sync

## Specifications

### Cryptography
- **Signing**: Ed25519 (32-byte public keys)
- **Encryption**: X25519-XSalsa20-Poly1305 (NaCl box)
- **Encoding**: Base64 for key transmission
- **Nonce**: Random 24-byte per message

### P2P Protocol
- **Library**: Trystero (WebRTC abstraction)
- **Signaling**: WebTorrent trackers (WebSocket)
- **Transport**: WebRTC DataChannel
- **Room ID**: SHA-256 hash of combined public keys, truncated to 16 chars

### Message Types
- `entry`: Diary entry synchronization
- `announcement`: Encrypted service announcements
- `request`: Request for entries (on connection)

### Security Properties
- **Authentication**: Cryptographic signatures prevent impersonation
- **Confidentiality**: All data encrypted with recipient's public key
- **Integrity**: Poly1305 MAC ensures message integrity
- **Forward Secrecy**: Not implemented (would require ephemeral keys)

## Limitations

- **Browser Only**: No server component, runs entirely in browser
- **WebTorrent Trackers**: Relies on public tracker infrastructure
- **No DHT**: Uses tracker-based discovery, not true DHT
- **No Persistence**: Entries stored in LocalStorage only
- **Single Room**: Each trust relationship creates one room

## What Makes This Special

1. **Zero Infrastructure**: No servers, databases, or hosting required
2. **True P2P**: Direct browser-to-browser communication
3. **Cryptographic Trust**: Not username/password but actual crypto
4. **JSBin Compatible**: Can run from online code editors
5. **Educational**: Clean implementation of trust and P2P concepts

## Future Improvements

- [ ] Multiple trusted users in same room
- [ ] Persistent entry storage (IndexedDB)
- [ ] File/image sharing
- [ ] Group encryption for multiple readers
- [ ] Revocation mechanism
- [ ] Ephemeral keys for forward secrecy
- [ ] Offline message queue

## Technical Notes

### Why WebTorrent, not BitTorrent DHT?
- Browsers cannot make UDP connections (required for DHT)
- WebTorrent uses WebSocket trackers browsers can connect to
- Trackers facilitate WebRTC signaling between peers

### Why Trystero?
- Abstracts WebRTC complexity
- Multiple signaling strategies (torrent, IPFS, Nostr)
- Simple room-based API
- Handles peer discovery and connection

### Why NaCl?
- Battle-tested cryptography
- Small library size (TweetNaCl)
- Combines signing and encryption
- Safe defaults, hard to misuse

## License

MIT - Educational demonstration of P2P trust concepts