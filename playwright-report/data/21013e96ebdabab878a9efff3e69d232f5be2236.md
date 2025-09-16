# Page snapshot

```yaml
- generic [ref=e2]:
  - heading "🔐 Trust Diary - Simple Nostr P2P" [level=1] [ref=e3]
  - paragraph [ref=e4]: Direct P2P connection via Nostr discovery (WebRTC handles encryption)
  - generic [ref=e5]: Connection Error
  - generic [ref=e6]:
    - heading "🔍 Connect to Service" [level=2] [ref=e7]
    - generic [ref=e8]: Service Nostr Public Key
    - textbox "Enter the service's Nostr public key..." [ref=e9]: 57cafe5a87555d0271c2fb995f58e05ba80896ea81b5ca0b6e602bbcdb2cc0da
    - paragraph [ref=e10]: WebRTC handles all encryption automatically with DTLS-SRTP
    - button "🔍 Find Service Offers" [active] [ref=e11] [cursor=pointer]
    - button "🔌 Disconnect" [disabled] [ref=e12]
  - generic [ref=e13]:
    - heading "📚 Diary Entries" [level=2] [ref=e14]
    - paragraph [ref=e16]: No entries yet. Connect to service to receive entries.
  - generic [ref=e17]:
    - heading "📡 Connection Log" [level=3] [ref=e18]
    - generic [ref=e19]:
      - generic [ref=e20]: System ready. WebRTC encrypts all communications with DTLS-SRTP.
      - generic [ref=e21]: "[4:11:18 PM] 📍 Your Nostr pubkey: f7bd761643d12dbc..."
      - generic [ref=e22]: "[4:11:19 PM] 🔍 Searching for offers from 57cafe5a87555d02..."
      - generic [ref=e23]: "[4:11:19 PM] Querying 4 relays..."
      - generic [ref=e24]: "[4:11:19 PM] Looking for offers from author: 57cafe5a87555d0271c2fb995f58e05ba80896ea81b5ca0b6e602bbcdb2cc0da"
      - generic [ref=e25]: "[4:11:19 PM] Event kind: 21000"
      - generic [ref=e26]: "[4:11:54 PM] ⏱️ Timeout - no offers found"
      - generic [ref=e27]: "[4:11:54 PM] Service may be offline or not publishing"
```