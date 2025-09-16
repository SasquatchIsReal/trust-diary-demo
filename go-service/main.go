package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"github.com/gorilla/mux"
	"github.com/gorilla/websocket"
	"github.com/pion/webrtc/v3"
	"golang.org/x/crypto/nacl/box"
)

// TrustDiaryService represents the main service
type TrustDiaryService struct {
	identity      *Identity
	trustedUsers  map[string]*TrustedUser
	entries       []DiaryEntry
	connections   map[string]*Connection
	peerConns     map[string]*webrtc.PeerConnection
	dataChannels  map[string]*webrtc.DataChannel
	mu            sync.RWMutex
	dataDir       string
	port          int
	roomSalt      string
	roomID        string
	wsUpgrader    websocket.Upgrader
}

// Identity represents the service's cryptographic identity
type Identity struct {
	PublicKey    ed25519.PublicKey    `json:"publicKey"`
	PrivateKey   ed25519.PrivateKey   `json:"-"`
	BoxPublicKey [32]byte             `json:"boxPublicKey"`
	BoxPrivateKey [32]byte            `json:"-"`
}

// TrustedUser represents a user trusted by the service
type TrustedUser struct {
	PublicKey    string    `json:"publicKey"`
	BoxPublicKey string    `json:"boxPublicKey"`
	Name         string    `json:"name"`
	Permissions  []string  `json:"permissions"`
	TrustedAt    time.Time `json:"trustedAt"`
}

// DiaryEntry represents a single diary entry
type DiaryEntry struct {
	ID        int       `json:"id"`
	Content   string    `json:"content"`
	Timestamp time.Time `json:"timestamp"`
	Author    string    `json:"author"`
}

// Connection represents an active P2P connection
type Connection struct {
	ID           string
	State        string
	PublicKey    string
	Name         string
	Challenge    []byte
	Authenticated bool
}

// WebRTC offer/answer messages
type SignalMessage struct {
	Type      string                     `json:"type"`
	SDP       string                     `json:"sdp,omitempty"`
	Candidate *webrtc.ICECandidateInit   `json:"candidate,omitempty"`
}

// NewTrustDiaryService creates a new service instance
func NewTrustDiaryService(dataDir string, port int) *TrustDiaryService {
	return &TrustDiaryService{
		trustedUsers:  make(map[string]*TrustedUser),
		entries:       []DiaryEntry{},
		connections:   make(map[string]*Connection),
		peerConns:     make(map[string]*webrtc.PeerConnection),
		dataChannels:  make(map[string]*webrtc.DataChannel),
		dataDir:       dataDir,
		port:          port,
		roomSalt:      "trust-diary-v1",
		wsUpgrader: websocket.Upgrader{
			CheckOrigin: func(r *http.Request) bool {
				return true // Allow all origins for demo
			},
		},
	}
}

// Initialize sets up the service
func (s *TrustDiaryService) Initialize() error {
	log.Println("🚀 Initializing Trust Diary Service...")

	// Create data directory
	if err := os.MkdirAll(s.dataDir, 0755); err != nil {
		return fmt.Errorf("failed to create data dir: %w", err)
	}

	// Load or generate identity
	if err := s.loadOrGenerateIdentity(); err != nil {
		return fmt.Errorf("failed to load identity: %w", err)
	}

	// Load trusted users
	if err := s.loadTrustedUsers(); err != nil {
		log.Printf("Warning: %v", err)
	}

	// Load entries
	if err := s.loadEntries(); err != nil {
		log.Printf("Warning: %v", err)
	}

	// Generate room ID
	s.roomID = s.generateRoomID()

	log.Printf("✅ Service initialized")
	log.Printf("📍 Admin UI: http://localhost:%d", s.port)
	log.Printf("🔑 Service Public Key: %s...", base64.StdEncoding.EncodeToString(s.identity.PublicKey)[:32])
	log.Printf("🌐 P2P Room ID: %s", s.roomID)

	return nil
}

// loadOrGenerateIdentity loads existing identity or generates new one
func (s *TrustDiaryService) loadOrGenerateIdentity() error {
	identityPath := filepath.Join(s.dataDir, "identity.json")

	// Try to load existing identity
	if data, err := os.ReadFile(identityPath); err == nil {
		var stored struct {
			PublicKey    string `json:"publicKey"`
			PrivateKey   string `json:"privateKey"`
			BoxPublicKey string `json:"boxPublicKey"`
			BoxPrivateKey string `json:"boxPrivateKey"`
		}

		if err := json.Unmarshal(data, &stored); err != nil {
			return fmt.Errorf("failed to parse identity: %w", err)
		}

		// Decode keys
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

// loadTrustedUsers loads trusted users from disk
func (s *TrustDiaryService) loadTrustedUsers() error {
	trustedPath := filepath.Join(s.dataDir, "trusted.json")

	data, err := os.ReadFile(trustedPath)
	if err != nil {
		return fmt.Errorf("no trusted users found")
	}

	var trusted []TrustedUser
	if err := json.Unmarshal(data, &trusted); err != nil {
		return fmt.Errorf("failed to parse trusted users: %w", err)
	}

	s.mu.Lock()
	defer s.mu.Unlock()

	for _, user := range trusted {
		s.trustedUsers[user.PublicKey] = &user
	}

	log.Printf("👥 Loaded %d trusted users", len(s.trustedUsers))
	return nil
}

// saveTrustedUsers saves trusted users to disk
func (s *TrustDiaryService) saveTrustedUsers() error {
	s.mu.RLock()
	trusted := make([]TrustedUser, 0, len(s.trustedUsers))
	for _, user := range s.trustedUsers {
		trusted = append(trusted, *user)
	}
	s.mu.RUnlock()

	data, err := json.MarshalIndent(trusted, "", "  ")
	if err != nil {
		return fmt.Errorf("failed to marshal trusted users: %w", err)
	}

	trustedPath := filepath.Join(s.dataDir, "trusted.json")
	return os.WriteFile(trustedPath, data, 0644)
}

// loadEntries loads diary entries from disk
func (s *TrustDiaryService) loadEntries() error {
	entriesPath := filepath.Join(s.dataDir, "entries.json")

	data, err := os.ReadFile(entriesPath)
	if err != nil {
		// Create initial entry
		s.entries = []DiaryEntry{
			{
				ID:        1,
				Content:   "Trust Diary Service started",
				Timestamp: time.Now(),
				Author:    "Service",
			},
		}
		return s.saveEntries()
	}

	if err := json.Unmarshal(data, &s.entries); err != nil {
		return fmt.Errorf("failed to parse entries: %w", err)
	}

	log.Printf("📝 Loaded %d entries", len(s.entries))
	return nil
}

// saveEntries saves diary entries to disk
func (s *TrustDiaryService) saveEntries() error {
	s.mu.RLock()
	data, err := json.MarshalIndent(s.entries, "", "  ")
	s.mu.RUnlock()

	if err != nil {
		return fmt.Errorf("failed to marshal entries: %w", err)
	}

	entriesPath := filepath.Join(s.dataDir, "entries.json")
	return os.WriteFile(entriesPath, data, 0644)
}

// generateRoomID generates a deterministic room ID from service public key
func (s *TrustDiaryService) generateRoomID() string {
	material := fmt.Sprintf("%s:%s", s.roomSalt, base64.StdEncoding.EncodeToString(s.identity.PublicKey))
	hash := sha256.Sum256([]byte(material))
	return base64.StdEncoding.EncodeToString(hash[:])[:20]
}

// StartHTTPServer starts the HTTP/WebSocket server
func (s *TrustDiaryService) StartHTTPServer() error {
	router := mux.NewRouter()

	// Serve admin UI
	router.PathPrefix("/admin/").Handler(http.StripPrefix("/admin/",
		http.FileServer(http.Dir("./admin-ui"))))
	router.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, "/admin/", http.StatusFound)
	})

	// API endpoints
	router.HandleFunc("/api/status", s.handleStatus).Methods("GET")
	router.HandleFunc("/api/entries", s.handleGetEntries).Methods("GET")
	router.HandleFunc("/api/entries", s.handleAddEntry).Methods("POST")
	router.HandleFunc("/api/trusted", s.handleGetTrusted).Methods("GET")
	router.HandleFunc("/api/trusted", s.handleAddTrusted).Methods("POST")
	router.HandleFunc("/api/trusted/{key}", s.handleRemoveTrusted).Methods("DELETE")

	// WebRTC signaling
	router.HandleFunc("/ws/signal", s.handleWebSocketSignaling)

	// Start server
	addr := fmt.Sprintf(":%d", s.port)
	log.Printf("🌐 Starting HTTP server on %s", addr)
	return http.ListenAndServe(addr, router)
}

// handleStatus returns service status
func (s *TrustDiaryService) handleStatus(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	status := map[string]interface{}{
		"running":       true,
		"roomId":        s.roomID,
		"publicKey":     base64.StdEncoding.EncodeToString(s.identity.PublicKey),
		"boxPublicKey":  base64.StdEncoding.EncodeToString(s.identity.BoxPublicKey[:]),
		"trustedCount":  len(s.trustedUsers),
		"entriesCount":  len(s.entries),
		"connections":   s.getConnectionsStatus(),
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(status)
}

// getConnectionsStatus returns status of all connections
func (s *TrustDiaryService) getConnectionsStatus() []map[string]string {
	conns := make([]map[string]string, 0, len(s.connections))
	for id, conn := range s.connections {
		conns = append(conns, map[string]string{
			"id":    id[:8],
			"state": conn.State,
			"name":  conn.Name,
		})
	}
	return conns
}

// handleGetEntries returns all entries
func (s *TrustDiaryService) handleGetEntries(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(s.entries)
}

// handleAddEntry adds a new entry
func (s *TrustDiaryService) handleAddEntry(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Content string `json:"content"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	s.mu.Lock()
	entry := DiaryEntry{
		ID:        len(s.entries) + 1,
		Content:   req.Content,
		Timestamp: time.Now(),
		Author:    "Admin",
	}
	s.entries = append(s.entries, entry)
	s.mu.Unlock()

	if err := s.saveEntries(); err != nil {
		log.Printf("Failed to save entries: %v", err)
	}

	// Broadcast to connected peers
	s.broadcastEntry(entry)

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(entry)
}

// handleGetTrusted returns trusted users
func (s *TrustDiaryService) handleGetTrusted(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	trusted := make([]TrustedUser, 0, len(s.trustedUsers))
	for _, user := range s.trustedUsers {
		trusted = append(trusted, *user)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(trusted)
}

// handleAddTrusted adds a trusted user
func (s *TrustDiaryService) handleAddTrusted(w http.ResponseWriter, r *http.Request) {
	var user TrustedUser
	if err := json.NewDecoder(r.Body).Decode(&user); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}

	if user.Permissions == nil {
		user.Permissions = []string{"read"}
	}
	user.TrustedAt = time.Now()

	s.mu.Lock()
	s.trustedUsers[user.PublicKey] = &user
	s.mu.Unlock()

	if err := s.saveTrustedUsers(); err != nil {
		log.Printf("Failed to save trusted users: %v", err)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

// handleRemoveTrusted removes a trusted user
func (s *TrustDiaryService) handleRemoveTrusted(w http.ResponseWriter, r *http.Request) {
	vars := mux.Vars(r)
	key := vars["key"]

	s.mu.Lock()
	delete(s.trustedUsers, key)
	s.mu.Unlock()

	if err := s.saveTrustedUsers(); err != nil {
		log.Printf("Failed to save trusted users: %v", err)
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]bool{"success": true})
}

// handleWebSocketSignaling handles WebRTC signaling
func (s *TrustDiaryService) handleWebSocketSignaling(w http.ResponseWriter, r *http.Request) {
	conn, err := s.wsUpgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade failed: %v", err)
		return
	}
	defer conn.Close()

	peerID := fmt.Sprintf("%d", time.Now().UnixNano())
	log.Printf("🔌 WebSocket connected: %s", peerID[:8])

	// Create WebRTC peer connection
	config := webrtc.Configuration{
		ICEServers: []webrtc.ICEServer{
			{
				URLs: []string{"stun:stun.l.google.com:19302"},
			},
		},
	}

	peerConnection, err := webrtc.NewPeerConnection(config)
	if err != nil {
		log.Printf("Failed to create peer connection: %v", err)
		return
	}
	defer peerConnection.Close()

	s.mu.Lock()
	s.peerConns[peerID] = peerConnection
	s.connections[peerID] = &Connection{
		ID:    peerID,
		State: "connecting",
	}
	s.mu.Unlock()

	// Handle ICE candidates
	peerConnection.OnICECandidate(func(candidate *webrtc.ICECandidate) {
		if candidate == nil {
			return
		}

		candidateJSON := candidate.ToJSON()
		msg := SignalMessage{
			Type:      "candidate",
			Candidate: &candidateJSON,
		}

		if err := conn.WriteJSON(msg); err != nil {
			log.Printf("Failed to send ICE candidate: %v", err)
		}
	})

	// Handle data channel
	peerConnection.OnDataChannel(func(dc *webrtc.DataChannel) {
		log.Printf("📡 Data channel opened: %s", dc.Label())

		s.mu.Lock()
		s.dataChannels[peerID] = dc
		s.connections[peerID].State = "connected"
		s.mu.Unlock()

		dc.OnOpen(func() {
			// Send authentication challenge
			s.sendAuthChallenge(peerID, dc)
		})

		dc.OnMessage(func(msg webrtc.DataChannelMessage) {
			s.handleDataChannelMessage(peerID, msg.Data)
		})

		dc.OnClose(func() {
			s.mu.Lock()
			delete(s.dataChannels, peerID)
			s.connections[peerID].State = "disconnected"
			s.mu.Unlock()
		})
	})

	// Handle signaling messages
	for {
		var msg SignalMessage
		if err := conn.ReadJSON(&msg); err != nil {
			log.Printf("WebSocket read error: %v", err)
			break
		}

		switch msg.Type {
		case "offer":
			s.handleOffer(peerID, peerConnection, msg.SDP, conn)
		case "answer":
			s.handleAnswer(peerConnection, msg.SDP)
		case "candidate":
			if msg.Candidate != nil {
				s.handleICECandidate(peerConnection, *msg.Candidate)
			}
		}
	}

	// Cleanup
	s.mu.Lock()
	delete(s.peerConns, peerID)
	delete(s.connections, peerID)
	delete(s.dataChannels, peerID)
	s.mu.Unlock()
}

// handleOffer handles WebRTC offer
func (s *TrustDiaryService) handleOffer(peerID string, pc *webrtc.PeerConnection, offerSDP string, ws *websocket.Conn) {
	offer := webrtc.SessionDescription{
		Type: webrtc.SDPTypeOffer,
		SDP:  offerSDP,
	}

	if err := pc.SetRemoteDescription(offer); err != nil {
		log.Printf("Failed to set remote description: %v", err)
		return
	}

	answer, err := pc.CreateAnswer(nil)
	if err != nil {
		log.Printf("Failed to create answer: %v", err)
		return
	}

	if err := pc.SetLocalDescription(answer); err != nil {
		log.Printf("Failed to set local description: %v", err)
		return
	}

	msg := SignalMessage{
		Type: "answer",
		SDP:  answer.SDP,
	}

	if err := ws.WriteJSON(msg); err != nil {
		log.Printf("Failed to send answer: %v", err)
	}
}

// handleAnswer handles WebRTC answer
func (s *TrustDiaryService) handleAnswer(pc *webrtc.PeerConnection, answerSDP string) {
	answer := webrtc.SessionDescription{
		Type: webrtc.SDPTypeAnswer,
		SDP:  answerSDP,
	}

	if err := pc.SetRemoteDescription(answer); err != nil {
		log.Printf("Failed to set remote description: %v", err)
	}
}

// handleICECandidate handles ICE candidate
func (s *TrustDiaryService) handleICECandidate(pc *webrtc.PeerConnection, candidate webrtc.ICECandidateInit) {
	if err := pc.AddICECandidate(candidate); err != nil {
		log.Printf("Failed to add ICE candidate: %v", err)
	}
}

// sendAuthChallenge sends authentication challenge to peer
func (s *TrustDiaryService) sendAuthChallenge(peerID string, dc *webrtc.DataChannel) {
	challenge := make([]byte, 32)
	rand.Read(challenge)

	s.mu.Lock()
	s.connections[peerID].Challenge = challenge
	s.mu.Unlock()

	msg := map[string]interface{}{
		"type":             "challenge",
		"challenge":        base64.StdEncoding.EncodeToString(challenge),
		"servicePublicKey": base64.StdEncoding.EncodeToString(s.identity.PublicKey),
		"serviceBoxPublicKey": base64.StdEncoding.EncodeToString(s.identity.BoxPublicKey[:]),
	}

	data, _ := json.Marshal(msg)
	dc.SendText(string(data))
}

// handleDataChannelMessage handles messages from data channel
func (s *TrustDiaryService) handleDataChannelMessage(peerID string, data []byte) {
	var msg map[string]interface{}
	if err := json.Unmarshal(data, &msg); err != nil {
		log.Printf("Failed to parse message: %v", err)
		return
	}

	msgType, _ := msg["type"].(string)

	switch msgType {
	case "response":
		s.handleAuthResponse(peerID, msg)
	case "request":
		s.handleEntryRequest(peerID)
	}
}

// handleAuthResponse handles authentication response
func (s *TrustDiaryService) handleAuthResponse(peerID string, msg map[string]interface{}) {
	s.mu.Lock()
	conn := s.connections[peerID]
	s.mu.Unlock()

	if conn == nil || conn.Challenge == nil {
		log.Printf("⚠️ Unexpected auth response from %s", peerID[:8])
		return
	}

	// Verify signature
	sigStr, _ := msg["signature"].(string)
	pubKeyStr, _ := msg["publicKey"].(string)

	signature, _ := base64.StdEncoding.DecodeString(sigStr)
	pubKey, _ := base64.StdEncoding.DecodeString(pubKeyStr)

	if !ed25519.Verify(ed25519.PublicKey(pubKey), conn.Challenge, signature) {
		log.Printf("❌ Authentication failed for %s", peerID[:8])
		return
	}

	// Check if trusted
	s.mu.RLock()
	trusted, exists := s.trustedUsers[pubKeyStr]
	s.mu.RUnlock()

	if !exists {
		log.Printf("⛔ Untrusted key from %s", peerID[:8])
		conn.State = "untrusted"
		return
	}

	// Authentication successful
	s.mu.Lock()
	conn.State = "authenticated"
	conn.PublicKey = pubKeyStr
	conn.Name = trusted.Name
	conn.Authenticated = true
	s.mu.Unlock()

	log.Printf("✅ Authenticated: %s (%s...)", trusted.Name, peerID[:8])

	// Send entries to authenticated peer
	s.sendEntriesToPeer(peerID)
}

// handleEntryRequest handles request for entries
func (s *TrustDiaryService) handleEntryRequest(peerID string) {
	s.mu.RLock()
	conn := s.connections[peerID]
	s.mu.RUnlock()

	if conn == nil || !conn.Authenticated {
		return
	}

	s.sendEntriesToPeer(peerID)
}

// sendEntriesToPeer sends all entries to authenticated peer
func (s *TrustDiaryService) sendEntriesToPeer(peerID string) {
	s.mu.RLock()
	dc := s.dataChannels[peerID]
	conn := s.connections[peerID]
	entries := s.entries
	s.mu.RUnlock()

	if dc == nil || conn == nil || !conn.Authenticated {
		return
	}

	for _, entry := range entries {
		msg := map[string]interface{}{
			"type":  "entry",
			"entry": entry,
		}

		data, _ := json.Marshal(msg)
		dc.SendText(string(data))
	}
}

// broadcastEntry broadcasts entry to all authenticated peers
func (s *TrustDiaryService) broadcastEntry(entry DiaryEntry) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	msg := map[string]interface{}{
		"type":  "entry",
		"entry": entry,
	}
	data, _ := json.Marshal(msg)

	for peerID, conn := range s.connections {
		if conn.Authenticated {
			if dc, ok := s.dataChannels[peerID]; ok {
				dc.SendText(string(data))
			}
		}
	}
}

func main() {
	// Get configuration from environment
	dataDir := os.Getenv("DATA_DIR")
	if dataDir == "" {
		dataDir = "./diary-data"
	}

	port := 3333
	if portStr := os.Getenv("PORT"); portStr != "" {
		fmt.Sscanf(portStr, "%d", &port)
	}

	// Create and initialize service
	service := NewTrustDiaryService(dataDir, port)

	if err := service.Initialize(); err != nil {
		log.Fatalf("Failed to initialize service: %v", err)
	}

	// Start HTTP server
	if err := service.StartHTTPServer(); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}