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
	"golang.org/x/crypto/nacl/box"
	"golang.org/x/crypto/nacl/sign"
)

const (
	// Custom Nostr event kinds for WebRTC signaling
	KindWebRTCOffer  = 21000
	KindWebRTCAnswer = 21001
	KindTrustedReader = 21002 // Published list of trusted readers
)

type TrustDiaryService struct {
	// Identity keys
	signPublicKey  []byte
	signPrivateKey []byte
	boxPublicKey   []byte
	boxPrivateKey  []byte

	// Nostr keys (converted from Ed25519)
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

	// Trusted readers (public keys)
	trustedReaders map[string]TrustedReader

	// Diary entries
	entries []DiaryEntry
}

type TrustedReader struct {
	Name         string `json:"name"`
	SignPublicKey string `json:"sign_public_key"`
	BoxPublicKey  string `json:"box_public_key"`
	NostrPubKey   string `json:"nostr_pubkey"`
	AddedAt      int64  `json:"added_at"`
	Permissions  string `json:"permissions"` // "read" or "admin"
}

type DiaryEntry struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	Content   string `json:"content"`
	Mood      string `json:"mood,omitempty"`
	Timestamp int64  `json:"timestamp"`
	Signature string `json:"signature"`
}

type EncryptedOffer struct {
	OfferID   string `json:"offer_id"`
	SDP       string `json:"sdp"`
	ServiceBox string `json:"service_box_key"` // Service's ephemeral box public key
	Timestamp int64  `json:"timestamp"`
	Nonce     string `json:"nonce"`
}

func main() {
	service := &TrustDiaryService{
		relays: []string{
			"wss://relay.damus.io",
			"wss://relay.nostr.band",
			"wss://nos.lol",
			"wss://relay.primal.net",
		},
		trustedReaders: make(map[string]TrustedReader),
	}

	log.Println("🚀 Starting Trust Diary Service (Pure Nostr + WebRTC)")

	// Initialize identity
	if err := service.loadOrCreateIdentity(); err != nil {
		log.Fatal("Failed to initialize identity:", err)
	}

	// Load trusted readers
	service.loadTrustedReaders()

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
			BoxPublicKey   string `json:"box_public_key"`
			BoxPrivateKey  string `json:"box_private_key"`
		}

		if err := json.Unmarshal(data, &identity); err != nil {
			return err
		}

		s.signPublicKey, _ = base64.StdEncoding.DecodeString(identity.SignPublicKey)
		s.signPrivateKey, _ = base64.StdEncoding.DecodeString(identity.SignPrivateKey)
		s.boxPublicKey, _ = base64.StdEncoding.DecodeString(identity.BoxPublicKey)
		s.boxPrivateKey, _ = base64.StdEncoding.DecodeString(identity.BoxPrivateKey)

		log.Println("📂 Loaded existing identity")
	} else {
		// Generate new identity
		signPub, signPriv, _ := sign.GenerateKey(rand.Reader)
		boxPub, boxPriv, _ := box.GenerateKey(rand.Reader)

		s.signPublicKey = signPub[:]
		s.signPrivateKey = signPriv[:]
		s.boxPublicKey = boxPub[:]
		s.boxPrivateKey = boxPriv[:]

		// Save identity
		identity := map[string]string{
			"sign_public_key":  base64.StdEncoding.EncodeToString(s.signPublicKey),
			"sign_private_key": base64.StdEncoding.EncodeToString(s.signPrivateKey),
			"box_public_key":   base64.StdEncoding.EncodeToString(s.boxPublicKey[:]),
			"box_private_key":  base64.StdEncoding.EncodeToString(s.boxPrivateKey[:]),
		}

		data, _ := json.MarshalIndent(identity, "", "  ")
		os.MkdirAll("./diary-data", 0755)
		os.WriteFile(identityFile, data, 0600)

		log.Println("🔑 Generated new identity")
	}

	// Generate Nostr keys from sign keys
	s.nostrPrivKey = generateNostrPrivateKey(s.signPrivateKey)
	s.nostrPubKey = generateNostrPublicKey(s.signPublicKey)

	npub, _ := nip19.EncodePublicKey(s.nostrPubKey)
	log.Printf("📍 Service Nostr pubkey: %s", s.nostrPubKey)
	log.Printf("📍 Service npub: %s", npub)
	log.Printf("🔐 Service Box pubkey: %s", base64.StdEncoding.EncodeToString(s.boxPublicKey[:]))

	return nil
}

func (s *TrustDiaryService) connectToNostr() error {
	s.pool = nostr.NewSimplePool(context.Background())

	// Subscribe to:
	// 1. WebRTC answers directed at us
	// 2. Trusted reader requests
	// 3. Admin commands

	filters := []nostr.Filter{
		{
			Kinds: []int{KindWebRTCAnswer},
			Tags: nostr.TagMap{
				"p": []string{s.nostrPubKey}, // Messages for us
			},
			Since: func() *nostr.Timestamp { t := nostr.Now(); t = nostr.Timestamp(t.Time().Add(-1 * time.Hour).Unix()); return &t }(),
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

	// Find which trusted reader this is from
	var reader *TrustedReader
	for _, r := range s.trustedReaders {
		if r.NostrPubKey == event.PubKey {
			reader = &r
			break
		}
	}

	if reader == nil {
		log.Printf("⚠️ Answer from untrusted reader: %s", event.PubKey[:8])
		return
	}

	// Decrypt the answer
	var encryptedAnswer struct {
		Ciphertext string `json:"ciphertext"`
		Nonce      string `json:"nonce"`
		SenderBox  string `json:"sender_box_key"`
	}

	if err := json.Unmarshal([]byte(event.Content), &encryptedAnswer); err != nil {
		log.Printf("Failed to parse encrypted answer: %v", err)
		return
	}

	ciphertext, _ := base64.StdEncoding.DecodeString(encryptedAnswer.Ciphertext)
	nonce, _ := base64.StdEncoding.DecodeString(encryptedAnswer.Nonce)
	senderBoxKey, _ := base64.StdEncoding.DecodeString(encryptedAnswer.SenderBox)

	// Decrypt using NaCl box
	var nonceArray [24]byte
	copy(nonceArray[:], nonce)

	var senderPublicKey [32]byte
	copy(senderPublicKey[:], senderBoxKey)

	var privateKey [32]byte
	copy(privateKey[:], s.boxPrivateKey)

	decrypted, ok := box.Open(nil, ciphertext, &nonceArray, &senderPublicKey, &privateKey)
	if !ok {
		log.Println("Failed to decrypt answer")
		return
	}

	var answer struct {
		OfferID string `json:"offer_id"`
		SDP     string `json:"sdp"`
	}

	if err := json.Unmarshal(decrypted, &answer); err != nil {
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

	log.Printf("✅ Established P2P connection with %s", reader.Name)
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

	// Publish encrypted offers for each trusted reader
	for _, reader := range s.trustedReaders {
		s.publishEncryptedOffer(reader)
	}

	return nil
}

func (s *TrustDiaryService) publishEncryptedOffer(reader TrustedReader) {
	offer := EncryptedOffer{
		OfferID:    s.offerID,
		SDP:        s.currentOffer,
		ServiceBox: base64.StdEncoding.EncodeToString(s.boxPublicKey[:]),
		Timestamp:  time.Now().Unix(),
	}

	offerJSON, _ := json.Marshal(offer)

	// Generate nonce
	var nonce [24]byte
	rand.Read(nonce[:])

	// Decrypt reader's box public key
	readerBoxKey, _ := base64.StdEncoding.DecodeString(reader.BoxPublicKey)
	var readerPublicKey [32]byte
	copy(readerPublicKey[:], readerBoxKey)

	var privateKey [32]byte
	copy(privateKey[:], s.boxPrivateKey)

	// Encrypt offer for this reader
	encrypted := box.Seal(nil, offerJSON, &nonce, &readerPublicKey, &privateKey)

	encryptedOffer := map[string]string{
		"ciphertext": base64.StdEncoding.EncodeToString(encrypted),
		"nonce":      base64.StdEncoding.EncodeToString(nonce[:]),
	}

	content, _ := json.Marshal(encryptedOffer)

	// Create Nostr event
	ev := &nostr.Event{
		PubKey:    s.nostrPubKey,
		CreatedAt: nostr.Timestamp(time.Now().Unix()),
		Kind:      KindWebRTCOffer,
		Tags: nostr.Tags{
			{"p", reader.NostrPubKey}, // Tag for specific reader
		},
		Content: string(content),
	}

	// Sign event
	ev.Sign(s.nostrPrivKey)

	// Publish to relays
	for _, relay := range s.relays {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		relayConn, err := nostr.RelayConnect(ctx, relay)
		if err != nil {
			continue
		}

		if _, err := relayConn.Publish(ctx, *ev); err == nil {
			log.Printf("📤 Published encrypted offer for %s to %s", reader.Name, relay)
		}
		relayConn.Close()
	}
}

func (s *TrustDiaryService) publishTrustedReadersList() {
	// Publish list of trusted readers (public info)
	readers := make([]map[string]string, 0)
	for _, reader := range s.trustedReaders {
		readers = append(readers, map[string]string{
			"name":        reader.Name,
			"nostr_pubkey": reader.NostrPubKey,
			"permissions": reader.Permissions,
		})
	}

	content, _ := json.Marshal(readers)

	ev := &nostr.Event{
		PubKey:    s.nostrPubKey,
		CreatedAt: nostr.Timestamp(time.Now().Unix()),
		Kind:      KindTrustedReader,
		Content:   string(content),
	}

	ev.Sign(s.nostrPrivKey)

	// Publish to all relays
	for _, relay := range s.relays {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()

		relayConn, err := nostr.RelayConnect(ctx, relay)
		if err != nil {
			continue
		}

		_, _ = relayConn.Publish(ctx, *ev)
		relayConn.Close()
	}

	log.Println("📢 Published trusted readers list")
}

func (s *TrustDiaryService) loadTrustedReaders() {
	// For demo, add Tom as admin
	s.trustedReaders["tom"] = TrustedReader{
		Name:          "Tom (Admin)",
		SignPublicKey: base64.StdEncoding.EncodeToString(s.signPublicKey),
		BoxPublicKey:  base64.StdEncoding.EncodeToString(s.boxPublicKey[:]),
		NostrPubKey:   s.nostrPubKey, // Self
		AddedAt:       time.Now().Unix(),
		Permissions:   "admin",
	}

	// Load from file if exists
	if data, err := os.ReadFile("./diary-data/trusted-readers.json"); err == nil {
		json.Unmarshal(data, &s.trustedReaders)
	}

	log.Printf("📋 Loaded %d trusted readers", len(s.trustedReaders))
	s.publishTrustedReadersList()
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
	case "add-entry":
		// Admin only - verify signature
		// Add entry to diary
	}
}

// Helper functions
func generateNostrPrivateKey(ed25519PrivKey []byte) string {
	// Convert Ed25519 to Nostr format (simplified for demo)
	// In production, use proper key derivation
	var key [32]byte
	copy(key[:], ed25519PrivKey[:32])
	return fmt.Sprintf("%x", key)
}

func generateNostrPublicKey(ed25519PubKey []byte) string {
	// Convert Ed25519 to Nostr format (simplified for demo)
	var key [32]byte
	copy(key[:], ed25519PubKey[:32])
	return fmt.Sprintf("%x", key)
}