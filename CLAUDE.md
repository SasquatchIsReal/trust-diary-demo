# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Trust Diary P2P Demo** - A pure browser-based P2P trust diary demonstrating cryptographic trust relationships and WebRTC connectivity via WebTorrent trackers. Two users (Tom and Bob) can establish secure, private communication channels using only cryptographic keys and WebTorrent's tracker network for discovery, with zero infrastructure requirements.

## Core Architecture

### Technical Stack
- **Cryptography**: TweetNaCl for Ed25519 signatures and X25519 encryption
- **P2P Library**: Trystero for WebRTC abstraction via WebTorrent trackers
- **Transport**: WebRTC DataChannel (no servers, pure browser-to-browser)
- **Discovery**: WebTorrent tracker network (WebSocket-based, not DHT)
- **Storage**: LocalStorage for persistent identity and entries

### Trust Model
- Authentication via Ed25519 keypairs (no passwords)
- Explicit trust establishment (Tom must trust Bob's public key)
- Deterministic room IDs derived from both parties' keys
- All messages encrypted with recipient's public key

### Key Files
```
client/
├── tom-jsbin.html   # Tom's diary owner interface (standalone HTML)
└── bob-jsbin.html   # Bob's reader interface (standalone HTML)
```

Both HTML files are self-contained with inline JavaScript and can run directly in JSBin or as local files.

## Development Commands

```bash
# Install dependencies
npm install

# Development server (serves both HTML files)
npm run dev         # Starts server on port 3000 and opens both pages

# Individual commands
npm run serve       # Just start the server
npm run open        # Open both HTML files in browser

# Testing
npm run test        # Run P2P browser tests (main test suite)
npm run test:all    # Run all test suites
npm run test:docker # Run tests in Docker container

# Run specific test file
npx playwright test tests/pure-p2p.spec.ts

# With UI mode for debugging
npx playwright test --ui
```

## Testing Infrastructure

The project uses Playwright for comprehensive P2P testing:
- **Pure P2P Tests** (`tests/pure-p2p.spec.ts`): Main test suite verifying browser-to-browser connectivity
- **Network Tests** (`tests/network-latency.spec.ts`): Latency and network condition testing
- **Connectivity Tests** (`tests/p2p-connectivity.spec.ts`): Connection establishment verification

Tests simulate complete isolation between browser instances with different geolocations and locales to ensure true P2P behavior.

## P2P Connection Flow

1. **Identity Generation**: Both parties generate Ed25519 signing keys and X25519 encryption keys
2. **Trust Establishment**: Bob shares public keys → Tom adds to trusted list
3. **Room Creation**: Deterministic room ID from SHA-256 hash of combined public keys
4. **P2P Connection**: Both join same Trystero room via WebTorrent trackers
5. **Data Sync**: Entries automatically sync between connected peers

## Message Protocol

Three message types are exchanged via Trystero:
- `entry`: Diary entry synchronization
- `announcement`: Encrypted service announcements (only trusted parties can decrypt)
- `request`: Request for entries on initial connection

All messages are signed with Ed25519 and encrypted with X25519-XSalsa20-Poly1305.

## CI/CD Pipeline

GitHub Actions workflow (`pure-p2p-test.yml`) runs:
1. Pure P2P browser tests across Chromium and Firefox
2. Docker-isolated testing environment
3. Verification that no server dependencies exist in tests
4. Artifact uploads for test results and failure videos

## Important Implementation Details

- **No Server Component**: Runs entirely in browser, uses `file://` URLs in tests
- **WebTorrent Trackers**: Cannot use BitTorrent DHT (browsers can't make UDP connections)
- **Room IDs**: Truncated to 16 characters for tracker compatibility
- **LocalStorage Keys**: `privateKey`, `publicKey`, `boxKeys`, `trustedKeys`, `entries`
- **Key Encoding**: Base64 for all key transmission
- **Nonce Generation**: Random 24-byte per message for encryption