# Trust Diary Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         YOUR LOCAL MACHINE                              │
│                                                                         │
│  ┌──────────────────────────────────────────────────────┐             │
│  │         GO SERVICE (localhost:3334)                  │             │
│  │                                                      │             │
│  │  • WebRTC DataChannel Server                        │             │
│  │  • NO WebSockets                                    │             │
│  │  • Certificate-based authentication                 │             │
│  │  • Stores diary entries                            │             │
│  │  • Manages trusted reader certificates             │             │
│  │                                                    │             │
│  │  HTTP Endpoints:                                  │             │
│  │   GET  /api/offer  → WebRTC SDP                  │             │
│  │   POST /api/answer → Accept answer               │             │
│  │   GET  /api/admin  → Admin status               │             │
│  │                                                 │             │
│  └────────────────┬─────────────────────┬─────────┘             │
│                   │                     │                        │
│          WebRTC P2P│            WebRTC P2P│                     │
│                   │                     │                        │
└───────────────────┼─────────────────────┼──────────────────────┘
                    │                     │
                    │                     │
    ┌───────────────▼──────────┐   ┌─────▼──────────────────┐
    │   TOM'S ADMIN UI         │   │   BOB'S READER CLIENT  │
    │   (GitHub Pages)         │   │   (GitHub Pages)       │
    │                          │   │                        │
    │  • Full diary access     │   │  • Read-only access    │
    │  • Add/edit entries      │   │  • Must have approved  │
    │  • Manage readers        │   │    certificate         │
    │  • Server control        │   │  • WebRTC P2P to       │
    │  • View connections      │   │    server              │
    │                          │   │                        │
    └──────────────────────────┘   └────────────────────────┘
```

## Authentication Flow

```
1. Initial Setup (One-time)
   ┌──────────────┐
   │ Go Service   │ Generates root Ed25519 keypair
   │              │ This is the server's identity
   └──────────────┘

2. Admin (Tom) Connection
   ┌──────────────┐      ┌──────────────┐
   │ Tom's Browser│      │ Go Service   │
   │              │─────>│              │
   │  Connects    │      │ Verifies Tom │
   │  with root   │<─────│ (has root    │
   │  private key │      │  public key) │
   └──────────────┘      └──────────────┘

3. Reader Authorization
   ┌──────────────┐      ┌──────────────┐
   │ Tom's Admin  │      │ Go Service   │
   │              │─────>│              │
   │ Adds Bob's   │      │ Stores Bob's │
   │ public key   │      │ certificate  │
   │ to trusted   │      │ in approved  │
   │ list         │      │ list         │
   └──────────────┘      └──────────────┘

4. Reader (Bob) Connection
   ┌──────────────┐      ┌──────────────┐
   │ Bob's Browser│      │ Go Service   │
   │              │─────>│              │
   │ Signs auth   │      │ Verifies sig │
   │ challenge    │<─────│ against      │
   │ with private │      │ approved     │
   │ key          │      │ certificates │
   └──────────────┘      └──────────────┘
```

## Data Flow

```
┌─────────────────────────────────────────────────────────┐
│                    GO SERVICE                           │
│                                                         │
│  ┌─────────────┐     ┌──────────────┐                 │
│  │   Diary     │     │  Trusted     │                 │
│  │   Entries   │     │  Readers     │                 │
│  │  (JSON DB)  │     │ (Cert Store) │                 │
│  └──────┬──────┘     └──────┬───────┘                 │
│         │                   │                          │
│         ▼                   ▼                          │
│  ┌──────────────────────────────────┐                 │
│  │     WebRTC DataChannel Handler   │                 │
│  │                                   │                 │
│  │  • Authenticated channels only    │                 │
│  │  • Encrypted P2P communication    │                 │
│  │  • No WebSocket signaling         │                 │
│  └───────────┬──────────────────────┘                 │
│              │                                         │
└──────────────┼─────────────────────────────────────────┘
               │
       DataChannel P2P
               │
    ┌──────────┴──────────┐
    │                     │
    ▼                     ▼
┌─────────┐         ┌──────────┐
│  Admin  │         │  Reader  │
│   UI    │         │  Client  │
└─────────┘         └──────────┘
```

## Key Features

1. **No WebSocket Signaling**
   - Uses HTTP endpoints for WebRTC offer/answer exchange
   - After handshake, pure P2P DataChannel

2. **Certificate-Based Auth**
   - Each user has Ed25519 keypair
   - Server maintains approved certificate list
   - Readers must be explicitly authorized by admin

3. **Admin vs Reader Separation**
   - Admin UI: Full control (Tom's interface)
   - Reader Client: Read-only access (Bob's interface)

4. **True P2P After Handshake**
   - Initial connection via HTTP (for SDP exchange)
   - Then direct WebRTC DataChannel
   - No ongoing HTTP/WebSocket needed

## Security Model

```
Server Root Key (Ed25519)
    │
    ├── Signs admin operations
    │
    └── Maintains trusted reader list
            │
            ├── Bob's Public Key (approved)
            ├── Alice's Public Key (approved)
            └── Charlie's Public Key (pending)
```

## Implementation Status

- ✅ Go service with WebRTC (go-nostr-service/)
- ✅ HTTP endpoints for offer/answer
- ✅ CORS enabled for GitHub Pages access
- ⚠️ Certificate verification (needs implementation)
- ⚠️ Admin UI (needs separate page)
- ⚠️ Reader authorization management