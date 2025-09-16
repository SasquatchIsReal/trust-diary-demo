package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/mux"
	"github.com/nbd-wtf/go-nostr"
	"github.com/nbd-wtf/go-nostr/nip19"
	"github.com/pion/webrtc/v3"
	qrcode "github.com/skip2/go-qrcode"
	"golang.org/x/crypto/nacl/box"
)

// Known public Nostr relays
var defaultRelays = []string{
	"wss://relay.damus.io",
	"wss://relay.nostr.band",
	"wss://nos.lol",
	"wss://relay.snort.social",
	"wss://relay.primal.net",
}

// TrustDiaryService with Nostr signaling
type TrustDiaryService struct {
	identity       *Identity
	nostrPrivKey   string
	nostrPubKey    string
	trustedUsers   map[string]*TrustedUser
	entries        []DiaryEntry
	peerConnection *webrtc.PeerConnection
	dataChannel    *webrtc.DataChannel
	currentOffer   string
	offerID        string
	relays         []*nostr.Relay
	mu             sync.RWMutex
	dataDir        string
	port           int
}

type Identity struct {
	PublicKey     ed25519.PublicKey  `json:"publicKey"`
	PrivateKey    ed25519.PrivateKey `json:"-"`
	BoxPublicKey  [32]byte           `json:"boxPublicKey"`
	BoxPrivateKey [32]byte           `json:"-"`
}

type TrustedUser struct {
	PublicKey    string    `json:"publicKey"`
	BoxPublicKey string    `json:"boxPublicKey"`
	Name         string    `json:"name"`
	Permissions  []string  `json:"permissions"`
	TrustedAt    time.Time `json:"trustedAt"`
}

type DiaryEntry struct {
	ID        int       `json:"id"`
	Content   string    `json:"content"`
	Timestamp time.Time `json:"timestamp"`
	Author    string    `json:"author"`
}

func NewTrustDiaryService(dataDir string, port int) *TrustDiaryService {
	return &TrustDiaryService{
		trustedUsers: make(map[string]*TrustedUser),
		entries:      []DiaryEntry{},
		dataDir:      dataDir,
		port:         port,
		relays:       make([]*nostr.Relay, 0),
	}
}

func (s *TrustDiaryService) Initialize() error {
	log.Println("🚀 Initializing Trust Diary Service with Nostr...")

	if err := os.MkdirAll(s.dataDir, 0755); err != nil {
		return fmt.Errorf("failed to create data dir: %w", err)
	}

	if err := s.loadOrGenerateIdentity(); err != nil {
		return fmt.Errorf("failed to load identity: %w", err)
	}

	// Generate Nostr keys from our Ed25519 identity
	s.generateNostrKeys()

	// Connect to Nostr relays
	if err := s.connectToNostrRelays(); err != nil {
		log.Printf("Warning: Failed to connect to Nostr relays: %v", err)
	}

	// Create initial WebRTC offer
	if err := s.createWebRTCOffer(); err != nil {
		return fmt.Errorf("failed to create WebRTC offer: %w", err)
	}

	// Publish offer to Nostr
	s.publishOfferToNostr()

	log.Printf("✅ Service initialized")
	log.Printf("📍 Admin UI: http://localhost:%d", s.port)
	log.Printf("🔑 Service Public Key: %s...", base64.StdEncoding.EncodeToString(s.identity.PublicKey)[:32])
	log.Printf("⚡ Nostr Public Key: %s", s.nostrPubKey)
	log.Printf("📡 Connected to %d Nostr relays", len(s.relays))

	return nil
}

func (s *TrustDiaryService) loadOrGenerateIdentity() error {
	identityPath := filepath.Join(s.dataDir, "identity.json")

	if data, err := os.ReadFile(identityPath); err == nil {
		var stored struct {
			PublicKey     string `json:"publicKey"`
			PrivateKey    string `json:"privateKey"`
			BoxPublicKey  string `json:"boxPublicKey"`
			BoxPrivateKey string `json:"boxPrivateKey"`
		}

		if err := json.Unmarshal(data, &stored); err != nil {
			return fmt.Errorf("failed to parse identity: %w", err)
		}

		pubKey, _ := base64.StdEncoding.DecodeString(stored.PublicKey)
		privKey, _ := base64.StdEncoding.DecodeString(stored.PrivateKey)
		boxPubKey, _ := base64.StdEncoding.DecodeString(stored.BoxPublicKey)
		boxPrivKey, _ := base64.StdEncoding.DecodeString(stored.BoxPrivateKey)

		s.identity = &Identity{
			PublicKey:  ed25519.PublicKey(pubKey),
			PrivateKey: ed25519.PrivateKey(privKey),
		}
		copy(s.identity.BoxPublicKey[:], boxPubKey)
		copy(s.identity.BoxPrivateKey[:], boxPrivKey)

		log.Println("📂 Loaded existing identity")
		return nil
	}

	// Generate new identity
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return fmt.Errorf("failed to generate ed25519 keys: %w", err)
	}

	boxPub, boxPriv, err := box.GenerateKey(rand.Reader)
	if err != nil {
		return fmt.Errorf("failed to generate box keys: %w", err)
	}

	s.identity = &Identity{
		PublicKey:     pub,
		PrivateKey:    priv,
		BoxPublicKey:  *boxPub,
		BoxPrivateKey: *boxPriv,
	}

	// Save identity
	stored := map[string]string{
		"publicKey":     base64.StdEncoding.EncodeToString(pub),
		"privateKey":    base64.StdEncoding.EncodeToString(priv),
		"boxPublicKey":  base64.StdEncoding.EncodeToString(boxPub[:]),
		"boxPrivateKey": base64.StdEncoding.EncodeToString(boxPriv[:]),
		"createdAt":     time.Now().Format(time.RFC3339),
	}

	data, err := json.MarshalIndent(stored, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal identity: %w", err)
	}

	if err := os.WriteFile(identityPath, data, 0600); err != nil {
		return fmt.Errorf("failed to save identity: %w", err)
	}

	log.Println("🔐 Generated new identity")
	return nil
}

func (s *TrustDiaryService) generateNostrKeys() {
	// Generate Nostr keys from our Ed25519 identity
	// Nostr uses secp256k1, but we'll derive it from our Ed25519 seed
	hash := sha256.Sum256(s.identity.PrivateKey.Seed())
	s.nostrPrivKey = hex.EncodeToString(hash[:])

	// Get public key from private key

	pk, _ := nostr.GetPublicKey(s.nostrPrivKey)
	s.nostrPubKey = pk
}

func (s *TrustDiaryService) connectToNostrRelays() error {
	for _, url := range defaultRelays {
		relay, err := nostr.RelayConnect(context.Background(), url)
		if err != nil {
			log.Printf("Failed to connect to %s: %v", url, err)
			continue
		}
		s.relays = append(s.relays, relay)
		log.Printf("✅ Connected to Nostr relay: %s", url)
	}

	if len(s.relays) == 0 {
		return fmt.Errorf("failed to connect to any Nostr relay")
	}

	// Subscribe to answers to our offers
	s.subscribeToAnswers()

	return nil
}

func (s *TrustDiaryService) subscribeToAnswers() {
	filters := []nostr.Filter{{
		Authors: []string{s.nostrPubKey},
		Kinds:   []int{21001}, // Custom kind for WebRTC answers
		Since:   &[]nostr.Timestamp{nostr.Timestamp(time.Now().Add(-24 * time.Hour).Unix())}[0],
	}}

	for _, relay := range s.relays {
		sub, err := relay.Subscribe(context.Background(), filters)
		if err != nil {
			log.Printf("Failed to subscribe on %s: %v", relay.URL, err)
			continue
		}

		go func(relay *nostr.Relay) {
			for ev := range sub.Events {
				s.handleNostrAnswer(ev)
			}
		}(relay)
	}
}

func (s *TrustDiaryService) createWebRTCOffer() error {
	config := webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{URLs: []string{"stun:stun.l.google.com:19302"}},
			{URLs: []string{"stun:stun1.l.google.com:19302"}},
		},
	}

	pc, err := webrtc.NewPeerConnection(config)
	if err != nil {
		return fmt.Errorf("failed to create peer connection: %w", err)
	}

	// Create data channel
	dc, err := pc.CreateDataChannel("trust-diary", nil)
	if err != nil {
		return fmt.Errorf("failed to create data channel: %w", err)
	}

	dc.OnOpen(func() {
		log.Println("📡 Data channel opened")
		s.sendAuthChallenge()
	})

	dc.OnMessage(func(msg webrtc.DataChannelMessage) {
		s.handleDataChannelMessage(msg.Data)
	})

	// Create offer
	offer, err := pc.CreateOffer(nil)
	if err != nil {
		return fmt.Errorf("failed to create offer: %w", err)
	}

	if err := pc.SetLocalDescription(offer); err != nil {
		return fmt.Errorf("failed to set local description: %w", err)
	}

	// Wait for ICE gathering to complete
	gatherComplete := webrtc.GatheringCompletePromise(pc)
	<-gatherComplete

	s.peerConnection = pc
	s.dataChannel = dc
	s.currentOffer = pc.LocalDescription().SDP
	s.offerID = generateOfferID()

	return nil
}

func generateOfferID() string {
	b := make([]byte, 8)
	rand.Read(b)
	return hex.EncodeToString(b)
}

func (s *TrustDiaryService) publishOfferToNostr() {
	// Create offer event
	offerData := map[string]string{
		"type":         "offer",
		"sdp":          s.currentOffer,
		"offerId":      s.offerID,
		"serviceName":  "Trust Diary",
		"publicKey":    base64.StdEncoding.EncodeToString(s.identity.PublicKey),
		"boxPublicKey": base64.StdEncoding.EncodeToString(s.identity.BoxPublicKey[:]),
	}

	content, _ := json.Marshal(offerData)

	ev := nostr.Event{
		PubKey:    s.nostrPubKey,
		CreatedAt: nostr.Timestamp(time.Now().Unix()),
		Kind:      21000, // Custom kind for WebRTC offers
		Tags: nostr.Tags{
			{"service", "trust-diary"},
			{"offer-id", s.offerID},
		},
		Content: string(content),
	}

	// Sign the event
	ev.Sign(s.nostrPrivKey)

	// Publish to all connected relays
	for _, relay := range s.relays {
		_, err := relay.Publish(context.Background(), ev)
		if err != nil {
			log.Printf("Failed to publish to %s: %v", relay.URL, err)
		} else {
			log.Printf("📤 Published offer to %s", relay.URL)
		}
	}
}

func (s *TrustDiaryService) handleNostrAnswer(ev *nostr.Event) {
	// Parse answer from event
	var answer struct {
		Type    string `json:"type"`
		SDP     string `json:"sdp"`
		OfferID string `json:"offerId"`
	}

	if err := json.Unmarshal([]byte(ev.Content), &answer); err != nil {
		log.Printf("Failed to parse answer: %v", err)
		return
	}

	if answer.Type != "answer" || answer.OfferID != s.offerID {
		return
	}

	log.Println("📥 Received answer from Nostr")

	// Set remote description
	sdp := webrtc.SessionDescription{
		Type: webrtc.SDPTypeAnswer,
		SDP:  answer.SDP,
	}

	if err := s.peerConnection.SetRemoteDescription(sdp); err != nil {
		log.Printf("Failed to set remote description: %v", err)
	}
}

func (s *TrustDiaryService) sendAuthChallenge() {
	challenge := make([]byte, 32)
	rand.Read(challenge)

	msg := map[string]interface{}{
		"type":             "challenge",
		"challenge":        base64.StdEncoding.EncodeToString(challenge),
		"servicePublicKey": base64.StdEncoding.EncodeToString(s.identity.PublicKey),
	}

	data, _ := json.Marshal(msg)
	s.dataChannel.SendText(string(data))
}

func (s *TrustDiaryService) handleDataChannelMessage(data []byte) {
	var msg map[string]interface{}
	if err := json.Unmarshal(data, &msg); err != nil {
		return
	}

	msgType, _ := msg["type"].(string)

	switch msgType {
	case "response":
		// Handle auth response
		log.Println("Received auth response")
	case "request":
		// Send entries
		s.sendEntries()
	}
}

func (s *TrustDiaryService) sendEntries() {
	for _, entry := range s.entries {
		msg := map[string]interface{}{
			"type":  "entry",
			"entry": entry,
		}
		data, _ := json.Marshal(msg)
		s.dataChannel.SendText(string(data))
	}
}

func (s *TrustDiaryService) corsMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Allow all origins for development
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Max-Age", "86400")

		// Handle preflight requests
		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func (s *TrustDiaryService) StartHTTPServer() error {
	router := mux.NewRouter()

	// API endpoints
	router.HandleFunc("/api/status", s.handleStatus).Methods("GET", "OPTIONS")
	router.HandleFunc("/api/offer", s.handleGetOffer).Methods("GET", "OPTIONS")
	router.HandleFunc("/api/answer", s.handleSubmitAnswer).Methods("POST", "OPTIONS")
	router.HandleFunc("/api/qr", s.handleGetQR).Methods("GET", "OPTIONS")

	// Serve static files
	router.PathPrefix("/").Handler(http.FileServer(http.Dir("./static")))

	// Add CORS middleware
	handler := s.corsMiddleware(router)

	addr := fmt.Sprintf(":%d", s.port)
	log.Printf("🌐 Starting HTTP server on %s", addr)
	return http.ListenAndServe(addr, handler)
}

func (s *TrustDiaryService) handleStatus(w http.ResponseWriter, r *http.Request) {
	npub, _ := nip19.EncodePublicKey(s.nostrPubKey)

	status := map[string]interface{}{
		"running":         true,
		"publicKey":       base64.StdEncoding.EncodeToString(s.identity.PublicKey),
		"boxPublicKey":    base64.StdEncoding.EncodeToString(s.identity.BoxPublicKey[:]),
		"nostrPubKey":     s.nostrPubKey,
		"nostrNpub":       npub,
		"offerId":         s.offerID,
		"relaysConnected": len(s.relays),
		"connectionState": "waiting",
	}

	if s.peerConnection != nil {
		status["connectionState"] = s.peerConnection.ConnectionState().String()
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

func (s *TrustDiaryService) handleGetOffer(w http.ResponseWriter, r *http.Request) {
	offer := map[string]string{
		"type":    "offer",
		"sdp":     s.currentOffer,
		"offerId": s.offerID,
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(offer)
}

func (s *TrustDiaryService) handleSubmitAnswer(w http.ResponseWriter, r *http.Request) {
	var answer struct {
		SDP     string `json:"sdp"`
		OfferID string `json:"offerId"`
	}

	if err := json.NewDecoder(r.Body).Decode(&answer); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if answer.OfferID != s.offerID {
		http.Error(w, "Invalid offer ID", http.StatusBadRequest)
		return
	}

	// Set remote description
	sdp := webrtc.SessionDescription{
		Type: webrtc.SDPTypeAnswer,
		SDP:  answer.SDP,
	}

	if err := s.peerConnection.SetRemoteDescription(sdp); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

func (s *TrustDiaryService) handleGetQR(w http.ResponseWriter, r *http.Request) {
	// Generate QR code with connection info
	connectionInfo := map[string]string{
		"nostrPubKey": s.nostrPubKey,
		"offerId":     s.offerID,
		"url":         fmt.Sprintf("http://localhost:%d", s.port),
	}

	data, _ := json.Marshal(connectionInfo)
	qr, err := qrcode.Encode(string(data), qrcode.Medium, 256)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "image/png")
	w.Write(qr)
}

func main() {
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "./diary-data"
	}

	port := 3333
	if portStr := os.Getenv("PORT"); portStr != "" {
		fmt.Sscanf(portStr, "%d", &port)
	}

	service := NewTrustDiaryService(dataDir, port)

	if err := service.Initialize(); err != nil {
		log.Fatalf("Failed to initialize service: %v", err)
	}

	// Print connection instructions
	fmt.Println("\n" + strings.Repeat("=", 60))
	fmt.Println("🔐 TRUST DIARY SERVICE - NOSTR P2P")
	fmt.Println(strings.Repeat("=", 60))
	fmt.Printf("\n📡 CONNECTION OPTIONS:\n\n")

	fmt.Println("1️⃣  NOSTR DISCOVERY (Automatic)")
	fmt.Printf("   Share this Nostr pubkey: %s\n", service.nostrPubKey)
	npub, _ := nip19.EncodePublicKey(service.nostrPubKey)
	fmt.Printf("   Or npub format: %s\n\n", npub)

	fmt.Println("2️⃣  MANUAL EXCHANGE (Zero Infrastructure)")
	fmt.Printf("   Get offer at: http://localhost:%d/api/offer\n", port)
	fmt.Printf("   Submit answer at: http://localhost:%d/api/answer\n\n", port)

	fmt.Println("3️⃣  QR CODE")
	fmt.Printf("   View QR at: http://localhost:%d/api/qr\n", port)

	fmt.Println("\n" + strings.Repeat("=", 60))
	fmt.Printf("\n🌐 Admin Panel: http://localhost:%d\n\n", port)

	if err := service.StartHTTPServer(); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}