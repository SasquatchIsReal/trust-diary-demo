package main

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip19"
	"github.com/pion/webrtc/v3"
	"golang.org/x/crypto/nacl/sign"
)

const (
	// Custom Nostr event kinds for WebRTC signaling
	KindWebRTCOffer  = 21000
	KindWebRTCAnswer = 21001
)

type TrustDiaryService struct {
	// Identity (Ed25519 only for signing)
	signPublicKey  []byte
	signPrivateKey []byte

	// Nostr keys (derived from Ed25519)
	nostrPrivKey string
	nostrPubKey  string

	// WebRTC
	peerConnection *webrtc.PeerConnection
	dataChannel    *webrtc.DataChannel
	currentOffer   string
	offerID        string

	// Nostr relays
	relays []string
	pool   *nostr.SimplePool

	// Trusted readers (Nostr pubkeys)
	trustedReaders map[string]string // pubkey -> name

	// Diary entries
	entries []DiaryEntry
}

type DiaryEntry struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	Mood      string `json:"mood,omitempty"`
	Timestamp int64  `json:"timestamp"`
	Signature string `json:"signature"`
}

type WebRTCOffer struct {
	OfferID   string `json:"offer_id"`
	SDP       string `json:"sdp"`
	Timestamp int64  `json:"timestamp"`
}

func main() {
	service := &TrustDiaryService{
		relays: []string{
			"wss://relay.damus.io",
			"wss://relay.nostr.band",
			"wss://nos.lol",
			"wss://relay.primal.net",
		},
		trustedReaders: make(map[string]string),
	}

	log.Println("🚀 Starting Trust Diary Service (Simplified Nostr + WebRTC)")

	// Initialize identity
	if err := service.loadOrCreateIdentity(); err != nil {
		log.Fatal("Failed to initialize identity:", err)
	}

	// Load some test entries
	service.loadTestEntries()

	// Add trusted readers (for demo)
	service.addTrustedReaders()

	// Connect to Nostr relays
	if err := service.connectToNostr(); err != nil {
		log.Fatal("Failed to connect to Nostr:", err)
	}

	// Start main service loop
	service.run()
}

func (s *TrustDiaryService) loadOrCreateIdentity() error {
	identityFile := "./diary-data/identity.json"

	if data, err := os.ReadFile(identityFile); err == nil {
		// Load existing identity
		var identity struct {
			SignPublicKey  string `json:"sign_public_key"`
			SignPrivateKey string `json:"sign_private_key"`
		}

		if err := json.Unmarshal(data, &identity); err != nil {
			return err
		}

		s.signPublicKey, _ = base64.StdEncoding.DecodeString(identity.SignPublicKey)
		s.signPrivateKey, _ = base64.StdEncoding.DecodeString(identity.SignPrivateKey)

		log.Println("📂 Loaded existing identity")
	} else {
		// Generate new identity (Ed25519 only)
		signPub, signPriv, _ := sign.GenerateKey(rand.Reader)

		s.signPublicKey = signPub[:]
		s.signPrivateKey = signPriv[:]

		// Save identity
		identity := map[string]string{
			"sign_public_key":  base64.StdEncoding.EncodeToString(s.signPublicKey),
			"sign_private_key": base64.StdEncoding.EncodeToString(s.signPrivateKey),
		}

		data, _ := json.MarshalIndent(identity, "", "  ")
		os.MkdirAll("./diary-data", 0755)
		os.WriteFile(identityFile, data, 0600)

		log.Println("🔑 Generated new identity")
	}

	// Generate Nostr keys from Ed25519
	if len(s.signPrivateKey) >= 32 {
		s.nostrPrivKey = fmt.Sprintf("%x", s.signPrivateKey[:32])
	} else {
		// Fallback to a deterministic key
		s.nostrPrivKey = "57cafe5a87555d0271c2fb995f58e05ba80896ea81b5ca0b6e602bbcdb2cc0da"
	}
	if len(s.signPublicKey) >= 32 {
		s.nostrPubKey = fmt.Sprintf("%x", s.signPublicKey[:32])
	} else {
		// Use known public key
		s.nostrPubKey = "57cafe5a87555d0271c2fb995f58e05ba80896ea81b5ca0b6e602bbcdb2cc0da"
	}

	npub, _ := nip19.EncodePublicKey(s.nostrPubKey)
	log.Printf("📍 Service Nostr pubkey: %s", s.nostrPubKey)
	log.Printf("📍 Service npub: %s", npub)

	return nil
}

func (s *TrustDiaryService) connectToNostr() error {
	s.pool = nostr.NewSimplePool(context.Background())

	// Subscribe to WebRTC answers directed at us
	filters := []nostr.Filter{
		{
			Kinds: []int{KindWebRTCAnswer},
			Tags: nostr.TagMap{
				"p": []string{s.nostrPubKey}, // Messages for us
			},
			Since: func() *nostr.Timestamp {
				t := nostr.Now()
				t = nostr.Timestamp(t.Time().Add(-1 * time.Hour).Unix())
				return &t
			}(),
		},
	}

	sub := s.pool.SubMany(context.Background(), s.relays, filters)

	go func() {
		for ev := range sub {
			s.handleNostrEvent(ev.Event)
		}
	}()

	log.Printf("✅ Connected to %d Nostr relays", len(s.relays))
	return nil
}

func (s *TrustDiaryService) handleNostrEvent(event *nostr.Event) {
	switch event.Kind {
	case KindWebRTCAnswer:
		s.handleWebRTCAnswer(event)
	}
}

func (s *TrustDiaryService) handleWebRTCAnswer(event *nostr.Event) {
	log.Printf("📥 Received WebRTC answer from %s", event.PubKey[:8])

	// Check if this is from a trusted reader
	name, trusted := s.trustedReaders[event.PubKey]
	if !trusted {
		log.Printf("⚠️ Answer from untrusted reader: %s", event.PubKey[:8])
		return
	}

	// Parse the answer
	var answer WebRTCOffer
	if err := json.Unmarshal([]byte(event.Content), &answer); err != nil {
		log.Printf("Failed to parse answer: %v", err)
		return
	}

	// Verify this is for our current offer
	if answer.OfferID != s.offerID {
		log.Printf("Answer for wrong offer ID: %s != %s", answer.OfferID, s.offerID)
		return
	}

	// Set remote description
	if err := s.peerConnection.SetRemoteDescription(webrtc.SessionDescription{
		Type: webrtc.SDPTypeAnswer,
		SDP:  answer.SDP,
	}); err != nil {
		log.Printf("Failed to set remote description: %v", err)
		return
	}

	log.Printf("✅ Established P2P connection with %s", name)
}

func (s *TrustDiaryService) run() {
	for {
		// Create new WebRTC offer every 30 seconds
		if err := s.createAndPublishOffer(); err != nil {
			log.Printf("Error creating offer: %v", err)
		}

		time.Sleep(30 * time.Second)
	}
}

func (s *TrustDiaryService) createAndPublishOffer() error {
	// Create peer connection
	config := webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{URLs: []string{"stun:stun.l.google.com:19302"}},
		},
	}

	pc, err := webrtc.NewPeerConnection(config)
	if err != nil {
		return err
	}

	s.peerConnection = pc

	// Create data channel
	dataChannel, err := pc.CreateDataChannel("diary", nil)
	if err != nil {
		return err
	}

	s.dataChannel = dataChannel

	dataChannel.OnOpen(func() {
		log.Println("✅ Data channel opened")
		s.sendEntries()
	})

	dataChannel.OnMessage(func(msg webrtc.DataChannelMessage) {
		s.handleDataChannelMessage(msg.Data)
	})

	// Create offer
	offer, err := pc.CreateOffer(nil)
	if err != nil {
		return err
	}

	if err := pc.SetLocalDescription(offer); err != nil {
		return err
	}

	// Wait for ICE gathering
	<-webrtc.GatheringCompletePromise(pc)

	s.currentOffer = pc.LocalDescription().SDP
	s.offerID = fmt.Sprintf("%x", time.Now().Unix())

	// Publish offer to Nostr (plain, not encrypted)
	s.publishOffer()

	return nil
}

func (s *TrustDiaryService) publishOffer() {
	offer := WebRTCOffer{
		OfferID:   s.offerID,
		SDP:       s.currentOffer,
		Timestamp: time.Now().Unix(),
	}

	content, _ := json.Marshal(offer)

	// Create Nostr event
	ev := &nostr.Event{
		PubKey:    s.nostrPubKey,
		CreatedAt: nostr.Timestamp(time.Now().Unix()),
		Kind:      KindWebRTCOffer,
		Tags:      nostr.Tags{}, // No specific tags - anyone can see the offer
		Content:   string(content),
	}

	// Sign event
	ev.Sign(s.nostrPrivKey)

	// Publish to relays
	successCount := 0
	for _, relay := range s.relays {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		relayConn, err := nostr.RelayConnect(ctx, relay)
		if err != nil {
			log.Printf("Failed to connect to %s: %v", relay, err)
			continue
		}

		if _, err := relayConn.Publish(ctx, *ev); err == nil {
			successCount++
			log.Printf("📤 Published offer to %s", relay)
		}
		relayConn.Close()
	}

	log.Printf("📡 Published offer to %d/%d relays (ID: %s)", successCount, len(s.relays), s.offerID)
}

func (s *TrustDiaryService) sendEntries() {
	// Send all diary entries through data channel
	for _, entry := range s.entries {
		msg := map[string]interface{}{
			"type":  "entry",
			"entry": entry,
		}
		data, _ := json.Marshal(msg)
		s.dataChannel.SendText(string(data))
	}

	log.Printf("📚 Sent %d diary entries", len(s.entries))
}

func (s *TrustDiaryService) handleDataChannelMessage(data []byte) {
	var msg map[string]interface{}
	if err := json.Unmarshal(data, &msg); err != nil {
		return
	}

	msgType, _ := msg["type"].(string)

	switch msgType {
	case "request-entries":
		s.sendEntries()
	case "hello":
		log.Println("👋 Received hello from peer")
		// Send welcome message
		welcome := map[string]string{
			"type":    "welcome",
			"message": "Connected to Trust Diary service",
		}
		data, _ := json.Marshal(welcome)
		s.dataChannel.SendText(string(data))
	}
}

func (s *TrustDiaryService) loadTestEntries() {
	s.entries = []DiaryEntry{
		{
			ID:        "1",
			Title:     "First Entry",
			Content:   "This is my first diary entry in the P2P system.",
			Mood:      "excited",
			Timestamp: time.Now().Add(-24 * time.Hour).Unix(),
		},
		{
			ID:        "2",
			Title:     "WebRTC Success",
			Content:   "Successfully established P2P connection via Nostr discovery!",
			Mood:      "happy",
			Timestamp: time.Now().Add(-1 * time.Hour).Unix(),
		},
		{
			ID:        "3",
			Title:     "No HTTP Needed",
			Content:   "The system works without any HTTP endpoints, pure Nostr + WebRTC.",
			Mood:      "proud",
			Timestamp: time.Now().Unix(),
		},
	}

	// Sign entries
	for i := range s.entries {
		message := fmt.Sprintf("%s|%s|%d", s.entries[i].Title, s.entries[i].Content, s.entries[i].Timestamp)
		var privKey [64]byte
		copy(privKey[:], s.signPrivateKey)
		sig := sign.Sign(nil, []byte(message), &privKey)
		s.entries[i].Signature = base64.StdEncoding.EncodeToString(sig[:64])
	}

	log.Printf("📚 Loaded %d test entries", len(s.entries))
}

func (s *TrustDiaryService) addTrustedReaders() {
	// For demo, trust any reader who connects
	// In production, maintain a proper list
	s.trustedReaders["*"] = "Any Reader" // Wildcard for demo

	// You can add specific trusted Nostr pubkeys here:
	// s.trustedReaders["pubkey_here"] = "Reader Name"

	log.Printf("👥 Configured %d trusted readers", len(s.trustedReaders))
}