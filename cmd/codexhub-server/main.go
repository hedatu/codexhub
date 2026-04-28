package main

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/hedatu/codexhub/internal/codexhub"
)

var version = "dev"

type serverConfig struct {
	Root                  string
	PublicDir             string
	Host                  string
	Port                  int
	PublicURL             string
	AdminToken            string
	ReadonlyToken         string
	InstallKey            string
	DataFile              string
	StorageDriver         string
	SQLiteFile            string
	PushWebhookURL        string
	FCMServiceAccountFile string
	FCMServiceAccountJSON string
	FCMProjectID          string
	FirebaseWebConfig     string
	FirebaseVapidKey      string
	BackupDir             string
	ReleaseManifestURL    string
	SQLiteMinPersist      time.Duration
	OfflineAfter          time.Duration
	CommandTTL            time.Duration
	CommandLease          time.Duration
	FullContextTTL        time.Duration
}

type appState struct {
	startedAt         string
	nodes             map[string]*codexhub.Node
	auditLogs         []codexhub.AuditEntry
	pushSubscriptions []codexhub.PushSubscription
	installKey        string
	clients           map[chan []byte]bool
	agentSummaries    map[string]codexhub.ThreadContextBundle
	agentProposals    map[string]codexhub.AgentProposal
	fullContexts      map[string]codexhub.FullThreadContext
	proposalAudits    []codexhub.ProposalAuditEntry
	mu                sync.RWMutex
}

type persistedState struct {
	SavedAt           string                        `json:"savedAt"`
	SchemaVersion     int                           `json:"schemaVersion,omitempty"`
	StorageDriver     string                        `json:"storageDriver,omitempty"`
	InstallKey        string                        `json:"installKey,omitempty"`
	AuditLogs         []codexhub.AuditEntry         `json:"auditLogs"`
	ProposalAudits    []codexhub.ProposalAuditEntry `json:"proposalAudits,omitempty"`
	PushSubscriptions []codexhub.PushSubscription   `json:"pushSubscriptions,omitempty"`
	Nodes             []codexhub.Node               `json:"nodes"`
}

type server struct {
	cfg                     serverConfig
	state                   *appState
	sqliteMu                sync.Mutex
	sqliteThrottleMu        sync.Mutex
	lastSQLitePersist       time.Time
	fcmMu                   sync.Mutex
	fcmAccessToken          string
	fcmAccessTokenExpiresAt time.Time
}

func main() {
	cfg := loadConfig()
	state := &appState{
		startedAt:      time.Now().UTC().Format(time.RFC3339),
		nodes:          map[string]*codexhub.Node{},
		installKey:     cfg.InstallKey,
		clients:        map[chan []byte]bool{},
		agentSummaries: map[string]codexhub.ThreadContextBundle{},
		agentProposals: map[string]codexhub.AgentProposal{},
		fullContexts:   map[string]codexhub.FullThreadContext{},
	}
	s := &server{cfg: cfg, state: state}
	if err := s.loadState(); err != nil {
		log.Printf("state load warning: %v", err)
	}
	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handle)
	go s.broadcastTicker()
	addr := net.JoinHostPort(cfg.Host, strconv.Itoa(cfg.Port))
	log.Printf("CodexHub Go server %s listening on http://%s", version, addr)
	if cfg.AdminToken == "dev-token" {
		log.Printf("Using default admin token dev-token. Change CODEXHUB_ADMIN_TOKEN before public deployment.")
	}
	if err := http.ListenAndServe(addr, mux); err != nil {
		log.Fatal(err)
	}
}

func loadConfig() serverConfig {
	root := env("CODEXHUB_ROOT", findRoot())
	port, _ := strconv.Atoi(env("CODEXHUB_PORT", env("PORT", "8787")))
	if port == 0 {
		port = 8787
	}
	admin := env("CODEXHUB_ADMIN_TOKEN", env("CODEXHUB_TOKEN", "dev-token"))
	install := env("CODEXHUB_INSTALL_KEY", env("CODEXHUB_TOKEN", admin))
	sqliteFile := os.Getenv("CODEXHUB_SQLITE_FILE")
	if sqliteFile == "" {
		sqliteFile = filepath.Join(root, "data", "codexhub.db")
	}
	return serverConfig{
		Root:                  root,
		PublicDir:             filepath.Join(root, "public"),
		Host:                  env("CODEXHUB_HOST", "0.0.0.0"),
		Port:                  port,
		PublicURL:             stripSlash(os.Getenv("CODEXHUB_PUBLIC_URL")),
		AdminToken:            admin,
		ReadonlyToken:         strings.TrimSpace(os.Getenv("CODEXHUB_READONLY_TOKEN")),
		InstallKey:            install,
		DataFile:              os.Getenv("CODEXHUB_DATA_FILE"),
		StorageDriver:         strings.ToLower(env("CODEXHUB_STORAGE", "json")),
		SQLiteFile:            sqliteFile,
		PushWebhookURL:        strings.TrimSpace(os.Getenv("CODEXHUB_PUSH_WEBHOOK_URL")),
		FCMServiceAccountFile: strings.TrimSpace(os.Getenv("CODEXHUB_FCM_SERVICE_ACCOUNT_FILE")),
		FCMServiceAccountJSON: strings.TrimSpace(os.Getenv("CODEXHUB_FCM_SERVICE_ACCOUNT_JSON")),
		FCMProjectID:          strings.TrimSpace(os.Getenv("CODEXHUB_FCM_PROJECT_ID")),
		FirebaseWebConfig:     strings.TrimSpace(os.Getenv("CODEXHUB_FIREBASE_WEB_CONFIG")),
		FirebaseVapidKey:      strings.TrimSpace(os.Getenv("CODEXHUB_FIREBASE_VAPID_KEY")),
		BackupDir:             env("CODEXHUB_BACKUP_DIR", filepath.Join(root, "backups")),
		ReleaseManifestURL:    strings.TrimSpace(os.Getenv("CODEXHUB_RELEASE_MANIFEST_URL")),
		SQLiteMinPersist:      envDuration("CODEXHUB_SQLITE_MIN_PERSIST_MS", 15*time.Second),
		OfflineAfter:          envDuration("CODEXHUB_OFFLINE_AFTER_MS", 45*time.Second),
		CommandTTL:            envDuration("CODEXHUB_COMMAND_TTL_MS", 10*time.Minute),
		CommandLease:          envDuration("CODEXHUB_COMMAND_LEASE_MS", time.Minute),
		FullContextTTL:        envDuration("CODEXHUB_FULL_CONTEXT_TTL_MS", 30*time.Minute),
	}
}

func findRoot() string {
	if wd, err := os.Getwd(); err == nil {
		if exists(filepath.Join(wd, "public", "index.html")) {
			return wd
		}
	}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		for i := 0; i < 4; i++ {
			if exists(filepath.Join(dir, "public", "index.html")) {
				return dir
			}
			dir = filepath.Dir(dir)
		}
	}
	return "."
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envDuration(key string, fallback time.Duration) time.Duration {
	if v := os.Getenv(key); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return time.Duration(n) * time.Millisecond
		}
	}
	return fallback
}

func envInt(key string, fallback int) int {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return fallback
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return fallback
	}
	return parsed
}

func (s *server) handle(w http.ResponseWriter, r *http.Request) {
	defer func() {
		if recovered := recover(); recovered != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]any{"ok": false, "error": fmt.Sprint(recovered)})
		}
	}()
	if r.Method == http.MethodOptions {
		writeJSON(w, http.StatusNoContent, map[string]any{})
		return
	}
	path := r.URL.Path
	if path == "/api/health" {
		s.state.mu.RLock()
		nodes := len(s.state.nodes)
		subscriptions := 0
		for _, item := range s.state.pushSubscriptions {
			if item.RevokedAt == "" {
				subscriptions++
			}
		}
		s.state.mu.RUnlock()
		writeJSON(w, http.StatusOK, map[string]any{
			"ok":      true,
			"version": env("CODEXHUB_VERSION", version),
			"storage": s.storageStatus(),
			"push": map[string]any{
				"webhookConfigured":     s.cfg.PushWebhookURL != "",
				"fcmConfigured":         s.fcmConfigured(),
				"firebaseWebConfigured": s.cfg.FirebaseWebConfig != "" && s.cfg.FirebaseVapidKey != "",
				"subscriptions":         subscriptions,
			},
			"startedAt":    s.state.startedAt,
			"nodes":        nodes,
			"authRequired": true,
		})
		return
	}
	if path == "/api/events" {
		s.handleEvents(w, r)
		return
	}
	if strings.HasPrefix(path, "/api/") {
		s.handleAPI(w, r)
		return
	}
	s.serveStatic(w, r)
}

func (s *server) handleAPI(w http.ResponseWriter, r *http.Request) {
	switch {
	case r.Method == http.MethodPost && r.URL.Path == "/api/enroll":
		s.handleEnroll(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/api/state":
		if !s.isReadAuthed(r) {
			writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized"))
			return
		}
		writeJSON(w, http.StatusOK, s.dashboardState())
	case r.Method == http.MethodGet && r.URL.Path == "/api/install-profile":
		if !s.isAdminAuthed(r) {
			writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized"))
			return
		}
		writeJSON(w, http.StatusOK, s.installProfile(r))
	case r.Method == http.MethodPost && r.URL.Path == "/api/install-key/rotate":
		s.handleInstallKeyRotate(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/api/audit":
		s.handleAudit(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/api/push/config":
		s.handlePushConfig(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/api/push/register":
		s.handlePushRegister(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/api/push/test":
		s.handlePushTest(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/api/security/status":
		s.handleSecurityStatus(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/api/backups":
		s.handleBackupsList(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/api/backups/create":
		s.handleBackupCreate(w, r)
	case r.Method == http.MethodPost && r.URL.Path == "/api/backups/restore":
		s.handleBackupRestore(w, r)
	case r.Method == http.MethodGet && r.URL.Path == "/api/update/check":
		s.handleUpdateCheck(w, r)
	default:
		s.handleNodeAPI(w, r)
	}
}

func (s *server) handleEnroll(w http.ResponseWriter, r *http.Request) {
	var body map[string]any
	if err := readJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody(err.Error()))
		return
	}
	if !s.isInstallAuthed(r, body) {
		writeJSON(w, http.StatusUnauthorized, errorBody("Invalid install key"))
		return
	}
	nodeID := strings.TrimSpace(stringValue(first(body, "nodeId", "node_id", "name")))
	if nodeID == "" {
		nodeID = "node-" + randomID(8)
	}
	now := nowISO()
	s.state.mu.Lock()
	node := s.getOrCreateNodeLocked(nodeID)
	node.Name = stringValue(first(body, "nodeName", "node_name", "name"))
	if node.Name == "" {
		node.Name = nodeID
	}
	node.Host = body["host"]
	node.Tags = stringSlice(body["tags"])
	node.DeviceKey = createSecret("ck_node")
	node.RevokedAt = ""
	node.EnrolledAt = now
	public := s.publicNodeLocked(node)
	s.recordAuditLocked("node.enrolled", "installer", map[string]any{"nodeId": nodeID, "nodeName": node.Name})
	s.state.mu.Unlock()
	s.persistState()
	s.sendEvent(map[string]any{"type": "nodeEnrolled", "node": public})
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":          true,
		"node":        public,
		"credentials": map[string]any{"nodeId": nodeID, "nodeKey": node.DeviceKey},
	})
}

func (s *server) handleAudit(w http.ResponseWriter, r *http.Request) {
	if !s.isReadAuthed(r) {
		writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized"))
		return
	}
	limit := clamp(intParam(r, "limit", 100), 1, 500)
	s.state.mu.RLock()
	logs := append([]codexhub.AuditEntry(nil), s.state.auditLogs...)
	s.state.mu.RUnlock()
	if len(logs) > limit {
		logs = logs[len(logs)-limit:]
	}
	for i, j := 0, len(logs)-1; i < j; i, j = i+1, j-1 {
		logs[i], logs[j] = logs[j], logs[i]
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "auditLogs": logs})
}

func (s *server) handlePushConfig(w http.ResponseWriter, r *http.Request) {
	if !s.isReadAuthed(r) {
		writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized"))
		return
	}
	var webConfig any
	if s.cfg.FirebaseWebConfig != "" {
		_ = json.Unmarshal([]byte(s.cfg.FirebaseWebConfig), &webConfig)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":                true,
		"fcmConfigured":     s.fcmConfigured(),
		"firebaseWebConfig": webConfig,
		"vapidKey":          nullableString(s.cfg.FirebaseVapidKey),
	})
}

func (s *server) handlePushRegister(w http.ResponseWriter, r *http.Request) {
	if !s.isAdminAuthed(r) {
		writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized"))
		return
	}
	var body map[string]any
	if err := readJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody(err.Error()))
		return
	}
	token := strings.TrimSpace(stringValue(body["token"]))
	if token == "" {
		writeJSON(w, http.StatusBadRequest, errorBody("Missing push token"))
		return
	}
	kind := strings.TrimSpace(stringValue(body["type"]))
	if kind == "" {
		kind = "fcm"
	}
	now := nowISO()
	s.state.mu.Lock()
	found := false
	for i := range s.state.pushSubscriptions {
		item := &s.state.pushSubscriptions[i]
		if item.Type == kind && item.Token == token {
			item.RevokedAt = ""
			item.UpdatedAt = now
			item.Label = body["label"]
			found = true
			break
		}
	}
	if !found {
		s.state.pushSubscriptions = append(s.state.pushSubscriptions, codexhub.PushSubscription{
			ID: uuid(), Type: kind, Token: token, Label: body["label"], CreatedAt: now, UpdatedAt: now,
		})
	}
	if len(s.state.pushSubscriptions) > 200 {
		s.state.pushSubscriptions = s.state.pushSubscriptions[len(s.state.pushSubscriptions)-200:]
	}
	count := 0
	for _, item := range s.state.pushSubscriptions {
		if item.RevokedAt == "" {
			count++
		}
	}
	s.recordAuditLocked("push.registered", "admin", map[string]any{"type": kind, "label": body["label"]})
	s.state.mu.Unlock()
	s.persistState()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "subscriptions": count})
}

func (s *server) handlePushTest(w http.ResponseWriter, r *http.Request) {
	if !s.isAdminAuthed(r) {
		writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized"))
		return
	}
	go s.deliverNotification(map[string]any{
		"type":      "test",
		"title":     "CodexHub 测试通知",
		"preview":   "云端通知通道已触发。",
		"createdAt": nowISO(),
	})
	writeJSON(w, http.StatusAccepted, map[string]any{"ok": true, "queued": true})
}

func (s *server) handleSecurityStatus(w http.ResponseWriter, r *http.Request) {
	if !s.isAdminAuthed(r) {
		writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized"))
		return
	}
	s.state.mu.RLock()
	nodes := len(s.state.nodes)
	revoked := 0
	for _, node := range s.state.nodes {
		if node.RevokedAt != "" {
			revoked++
		}
	}
	subscriptions := 0
	for _, item := range s.state.pushSubscriptions {
		if item.RevokedAt == "" {
			subscriptions++
		}
	}
	auditCount := len(s.state.auditLogs)
	s.state.mu.RUnlock()
	writeJSON(w, http.StatusOK, map[string]any{
		"ok": true,
		"auth": map[string]any{
			"adminTokenConfigured":    s.cfg.AdminToken != "" && s.cfg.AdminToken != "dev-token",
			"readonlyTokenConfigured": s.cfg.ReadonlyToken != "",
			"installKeyConfigured":    s.currentInstallKey() != "",
		},
		"devices": map[string]any{"total": nodes, "revoked": revoked, "active": nodes - revoked},
		"push": map[string]any{
			"webhookConfigured":     s.cfg.PushWebhookURL != "",
			"fcmConfigured":         s.fcmConfigured(),
			"firebaseWebConfigured": s.cfg.FirebaseWebConfig != "" && s.cfg.FirebaseVapidKey != "",
			"subscriptions":         subscriptions,
			"serviceAccountFile":    nullableString(s.cfg.FCMServiceAccountFile),
		},
		"storage":  s.storageStatus(),
		"backups":  map[string]any{"dir": s.cfg.BackupDir},
		"auditLog": map[string]any{"entries": auditCount},
	})
}

func (s *server) handleBackupsList(w http.ResponseWriter, r *http.Request) {
	if !s.isAdminAuthed(r) {
		writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized"))
		return
	}
	backups, err := s.listBackups()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody(err.Error()))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "backupDir": s.cfg.BackupDir, "backups": backups})
}

func (s *server) handleBackupCreate(w http.ResponseWriter, r *http.Request) {
	if !s.isAdminAuthed(r) {
		writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized"))
		return
	}
	backup, err := s.createBackup("manual")
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody(err.Error()))
		return
	}
	s.state.mu.Lock()
	s.recordAuditLocked("backup.created", "admin", map[string]any{"name": backup["name"], "size": backup["size"]})
	s.state.mu.Unlock()
	s.persistState()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "backup": backup})
}

func (s *server) handleBackupRestore(w http.ResponseWriter, r *http.Request) {
	if !s.isAdminAuthed(r) {
		writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized"))
		return
	}
	var body map[string]any
	_ = readJSON(r, &body)
	name := filepath.Base(strings.TrimSpace(stringValue(body["name"])))
	if name == "." || name == "" || !strings.HasPrefix(name, "codexhub-backup-") || !strings.HasSuffix(name, ".tar.gz") {
		writeJSON(w, http.StatusBadRequest, errorBody("Invalid backup name"))
		return
	}
	if _, err := s.createBackup("pre-restore"); err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody("Pre-restore backup failed: "+err.Error()))
		return
	}
	if err := s.restoreBackup(name); err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody(err.Error()))
		return
	}
	if err := s.loadState(); err != nil {
		writeJSON(w, http.StatusInternalServerError, errorBody("Backup restored but state reload failed: "+err.Error()))
		return
	}
	s.state.mu.Lock()
	s.recordAuditLocked("backup.restored", "admin", map[string]any{"name": name})
	s.state.mu.Unlock()
	s.persistState()
	s.sendEvent(map[string]any{"type": "state", "state": s.dashboardState()})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "restored": name})
}

func (s *server) handleUpdateCheck(w http.ResponseWriter, r *http.Request) {
	if !s.isReadAuthed(r) {
		writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized"))
		return
	}
	current := env("CODEXHUB_VERSION", version)
	if current == "" || current == "dev" {
		current = "0.4.9"
	}
	latestVersion, assets, source, err := s.fetchLatestRelease()
	if err != nil {
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "currentVersion": current, "updateAvailable": false, "error": err.Error()})
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"ok":              true,
		"currentVersion":  current,
		"latestVersion":   latestVersion,
		"updateAvailable": compareVersions(latestVersion, current) > 0,
		"source":          source,
		"assets":          assets,
	})
}

func (s *server) notificationPayload(nodeID string, publicNode map[string]any, notice codexhub.Notification) map[string]any {
	nodeName := stringValue(publicNode["name"])
	if nodeName == "" {
		nodeName = nodeID
	}
	return map[string]any{
		"id":              notice.ID,
		"type":            notice.Type,
		"title":           notice.Title,
		"preview":         notice.Preview,
		"createdAt":       notice.CreatedAt,
		"threadId":        notice.ThreadID,
		"threadUpdatedAt": notice.ThreadUpdatedAt,
		"nodeId":          nodeID,
		"nodeName":        nodeName,
	}
}

func (s *server) deliverNotification(notification map[string]any) {
	payload := map[string]any{"version": env("CODEXHUB_VERSION", version), "sentAt": nowISO(), "notification": notification}
	results := []map[string]any{}
	if s.cfg.PushWebhookURL != "" {
		results = append(results, s.postJSONExternal(s.cfg.PushWebhookURL, payload, nil))
	}
	tokens := s.activeFCMTokens()
	if s.fcmConfigured() && len(tokens) > 0 {
		for i, token := range tokens {
			if i >= 500 {
				break
			}
			results = append(results, s.sendFCMMessage(token, notification))
		}
	}
	if len(results) == 0 {
		return
	}
	s.state.mu.Lock()
	s.recordAuditLocked("push.delivered", "system", map[string]any{
		"type":     notification["type"],
		"nodeId":   notification["nodeId"],
		"threadId": notification["threadId"],
		"results":  results,
	})
	s.state.mu.Unlock()
	s.persistState()
}

func (s *server) activeFCMTokens() []string {
	s.state.mu.RLock()
	defer s.state.mu.RUnlock()
	tokens := []string{}
	for _, item := range s.state.pushSubscriptions {
		if item.Type == "fcm" && item.Token != "" && item.RevokedAt == "" {
			tokens = append(tokens, item.Token)
		}
	}
	return tokens
}

func (s *server) postJSONExternal(target string, payload any, headers map[string]string) map[string]any {
	data, _ := json.Marshal(payload)
	req, err := http.NewRequest(http.MethodPost, target, bytes.NewReader(data))
	if err != nil {
		return map[string]any{"provider": "webhook", "ok": false, "error": err.Error()}
	}
	req.Header.Set("content-type", "application/json")
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	client := &http.Client{Timeout: 8 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return map[string]any{"provider": "webhook", "ok": false, "error": err.Error()}
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	return map[string]any{"provider": "webhook", "ok": resp.StatusCode >= 200 && resp.StatusCode < 300, "status": resp.StatusCode, "text": string(body)}
}

type fcmServiceAccount struct {
	ProjectID   string `json:"project_id"`
	ClientEmail string `json:"client_email"`
	PrivateKey  string `json:"private_key"`
	TokenURI    string `json:"token_uri"`
}

func (s *server) loadFCMServiceAccount() (*fcmServiceAccount, error) {
	raw := s.cfg.FCMServiceAccountJSON
	if raw == "" && s.cfg.FCMServiceAccountFile != "" {
		data, err := os.ReadFile(s.cfg.FCMServiceAccountFile)
		if err != nil {
			return nil, err
		}
		raw = string(data)
	}
	if strings.TrimSpace(raw) == "" {
		return nil, fmt.Errorf("FCM service account is not configured")
	}
	var account fcmServiceAccount
	if err := json.Unmarshal([]byte(raw), &account); err != nil {
		return nil, err
	}
	if account.ClientEmail == "" || account.PrivateKey == "" {
		return nil, fmt.Errorf("FCM service account is missing client_email or private_key")
	}
	return &account, nil
}

func (s *server) fcmProjectID(account *fcmServiceAccount) string {
	if s.cfg.FCMProjectID != "" {
		return s.cfg.FCMProjectID
	}
	if account != nil {
		return account.ProjectID
	}
	return ""
}

func (s *server) fcmConfigured() bool {
	account, err := s.loadFCMServiceAccount()
	return err == nil && s.fcmProjectID(account) != ""
}

func (s *server) getFCMAccessToken() (string, error) {
	s.fcmMu.Lock()
	defer s.fcmMu.Unlock()
	if s.fcmAccessToken != "" && time.Now().Before(s.fcmAccessTokenExpiresAt.Add(-time.Minute)) {
		return s.fcmAccessToken, nil
	}
	account, err := s.loadFCMServiceAccount()
	if err != nil {
		return "", err
	}
	tokenURI := account.TokenURI
	if tokenURI == "" {
		tokenURI = "https://oauth2.googleapis.com/token"
	}
	now := time.Now().Unix()
	header := base64URLJSON(map[string]any{"alg": "RS256", "typ": "JWT"})
	claims := base64URLJSON(map[string]any{
		"iss":   account.ClientEmail,
		"scope": "https://www.googleapis.com/auth/firebase.messaging",
		"aud":   tokenURI,
		"iat":   now,
		"exp":   now + 3600,
	})
	unsigned := header + "." + claims
	key, err := parseRSAPrivateKey(account.PrivateKey)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256([]byte(unsigned))
	sig, err := rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, sum[:])
	if err != nil {
		return "", err
	}
	assertion := unsigned + "." + base64.RawURLEncoding.EncodeToString(sig)
	form := url.Values{}
	form.Set("grant_type", "urn:ietf:params:oauth:grant-type:jwt-bearer")
	form.Set("assertion", assertion)
	req, err := http.NewRequest(http.MethodPost, tokenURI, strings.NewReader(form.Encode()))
	if err != nil {
		return "", err
	}
	req.Header.Set("content-type", "application/x-www-form-urlencoded")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	var payload map[string]any
	_ = json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&payload)
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", fmt.Errorf("FCM OAuth failed: %s", stringValue(first(payload, "error_description", "error")))
	}
	token := stringValue(payload["access_token"])
	if token == "" {
		return "", fmt.Errorf("FCM OAuth returned no access_token")
	}
	expires := intNumber(payload["expires_in"])
	if expires <= 0 {
		expires = 3600
	}
	s.fcmAccessToken = token
	s.fcmAccessTokenExpiresAt = time.Now().Add(time.Duration(expires) * time.Second)
	return token, nil
}

func (s *server) sendFCMMessage(token string, notification map[string]any) map[string]any {
	account, err := s.loadFCMServiceAccount()
	if err != nil {
		return map[string]any{"provider": "fcm", "ok": false, "error": err.Error()}
	}
	projectID := s.fcmProjectID(account)
	if projectID == "" {
		return map[string]any{"provider": "fcm", "ok": false, "error": "FCM project id is missing"}
	}
	accessToken, err := s.getFCMAccessToken()
	if err != nil {
		return map[string]any{"provider": "fcm", "ok": false, "error": err.Error()}
	}
	message := map[string]any{
		"token": token,
		"notification": map[string]string{
			"title": firstNonEmptyString(stringValue(notification["title"]), "CodexHub"),
			"body":  firstNonEmptyString(stringValue(notification["preview"]), "有新的待处理事项"),
		},
		"data": map[string]string{
			"nodeId":   stringValue(notification["nodeId"]),
			"threadId": stringValue(notification["threadId"]),
			"type":     firstNonEmptyString(stringValue(notification["type"]), "notification"),
			"url":      "/",
		},
	}
	if s.cfg.PublicURL != "" {
		message["webpush"] = map[string]any{"fcm_options": map[string]string{"link": s.cfg.PublicURL}}
	}
	body := map[string]any{"message": message}
	target := fmt.Sprintf("https://fcm.googleapis.com/v1/projects/%s/messages:send", projectID)
	data, _ := json.Marshal(body)
	req, err := http.NewRequest(http.MethodPost, target, bytes.NewReader(data))
	if err != nil {
		return map[string]any{"provider": "fcm", "ok": false, "error": err.Error()}
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("authorization", "Bearer "+accessToken)
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return map[string]any{"provider": "fcm", "ok": false, "error": err.Error()}
	}
	defer resp.Body.Close()
	responseBody, _ := io.ReadAll(io.LimitReader(resp.Body, 64*1024))
	return map[string]any{"provider": "fcm", "ok": resp.StatusCode >= 200 && resp.StatusCode < 300, "status": resp.StatusCode, "text": string(responseBody)}
}

func base64URLJSON(value any) string {
	data, _ := json.Marshal(value)
	return base64.RawURLEncoding.EncodeToString(data)
}

func parseRSAPrivateKey(pemText string) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(pemText))
	if block == nil {
		return nil, fmt.Errorf("invalid PEM private key")
	}
	if key, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		if rsaKey, ok := key.(*rsa.PrivateKey); ok {
			return rsaKey, nil
		}
	}
	return x509.ParsePKCS1PrivateKey(block.Bytes)
}

func (s *server) handleInstallKeyRotate(w http.ResponseWriter, r *http.Request) {
	if !s.isAdminAuthed(r) {
		writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized"))
		return
	}
	key := createSecret("ck_install")
	s.state.mu.Lock()
	s.state.installKey = key
	s.recordAuditLocked("install_key.rotated", "admin", map[string]any{})
	s.state.mu.Unlock()
	s.persistState()
	s.sendEvent(map[string]any{"type": "state", "state": s.dashboardState()})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "installKey": key, "installProfile": s.installProfile(r)})
}

func (s *server) handleNodeAPI(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.Trim(r.URL.Path, "/"), "/")
	if len(parts) < 3 || parts[0] != "api" || parts[1] != "nodes" {
		writeJSON(w, http.StatusNotFound, errorBody("Not found"))
		return
	}
	nodeID := parts[2]

	if r.Method == http.MethodGet && len(parts) == 3 {
		if !s.isReadAuthed(r) {
			writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized"))
			return
		}
		s.state.mu.RLock()
		node := s.state.nodes[nodeID]
		if node == nil {
			s.state.mu.RUnlock()
			writeJSON(w, http.StatusNotFound, errorBody("Node not found"))
			return
		}
		public := s.publicNodeLocked(node)
		s.state.mu.RUnlock()
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "node": public})
		return
	}
	if len(parts) < 4 {
		writeJSON(w, http.StatusNotFound, errorBody("Not found"))
		return
	}
	action := parts[3]
	switch {
	case r.Method == http.MethodPost && action == "update":
		s.handleNodeUpdate(w, r, nodeID)
	case r.Method == http.MethodPost && action == "revoke":
		s.handleNodeRevoke(w, r, nodeID)
	case r.Method == http.MethodPost && action == "rotate-key":
		s.handleRotateKey(w, r, nodeID)
	case r.Method == http.MethodGet && action == "self":
		s.handleNodeSelf(w, r, nodeID)
	case r.Method == http.MethodPost && action == "heartbeat":
		s.handleHeartbeat(w, r, nodeID)
	case r.Method == http.MethodPost && action == "actions":
		s.handleQueueAction(w, r, nodeID)
	case r.Method == http.MethodPost && action == "threads" && len(parts) >= 6 && parts[5] == "agent-draft":
		s.handleAgentDraft(w, r, nodeID, parts[4])
	case r.Method == http.MethodGet && action == "threads" && len(parts) >= 6 && parts[5] == "context-bundle":
		s.handleThreadContextBundle(w, r, nodeID, parts[4])
	case r.Method == http.MethodPost && action == "threads" && len(parts) >= 6 && parts[5] == "context-request":
		s.handleThreadContextRequest(w, r, nodeID, parts[4])
	case r.Method == http.MethodPost && action == "threads" && len(parts) >= 6 && parts[5] == "context-clear":
		s.handleThreadContextClear(w, r, nodeID, parts[4])
	case r.Method == http.MethodGet && action == "threads" && len(parts) >= 6 && parts[5] == "proposals":
		s.handleThreadProposals(w, r, nodeID, parts[4])
	case r.Method == http.MethodPost && action == "notifications" && len(parts) >= 5 && parts[4] == "read":
		s.handleNotificationsRead(w, r, nodeID)
	case r.Method == http.MethodGet && action == "commands" && len(parts) >= 5 && parts[4] == "poll":
		s.handlePoll(w, r, nodeID)
	case r.Method == http.MethodPost && action == "commands" && len(parts) >= 6 && parts[5] == "result":
		s.handleCommandResult(w, r, nodeID, parts[4])
	default:
		writeJSON(w, http.StatusNotFound, errorBody("Not found"))
	}
}

func (s *server) handleNodeSelf(w http.ResponseWriter, r *http.Request, nodeID string) {
	s.state.mu.RLock()
	node := s.state.nodes[nodeID]
	authed := s.isNodeAuthedLocked(node, r)
	var public map[string]any
	if authed {
		public = s.publicNodeLocked(node)
	}
	s.state.mu.RUnlock()
	if !authed {
		writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized node"))
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "node": public})
}

func (s *server) handleNodeUpdate(w http.ResponseWriter, r *http.Request, nodeID string) {
	if !s.isAdminAuthed(r) {
		writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized"))
		return
	}
	var body map[string]any
	_ = readJSON(r, &body)
	s.state.mu.Lock()
	node := s.getOrCreateNodeLocked(nodeID)
	if name := strings.TrimSpace(stringValue(body["name"])); name != "" {
		node.Name = name
	}
	if tags, ok := body["tags"]; ok {
		node.Tags = stringSlice(tags)
	}
	public := s.publicNodeLocked(node)
	s.recordAuditLocked("node.updated", "admin", map[string]any{"nodeId": nodeID, "name": node.Name, "tags": node.Tags})
	s.state.mu.Unlock()
	s.persistState()
	s.sendEvent(map[string]any{"type": "state", "state": s.dashboardState()})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "node": public})
}

func (s *server) handleNodeRevoke(w http.ResponseWriter, r *http.Request, nodeID string) {
	if !s.isAdminAuthed(r) {
		writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized"))
		return
	}
	s.state.mu.Lock()
	node := s.getOrCreateNodeLocked(nodeID)
	node.RevokedAt = nowISO()
	node.DeviceKey = ""
	node.Commands = nil
	public := s.publicNodeLocked(node)
	s.recordAuditLocked("node.revoked", "admin", map[string]any{"nodeId": nodeID})
	s.state.mu.Unlock()
	s.persistState()
	s.sendEvent(map[string]any{"type": "state", "state": s.dashboardState()})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "node": public})
}

func (s *server) handleRotateKey(w http.ResponseWriter, r *http.Request, nodeID string) {
	if !s.isAdminAuthed(r) {
		writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized"))
		return
	}
	s.state.mu.Lock()
	node := s.getOrCreateNodeLocked(nodeID)
	node.DeviceKey = createSecret("ck_node")
	node.RevokedAt = ""
	public := s.publicNodeLocked(node)
	key := node.DeviceKey
	s.recordAuditLocked("node.key_rotated", "admin", map[string]any{"nodeId": nodeID})
	s.state.mu.Unlock()
	s.persistState()
	s.sendEvent(map[string]any{"type": "state", "state": s.dashboardState()})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "node": public, "credentials": map[string]any{"nodeId": nodeID, "nodeKey": key}})
}

func (s *server) handleHeartbeat(w http.ResponseWriter, r *http.Request, nodeID string) {
	s.state.mu.RLock()
	node := s.state.nodes[nodeID]
	authed := s.isNodeAuthedLocked(node, r)
	s.state.mu.RUnlock()
	if !authed {
		writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized node"))
		return
	}
	var body map[string]any
	if err := readJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody(err.Error()))
		return
	}
	s.state.mu.Lock()
	node = s.getOrCreateNodeLocked(nodeID)
	if name := stringValue(body["name"]); name != "" {
		node.Name = name
	}
	if tags, ok := body["tags"]; ok {
		node.Tags = stringSlice(tags)
	}
	node.Version = body["version"]
	node.HeartbeatSeq = body["heartbeatSeq"]
	node.CollectedAt = body["collectedAt"]
	node.AgentStartedAt = body["agentStartedAt"]
	node.Update = body["update"]
	node.Host = body["host"]
	previousLastSeenAt := node.LastSeenAt
	node.LastSeenAt = nowISO()
	node.Farfield = body["farfield"]
	node.Metrics = mapValue(body["metrics"])
	nextThreads := normalizeThreads(body["threads"])
	newNotifications := updateThreadNotificationsLocked(node, node.Threads, nextThreads, previousLastSeenAt)
	node.Threads = nextThreads
	node.LastError = body["lastError"]
	s.cleanupCommandsLocked(node)
	queued := 0
	for _, c := range node.Commands {
		if c.Status == "queued" {
			queued++
		}
	}
	public := s.publicNodeLocked(node)
	s.state.mu.Unlock()
	s.persistState()
	s.sendEvent(map[string]any{"type": "state", "state": s.dashboardState()})
	for _, notice := range newNotifications {
		go s.deliverNotification(s.notificationPayload(nodeID, public, notice))
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "node": public, "queuedCommands": queued})
}

func (s *server) handleNotificationsRead(w http.ResponseWriter, r *http.Request, nodeID string) {
	if !s.isAdminAuthed(r) {
		writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized"))
		return
	}
	var body map[string]any
	_ = readJSON(r, &body)
	markAll := boolValue(body["all"])
	threadID := stringValue(body["threadId"])
	notificationID := stringValue(body["notificationId"])
	now := nowISO()
	s.state.mu.Lock()
	node := s.getOrCreateNodeLocked(nodeID)
	unread := 0
	for i := range node.Notifications {
		notice := &node.Notifications[i]
		if notice.ReadAt == "" && (markAll || (threadID != "" && notice.ThreadID == threadID) || (notificationID != "" && notice.ID == notificationID)) {
			notice.ReadAt = now
		}
		if notice.ReadAt == "" {
			unread++
		}
	}
	s.state.mu.Unlock()
	s.persistState()
	s.sendEvent(map[string]any{"type": "state", "state": s.dashboardState()})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "unread": unread})
}

func (s *server) handleQueueAction(w http.ResponseWriter, r *http.Request, nodeID string) {
	if !s.isAdminAuthed(r) {
		writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized"))
		return
	}
	var action map[string]any
	if err := readJSON(r, &action); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody(err.Error()))
		return
	}
	kind := stringValue(action["kind"])
	if !map[string]bool{"sendMessage": true, "interrupt": true, "submitUserInput": true, "refresh": true, "selfUpdate": true}[kind] {
		writeJSON(w, http.StatusBadRequest, errorBody("Unsupported action kind: "+kind))
		return
	}
	command := codexhub.Command{ID: uuid(), Status: "queued", CreatedAt: nowISO(), Action: action}
	s.state.mu.Lock()
	node := s.getOrCreateNodeLocked(nodeID)
	node.Commands = append(node.Commands, command)
	s.cleanupCommandsLocked(node)
	if proposalID := stringValue(action["proposalId"]); proposalID != "" {
		proposal := s.state.agentProposals[proposalID]
		if proposal.ProposalID == "" {
			proposal = codexhub.AgentProposal{
				ProposalID:       proposalID,
				ThreadID:         stringValue(action["threadId"]),
				NodeID:           nodeID,
				Risk:             stringValue(action["proposalRisk"]),
				ContextSignature: stringValue(action["proposalContextSignature"]),
			}
		}
		decision := firstNonEmptyString(stringValue(action["proposalDecision"]), "queued")
		s.recordProposalAuditLocked(decision, "admin", nodeID, stringValue(action["threadId"]), proposal, command.ID, decision)
	}
	s.recordAuditLocked("command.queued", "admin", map[string]any{"nodeId": nodeID, "commandId": command.ID, "kind": kind, "threadId": action["threadId"]})
	s.state.mu.Unlock()
	s.persistState()
	s.sendEvent(map[string]any{"type": "commandQueued", "nodeId": nodeID, "command": command})
	writeJSON(w, http.StatusAccepted, map[string]any{"ok": true, "command": command})
}

func (s *server) handleAgentDraft(w http.ResponseWriter, r *http.Request, nodeID string, encodedThreadID string) {
	if !s.isAdminAuthed(r) {
		writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized"))
		return
	}
	threadID, err := url.PathUnescape(encodedThreadID)
	if err != nil {
		threadID = encodedThreadID
	}
	var body map[string]any
	if err := readJSON(r, &body); err != nil {
		writeJSON(w, http.StatusBadRequest, errorBody(err.Error()))
		return
	}
	s.state.mu.Lock()
	node := s.state.nodes[nodeID]
	if node == nil {
		s.state.mu.Unlock()
		writeJSON(w, http.StatusNotFound, errorBody("Node not found"))
		return
	}
	thread, ok := findThread(node.Threads, threadID)
	if !ok {
		s.state.mu.Unlock()
		writeJSON(w, http.StatusNotFound, errorBody("Thread not found"))
		return
	}
	contextBundle := s.buildThreadContextBundleLocked(node, thread)
	proposal := buildAgentProposal(contextBundle, body)
	s.state.agentProposals[proposal.ProposalID] = proposal
	s.recordProposalAuditLocked("created", "admin", nodeID, threadID, proposal, "", "")
	if len(s.state.agentProposals) > 200 {
		for key := range s.state.agentProposals {
			delete(s.state.agentProposals, key)
			break
		}
	}
	s.recordAuditLocked("agent.proposal.created", "admin", map[string]any{
		"nodeId":           nodeID,
		"threadId":         threadID,
		"proposalId":       proposal.ProposalID,
		"risk":             proposal.Risk,
		"contextSignature": contextBundle.ContextSignature,
	})
	s.state.mu.Unlock()
	s.persistState()
	s.sendEvent(map[string]any{"type": "agentProposalCreated", "nodeId": nodeID, "threadId": threadID, "proposal": proposal, "contextBundle": contextBundle})
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "proposal": proposal, "contextBundle": contextBundle})
}

func (s *server) handleThreadContextBundle(w http.ResponseWriter, r *http.Request, nodeID string, encodedThreadID string) {
	mode := strings.ToLower(firstNonEmptyString(r.URL.Query().Get("mode"), "compressed"))
	actor := "readonly"
	if mode == "full" {
		if !s.isAdminAuthed(r) {
			writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized"))
			return
		}
		actor = "admin"
	} else if !s.isReadAuthed(r) {
		writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized"))
		return
	} else if s.isAdminAuthed(r) {
		actor = "admin"
	}
	threadID := decodedPathPart(encodedThreadID)
	s.state.mu.Lock()
	node := s.state.nodes[nodeID]
	if node == nil {
		s.state.mu.Unlock()
		writeJSON(w, http.StatusNotFound, errorBody("Node not found"))
		return
	}
	thread, ok := findThread(node.Threads, threadID)
	if !ok {
		s.state.mu.Unlock()
		writeJSON(w, http.StatusNotFound, errorBody("Thread not found"))
		return
	}
	contextBundle := s.buildThreadContextBundleLocked(node, thread)
	if mode != "full" {
		s.recordAuditLocked("thread.context.read", actor, map[string]any{"nodeId": nodeID, "threadId": threadID, "mode": "compressed", "contextSignature": contextBundle.ContextSignature})
		s.state.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "mode": "compressed", "status": "ready", "contextBundle": contextBundle})
		return
	}
	fullContext, ready := s.state.fullContexts[contextKey(nodeID, threadID)]
	if ready {
		if fullContextExpired(fullContext) {
			delete(s.state.fullContexts, contextKey(nodeID, threadID))
			s.recordAuditLocked("thread.context.expired", "admin", map[string]any{"nodeId": nodeID, "threadId": threadID, "mode": "full", "contextSignature": fullContext.ContextSignature})
			s.state.mu.Unlock()
			writeJSON(w, http.StatusAccepted, map[string]any{"ok": true, "mode": "full", "status": "expired", "contextBundle": contextBundle, "message": "Full context cache expired. POST context-request again."})
			return
		}
		s.recordAuditLocked("thread.context.read", "admin", map[string]any{"nodeId": nodeID, "threadId": threadID, "mode": "full", "contextSignature": fullContext.ContextSignature})
		s.state.mu.Unlock()
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "mode": "full", "status": "ready", "contextBundle": contextBundle, "fullContext": fullContext})
		return
	}
	s.recordAuditLocked("thread.context.read.miss", "admin", map[string]any{"nodeId": nodeID, "threadId": threadID, "mode": "full"})
	s.state.mu.Unlock()
	writeJSON(w, http.StatusAccepted, map[string]any{"ok": true, "mode": "full", "status": "not_ready", "contextBundle": contextBundle, "message": "Full context has not been collected. POST context-request first."})
}

func (s *server) handleThreadContextRequest(w http.ResponseWriter, r *http.Request, nodeID string, encodedThreadID string) {
	if !s.isAdminAuthed(r) {
		writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized"))
		return
	}
	threadID := decodedPathPart(encodedThreadID)
	var body map[string]any
	_ = readJSON(r, &body)
	maxMessages := clamp(intFromAny(firstNonZero(body["maxMessages"], body["limit"]), 200), 1, 2000)
	maxChars := clamp(intFromAny(body["maxChars"], 240000), 1000, 2_000_000)
	s.state.mu.Lock()
	node := s.state.nodes[nodeID]
	if node == nil {
		s.state.mu.Unlock()
		writeJSON(w, http.StatusNotFound, errorBody("Node not found"))
		return
	}
	thread, ok := findThread(node.Threads, threadID)
	if !ok {
		s.state.mu.Unlock()
		writeJSON(w, http.StatusNotFound, errorBody("Thread not found"))
		return
	}
	contextBundle := s.buildThreadContextBundleLocked(node, thread)
	s.cleanupCommandsLocked(node)
	for _, command := range node.Commands {
		if (command.Status == "queued" || command.Status == "leased") && stringValue(command.Action["kind"]) == "readThreadContext" && stringValue(command.Action["threadId"]) == threadID {
			s.recordAuditLocked("thread.context.requested.duplicate", "admin", map[string]any{"nodeId": nodeID, "threadId": threadID, "commandId": command.ID, "mode": "full", "contextSignature": contextBundle.ContextSignature})
			s.state.mu.Unlock()
			s.persistState()
			writeJSON(w, http.StatusAccepted, map[string]any{"ok": true, "mode": "full", "status": "queued", "deduped": true, "command": command, "contextBundle": contextBundle})
			return
		}
	}
	action := map[string]any{
		"kind":        "readThreadContext",
		"provider":    firstNonEmptyString(thread.Provider, "codex"),
		"threadId":    threadID,
		"mode":        "full",
		"maxMessages": maxMessages,
		"maxChars":    maxChars,
		"redact":      true,
	}
	command := codexhub.Command{ID: uuid(), Status: "queued", CreatedAt: nowISO(), Action: action}
	node.Commands = append(node.Commands, command)
	s.recordAuditLocked("thread.context.requested", "admin", map[string]any{"nodeId": nodeID, "threadId": threadID, "commandId": command.ID, "mode": "full", "maxMessages": maxMessages, "maxChars": maxChars, "contextSignature": contextBundle.ContextSignature})
	s.state.mu.Unlock()
	s.persistState()
	s.sendEvent(map[string]any{"type": "commandQueued", "nodeId": nodeID, "command": command})
	writeJSON(w, http.StatusAccepted, map[string]any{"ok": true, "mode": "full", "status": "queued", "command": command, "contextBundle": contextBundle})
}

func (s *server) handleThreadContextClear(w http.ResponseWriter, r *http.Request, nodeID string, encodedThreadID string) {
	if !s.isAdminAuthed(r) {
		writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized"))
		return
	}
	threadID := decodedPathPart(encodedThreadID)
	s.state.mu.Lock()
	_, existed := s.state.fullContexts[contextKey(nodeID, threadID)]
	delete(s.state.fullContexts, contextKey(nodeID, threadID))
	s.recordAuditLocked("thread.context.cleared", "admin", map[string]any{"nodeId": nodeID, "threadId": threadID, "mode": "full", "existed": existed})
	s.state.mu.Unlock()
	s.persistState()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "mode": "full", "status": "cleared", "existed": existed})
}

func (s *server) handleThreadProposals(w http.ResponseWriter, r *http.Request, nodeID string, encodedThreadID string) {
	if !s.isAdminAuthed(r) {
		writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized"))
		return
	}
	threadID := decodedPathPart(encodedThreadID)
	limit := clamp(intParam(r, "limit", 50), 1, 200)
	offset := clamp(intParam(r, "offset", 0), 0, 10000)
	eventFilter := strings.TrimSpace(r.URL.Query().Get("event"))
	decisionFilter := strings.TrimSpace(r.URL.Query().Get("decision"))
	proposalIDFilter := strings.TrimSpace(r.URL.Query().Get("proposalId"))
	s.state.mu.RLock()
	audits := []codexhub.ProposalAuditEntry{}
	for i := len(s.state.proposalAudits) - 1; i >= 0; i-- {
		entry := s.state.proposalAudits[i]
		if entry.NodeID == nodeID && entry.ThreadID == threadID &&
			(eventFilter == "" || entry.Event == eventFilter) &&
			(decisionFilter == "" || entry.Decision == decisionFilter) &&
			(proposalIDFilter == "" || entry.ProposalID == proposalIDFilter) {
			audits = append(audits, entry)
		}
	}
	totalAudits := len(audits)
	if offset > len(audits) {
		audits = []codexhub.ProposalAuditEntry{}
	} else {
		end := offset + limit
		if end > len(audits) {
			end = len(audits)
		}
		audits = audits[offset:end]
	}
	proposals := []codexhub.AgentProposal{}
	for _, proposal := range s.state.agentProposals {
		if proposal.NodeID == nodeID && proposal.ThreadID == threadID && (proposalIDFilter == "" || proposal.ProposalID == proposalIDFilter) {
			proposals = append(proposals, proposal)
		}
	}
	s.state.mu.RUnlock()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "nodeId": nodeID, "threadId": threadID, "proposals": proposals, "audits": audits, "totalAudits": totalAudits, "limit": limit, "offset": offset})
}

func (s *server) handlePoll(w http.ResponseWriter, r *http.Request, nodeID string) {
	s.state.mu.Lock()
	node := s.state.nodes[nodeID]
	if !s.isNodeAuthedLocked(node, r) {
		s.state.mu.Unlock()
		writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized node"))
		return
	}
	s.cleanupCommandsLocked(node)
	limit := clamp(intParam(r, "limit", 5), 1, 20)
	commands := []codexhub.Command{}
	for i := range node.Commands {
		if node.Commands[i].Status == "queued" && len(commands) < limit {
			node.Commands[i].Status = "leased"
			node.Commands[i].LeasedAt = nowISO()
			commands = append(commands, node.Commands[i])
		}
	}
	s.state.mu.Unlock()
	s.persistState()
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "commands": commands})
}

func (s *server) handleCommandResult(w http.ResponseWriter, r *http.Request, nodeID, commandID string) {
	var body map[string]any
	_ = readJSON(r, &body)
	s.state.mu.Lock()
	node := s.state.nodes[nodeID]
	if !s.isNodeAuthedLocked(node, r) {
		s.state.mu.Unlock()
		writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized node"))
		return
	}
	for i := range node.Commands {
		if node.Commands[i].ID == commandID {
			if boolValue(body["ok"]) {
				node.Commands[i].Status = "done"
			} else {
				node.Commands[i].Status = "failed"
			}
			node.Commands[i].CompletedAt = nowISO()
			node.Commands[i].Result = body
			cmd := node.Commands[i]
			var newNotice codexhub.Notification
			notify := false
			if stringValue(cmd.Action["kind"]) == "readThreadContext" {
				if cmd.Status == "done" {
					if fullContext, ok := fullContextFromCommandResult(nodeID, stringValue(cmd.Action["threadId"]), body); ok {
						fullContext.CachedAt = nowISO()
						if s.cfg.FullContextTTL > 0 {
							fullContext.ExpiresAt = time.Now().UTC().Add(s.cfg.FullContextTTL).Format(time.RFC3339)
						}
						s.state.fullContexts[contextKey(nodeID, fullContext.ThreadID)] = fullContext
						s.recordAuditLocked("thread.context.ready", "node", map[string]any{"nodeId": nodeID, "threadId": fullContext.ThreadID, "commandId": commandID, "messageCount": fullContext.MessageCount, "truncated": fullContext.Truncated, "redacted": fullContext.Redacted, "contextSignature": fullContext.ContextSignature})
					}
				} else {
					s.recordAuditLocked("thread.context.failed", "node", map[string]any{"nodeId": nodeID, "threadId": stringValue(cmd.Action["threadId"]), "commandId": commandID, "error": stringValue(body["error"])})
				}
			}
			if cmd.Status == "failed" && stringValue(cmd.Action["threadId"]) != "" {
				newNotice, notify = addNodeNotificationLocked(node, codexhub.Notification{
					Type:            "commandFailed",
					ThreadID:        stringValue(cmd.Action["threadId"]),
					ThreadUpdatedAt: cmd.CompletedAt,
					Title:           "手机指令发送失败",
					Preview:         firstNonEmptyString(stringValue(body["error"]), stringValue(mapValue(body["result"])["error"]), "桌面端执行手机指令失败，请检查本机状态。"),
				})
			}
			public := s.publicNodeLocked(node)
			s.recordAuditLocked("command.completed", "node", map[string]any{"nodeId": nodeID, "commandId": commandID, "status": cmd.Status})
			s.state.mu.Unlock()
			s.persistState()
			s.sendEvent(map[string]any{"type": "state", "state": s.dashboardState()})
			s.sendEvent(map[string]any{"type": "commandResult", "nodeId": nodeID, "command": cmd})
			if notify {
				go s.deliverNotification(s.notificationPayload(nodeID, public, newNotice))
			}
			writeJSON(w, http.StatusOK, map[string]any{"ok": true, "command": cmd})
			return
		}
	}
	s.state.mu.Unlock()
	writeJSON(w, http.StatusNotFound, errorBody("Command not found"))
}

func (s *server) handleEvents(w http.ResponseWriter, r *http.Request) {
	if !s.isReadAuthed(r) {
		writeJSON(w, http.StatusUnauthorized, errorBody("Unauthorized"))
		return
	}
	flusher, ok := w.(http.Flusher)
	if !ok {
		writeJSON(w, http.StatusInternalServerError, errorBody("Streaming unsupported"))
		return
	}
	ch := make(chan []byte, 8)
	s.state.mu.Lock()
	s.state.clients[ch] = true
	s.state.mu.Unlock()
	defer func() {
		s.state.mu.Lock()
		delete(s.state.clients, ch)
		s.state.mu.Unlock()
		close(ch)
	}()
	w.Header().Set("content-type", "text/event-stream")
	w.Header().Set("cache-control", "no-cache")
	w.Header().Set("connection", "keep-alive")
	w.Header().Set("x-accel-buffering", "no")
	w.Header().Set("access-control-allow-origin", "*")
	fmt.Fprint(w, "retry: 2000\n\n")
	writeSSE(w, map[string]any{"type": "state", "state": s.dashboardState()})
	flusher.Flush()
	for {
		select {
		case payload := <-ch:
			_, _ = w.Write(payload)
			flusher.Flush()
		case <-r.Context().Done():
			return
		}
	}
}

func (s *server) dashboardState() map[string]any {
	s.state.mu.RLock()
	nodes := make([]map[string]any, 0, len(s.state.nodes))
	for _, node := range s.state.nodes {
		nodes = append(nodes, s.publicNodeLocked(node))
	}
	startedAt := s.state.startedAt
	s.state.mu.RUnlock()
	sort.Slice(nodes, func(i, j int) bool { return stringValue(nodes[i]["id"]) < stringValue(nodes[j]["id"]) })
	totals := map[string]int{"nodes": len(nodes)}
	for _, node := range nodes {
		if node["status"] == "online" {
			totals["online"]++
		}
		m, _ := node["metrics"].(map[string]any)
		totals["running"] += intNumber(m["running"])
		totals["waitingReply"] += intNumber(m["waitingReply"])
		totals["waitingApproval"] += intNumber(m["waitingApproval"])
		totals["attention"] += intNumber(m["attention"])
		if health, ok := node["syncHealth"].(map[string]any); ok {
			totals["unread"] += intNumber(health["unreadNotifications"])
			if counts, ok := health["commandCounts"].(map[string]int); ok {
				totals["failedCommands"] += counts["failed"]
			} else if counts, ok := health["commandCounts"].(map[string]any); ok {
				totals["failedCommands"] += intNumber(counts["failed"])
			}
		}
	}
	totals["offline"] = totals["nodes"] - totals["online"]
	reportOffset := envInt("CODEXHUB_REPORT_TZ_OFFSET_MINUTES", 480)
	reportLocation := time.FixedZone("CodexHubReport", reportOffset*60)
	now := time.Now().In(reportLocation)
	todayStart := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, reportLocation)
	for _, node := range nodes {
		threads, _ := node["threads"].([]codexhub.Thread)
		for _, thread := range threads {
			at := firstNonZero(thread.LatestFinalMessageAt, thread.LatestMessageAt, thread.UpdatedAt, thread.CreatedAt)
			if anyTimeMillis(at) >= todayStart.UnixMilli() {
				totals["updatedToday"]++
			}
			if thread.LatestFinalMessage != "" && anyTimeMillis(firstNonZero(thread.LatestFinalMessageAt, thread.UpdatedAt)) >= todayStart.UnixMilli() {
				totals["completedToday"]++
			}
		}
	}
	report := map[string]any{"date": todayStart.Format("2006-01-02"), "timezoneOffsetMinutes": reportOffset, "updatedThreads": totals["updatedToday"], "completedThreads": totals["completedToday"], "failedCommands": totals["failedCommands"], "onlineNodes": totals["online"], "totalNodes": totals["nodes"]}
	return map[string]any{"ok": true, "version": env("CODEXHUB_VERSION", version), "generatedAt": nowISO(), "startedAt": startedAt, "storage": s.storageStatus(), "reports": map[string]any{"today": report}, "totals": totals, "nodes": nodes}
}

func (s *server) publicNodeLocked(node *codexhub.Node) map[string]any {
	threads := append([]codexhub.Thread(nil), node.Threads...)
	sort.SliceStable(threads, func(i, j int) bool {
		return threadActivityMillis(threads[i]) > threadActivityMillis(threads[j])
	})
	metrics := deriveMetrics(threads)
	for k, v := range node.Metrics {
		metrics[k] = v
	}
	attention := []any{}
	unread := []codexhub.Notification{}
	for _, n := range node.Notifications {
		if n.ReadAt == "" {
			unread = append(unread, n)
		}
	}
	metrics["attention"] = intNumber(metrics["attention"]) + len(unread)
	for _, n := range unread {
		attention = append(attention, map[string]any{
			"id":                      n.ThreadID,
			"provider":                "codex",
			"title":                   n.Title,
			"preview":                 n.Preview,
			"updatedAt":               firstNonZero(n.ThreadUpdatedAt, n.CreatedAt),
			"latestMessage":           n.Preview,
			"latestMessageAt":         n.CreatedAt,
			"latestFinalMessage":      map[bool]string{true: n.Preview, false: ""}[n.Type == "completed"],
			"latestFinalMessageAt":    map[bool]any{true: n.CreatedAt, false: nil}[n.Type == "completed"],
			"latestProgressMessage":   map[bool]string{true: "", false: n.Preview}[n.Type == "completed"],
			"latestProgressMessageAt": map[bool]any{true: nil, false: n.CreatedAt}[n.Type == "completed"],
			"recentMessages":          []codexhub.ThreadMessage{{Text: n.Preview, At: n.CreatedAt, Phase: n.Type}},
			"isGenerating":            false,
			"waitingOnApproval":       false,
			"waitingOnUserInput":      false,
			"attentionKind":           n.Type,
			"notificationId":          n.ID,
			"notificationCreatedAt":   n.CreatedAt,
		})
	}
	for _, t := range threads {
		if t.WaitingOnApproval || t.WaitingOnUserInput {
			attention = append(attention, t)
		}
	}
	pending := 0
	results := []codexhub.Command{}
	for _, c := range node.Commands {
		if c.Status == "queued" {
			pending++
		}
		if c.Status == "done" || c.Status == "failed" {
			results = append(results, c)
		}
	}
	if len(results) > 10 {
		results = results[len(results)-10:]
	}
	name := node.Name
	if name == "" {
		name = node.ID
	}
	return map[string]any{
		"id":                   node.ID,
		"name":                 name,
		"status":               s.nodeStatusLocked(node),
		"tags":                 node.Tags,
		"createdAt":            node.CreatedAt,
		"lastSeenAt":           nullableString(node.LastSeenAt),
		"version":              node.Version,
		"heartbeatSeq":         node.HeartbeatSeq,
		"collectedAt":          node.CollectedAt,
		"agentStartedAt":       node.AgentStartedAt,
		"update":               node.Update,
		"revokedAt":            nullableString(node.RevokedAt),
		"host":                 node.Host,
		"farfield":             node.Farfield,
		"metrics":              metrics,
		"threads":              threads,
		"attention":            attention,
		"notifications":        node.Notifications,
		"lastError":            node.LastError,
		"pendingCommands":      pending,
		"syncHealth":           s.syncHealthLocked(node, threads, unread),
		"recentCommandResults": results,
	}
}

func (s *server) syncHealthLocked(node *codexhub.Node, threads []codexhub.Thread, unread []codexhub.Notification) map[string]any {
	status := s.nodeStatusLocked(node)
	farfield := mapValue(node.Farfield)
	var latest *codexhub.Thread
	if len(threads) > 0 {
		latest = &threads[0]
	}
	var latestThreadAt any
	if latest != nil {
		latestThreadAt = firstNonZero(latest.LatestFinalMessageAt, latest.LatestProgressMessageAt, latest.LatestMessageAt, latest.UpdatedAt, latest.CreatedAt)
	}
	commandCounts := map[string]int{"queued": 0, "leased": 0, "done": 0, "failed": 0}
	var recent *codexhub.Command
	for i := range node.Commands {
		c := &node.Commands[i]
		if _, ok := commandCounts[c.Status]; ok {
			commandCounts[c.Status]++
		}
		if recent == nil || anyTimeMillis(firstNonZero(c.CompletedAt, c.LeasedAt, c.CreatedAt)) > anyTimeMillis(firstNonZero(recent.CompletedAt, recent.LeasedAt, recent.CreatedAt)) {
			recent = c
		}
	}
	checks := []map[string]any{
		{
			"key":    "cloud",
			"label":  "云端上报",
			"state":  map[bool]string{true: "ok", false: "danger"}[status == "online"],
			"detail": map[bool]string{true: "电脑端正在上报", false: "超过同步窗口未上报"}[status == "online"],
			"at":     nullableString(node.LastSeenAt),
		},
		{
			"key":    "farfield",
			"label":  "Farfield 本地服务",
			"state":  map[bool]string{true: "ok", false: "danger"}[boolValue(farfield["ok"])],
			"detail": map[bool]string{true: "可访问本地 Codex 网关", false: firstNonEmptyString(stringValue(farfield["lastError"]), stringValue(node.LastError), "本地服务不可用")}[boolValue(farfield["ok"])],
			"at":     nullableString(node.LastSeenAt),
		},
		{
			"key":    "codex",
			"label":  "Codex 会话读取",
			"state":  map[bool]string{true: "ok", false: "warning"}[latest != nil],
			"detail": map[bool]string{true: latestThreadDetail(latest), false: "还没有读到 Codex 会话"}[latest != nil],
			"at":     latestThreadAt,
		},
		{
			"key":    "commands",
			"label":  "命令回执",
			"state":  commandCheckState(commandCounts),
			"detail": commandCheckDetail(commandCounts),
			"at": func() any {
				if recent == nil {
					return nil
				}
				return firstNonZero(recent.CompletedAt, recent.LeasedAt, recent.CreatedAt)
			}(),
		},
		{
			"key":    "notifications",
			"label":  "未读通知",
			"state":  map[bool]string{true: "warning", false: "ok"}[len(unread) > 0],
			"detail": map[bool]string{true: fmt.Sprintf("%d 条未读等待处理", len(unread)), false: "没有未读事项"}[len(unread) > 0],
			"at": func() any {
				if len(unread) == 0 {
					return nil
				}
				return unread[0].CreatedAt
			}(),
		},
	}
	overall := "ok"
	for _, check := range checks {
		if check["state"] == "danger" {
			overall = "danger"
			break
		}
		if check["state"] == "warning" {
			overall = "warning"
		}
	}
	var latestThread any
	if latest != nil {
		latestThread = map[string]any{
			"id":                 latest.ID,
			"title":              latest.Title,
			"preview":            firstNonEmptyString(latest.Preview, latest.LatestMessage),
			"at":                 latestThreadAt,
			"isGenerating":       latest.IsGenerating,
			"waitingOnApproval":  latest.WaitingOnApproval,
			"waitingOnUserInput": latest.WaitingOnUserInput,
		}
	}
	var recentCommand any
	if recent != nil {
		recentCommand = map[string]any{
			"id":          recent.ID,
			"status":      recent.Status,
			"kind":        firstNonEmptyString(stringValue(recent.Action["kind"]), "command"),
			"createdAt":   recent.CreatedAt,
			"leasedAt":    recent.LeasedAt,
			"completedAt": recent.CompletedAt,
			"error":       commandError(recent),
		}
	}
	return map[string]any{
		"overall":             overall,
		"checks":              checks,
		"lastSeenAgeMs":       lastSeenAgeMillis(node.LastSeenAt),
		"latestThread":        latestThread,
		"commandCounts":       commandCounts,
		"recentCommand":       recentCommand,
		"unreadNotifications": len(unread),
	}
}

func latestThreadDetail(thread *codexhub.Thread) string {
	if thread == nil {
		return "还没有读到 Codex 会话"
	}
	if thread.IsGenerating {
		return "最近任务运行中"
	}
	return "最近任务已同步"
}

func commandCheckState(counts map[string]int) string {
	if counts["failed"] > 0 {
		return "danger"
	}
	if counts["queued"]+counts["leased"] > 0 {
		return "warning"
	}
	return "ok"
}

func commandCheckDetail(counts map[string]int) string {
	if counts["failed"] > 0 {
		return fmt.Sprintf("%d 条命令失败", counts["failed"])
	}
	if pending := counts["queued"] + counts["leased"]; pending > 0 {
		return fmt.Sprintf("%d 条命令等待桌面端回执", pending)
	}
	return "命令队列正常"
}

func commandError(command *codexhub.Command) any {
	if command == nil {
		return nil
	}
	if m := mapValue(command.Result); m != nil {
		if errText := stringValue(m["error"]); errText != "" {
			return errText
		}
		if result := mapValue(m["result"]); result != nil {
			if errText := stringValue(result["error"]); errText != "" {
				return errText
			}
		}
	}
	return nil
}

func lastSeenAgeMillis(lastSeenAt string) any {
	if lastSeenAt == "" {
		return nil
	}
	parsed, err := time.Parse(time.RFC3339, lastSeenAt)
	if err != nil {
		return nil
	}
	return time.Since(parsed).Milliseconds()
}

func threadActivityMillis(thread codexhub.Thread) int64 {
	return anyTimeMillis(firstNonZero(thread.LatestFinalMessageAt, thread.LatestProgressMessageAt, thread.LatestMessageAt, thread.UpdatedAt, thread.CreatedAt))
}

func findThread(threads []codexhub.Thread, threadID string) (codexhub.Thread, bool) {
	for _, thread := range threads {
		if thread.ID == threadID {
			return thread, true
		}
	}
	return codexhub.Thread{}, false
}

func threadState(thread codexhub.Thread) string {
	if thread.WaitingOnApproval {
		return "waiting_approval"
	}
	if thread.WaitingOnUserInput {
		return "waiting_reply"
	}
	if thread.IsGenerating {
		return "running"
	}
	if thread.LatestFinalMessage != "" || thread.LatestFinalMessageAt != nil {
		return "completed"
	}
	return "idle"
}

func threadTitle(thread codexhub.Thread) string {
	title := strings.TrimSpace(stringValue(thread.Title))
	if title != "" {
		return title
	}
	preview := compactText(thread.Preview, 80)
	if preview != "" {
		return preview
	}
	return "未命名 Codex 线程"
}

func threadRepo(thread codexhub.Thread) string {
	raw := strings.ReplaceAll(firstNonEmptyString(thread.CWD, thread.Source, thread.Provider, "codex"), "\\", "/")
	parts := []string{}
	for _, part := range strings.Split(raw, "/") {
		if strings.TrimSpace(part) != "" {
			parts = append(parts, strings.TrimSpace(part))
		}
	}
	if len(parts) >= 2 {
		return parts[len(parts)-2] + " / " + parts[len(parts)-1]
	}
	if len(parts) == 1 {
		return parts[0]
	}
	return "codex / workspace"
}

func compactText(value string, limit int) string {
	text := strings.Join(strings.Fields(value), " ")
	if text == "" {
		return ""
	}
	runes := []rune(text)
	if len(runes) > limit {
		return string(runes[:limit]) + "..."
	}
	return text
}

func appendUniqueLimit(out []string, seen map[string]bool, value string, limit int) []string {
	value = compactText(value, 180)
	key := strings.ToLower(value)
	if value == "" || seen[key] || len(out) >= limit {
		return out
	}
	seen[key] = true
	return append(out, value)
}

func splitMeaningfulLines(text string) []string {
	fields := strings.FieldsFunc(text, func(r rune) bool {
		return r == '\n' || r == '\r' || r == '。' || r == '；' || r == ';'
	})
	lines := []string{}
	for _, field := range fields {
		line := strings.Trim(strings.TrimSpace(field), "-*•0123456789.、 ")
		if len([]rune(line)) >= 6 {
			lines = append(lines, line)
		}
	}
	return lines
}

func recentRawMessages(thread codexhub.Thread, limit int) []codexhub.ThreadMessage {
	messages := []codexhub.ThreadMessage{}
	start := 0
	if len(thread.RecentMessages) > limit {
		start = len(thread.RecentMessages) - limit
	}
	for _, message := range thread.RecentMessages[start:] {
		if strings.TrimSpace(message.Text) == "" {
			continue
		}
		message.Text = compactText(message.Text, 900)
		messages = append(messages, message)
	}
	return messages
}

func contextSignature(node *codexhub.Node, thread codexhub.Thread) string {
	hash := sha256.New()
	_, _ = fmt.Fprintf(hash, "%s|%s|%v|%v|%v|%v", node.ID, thread.ID, thread.UpdatedAt, thread.LatestMessageAt, thread.LatestFinalMessageAt, thread.LatestProgressMessageAt)
	for _, message := range thread.RecentMessages {
		_, _ = fmt.Fprintf(hash, "|%v|%s|%s", message.At, message.Phase, compactText(message.Text, 300))
	}
	return fmt.Sprintf("%x", hash.Sum(nil))[:20]
}

func extractFiles(text string) []string {
	seen := map[string]bool{}
	out := []string{}
	for _, field := range strings.Fields(text) {
		value := strings.Trim(field, " ,，:：;；()[]{}<>\"'")
		normalized := strings.ReplaceAll(value, "\\", "/")
		if strings.Contains(normalized, "/") && strings.Contains(filepath.Base(normalized), ".") {
			out = appendUniqueLimit(out, seen, normalized, 8)
		}
	}
	return out
}

func extractCommands(lines []string) []string {
	needles := []string{"npm", "pnpm", "yarn", "node", "go ", "git ", "python", "pytest", "powershell", "curl", "docker", "kubectl", "sqlite3"}
	seen := map[string]bool{}
	out := []string{}
	for _, line := range lines {
		lower := strings.ToLower(line)
		for _, needle := range needles {
			if strings.Contains(lower, needle) {
				out = appendUniqueLimit(out, seen, line, 8)
				break
			}
		}
	}
	return out
}

func extractRiskFlags(text string) []string {
	checks := [][2]string{
		{"deploy", "部署"},
		{"production", "生产环境"},
		{"prod", "生产环境"},
		{"delete", "删除"},
		{"rm -rf", "递归删除"},
		{"git push", "git push"},
		{"secret", "密钥"},
		{"token", "令牌"},
		{"database", "数据库"},
		{"payment", "支付链路"},
		{"permission", "权限策略"},
		{"k8s", "集群变更"},
		{"kubectl", "集群命令"},
		{"失败", "失败状态"},
		{"高风险", "高风险请求"},
	}
	lower := strings.ToLower(text)
	seen := map[string]bool{}
	out := []string{}
	for _, check := range checks {
		if strings.Contains(lower, check[0]) {
			out = appendUniqueLimit(out, seen, check[1], 8)
		}
	}
	return out
}

func (s *server) buildThreadContextBundleLocked(node *codexhub.Node, thread codexhub.Thread) codexhub.ThreadContextBundle {
	signature := contextSignature(node, thread)
	cacheKey := node.ID + ":" + thread.ID
	if cached, ok := s.state.agentSummaries[cacheKey]; ok && cached.ContextSignature == signature {
		return cached
	}
	latest := firstNonEmptyString(thread.LatestMessage, thread.LatestProgressMessage, thread.LatestFinalMessage, thread.Preview)
	rawMessages := recentRawMessages(thread, 6)
	parts := []string{stringValue(thread.Title), thread.Preview, thread.LatestMessage, thread.LatestProgressMessage, thread.LatestFinalMessage}
	for _, message := range rawMessages {
		parts = append(parts, message.Text)
	}
	joined := strings.Join(parts, "\n")
	lines := splitMeaningfulLines(joined)
	currentPlan, completedWork, blockers := []string{}, []string{}, []string{}
	seenPlan, seenDone, seenBlockers := map[string]bool{}, map[string]bool{}, map[string]bool{}
	for _, line := range lines {
		lower := strings.ToLower(line)
		if strings.Contains(line, "计划") || strings.Contains(line, "下一步") || strings.Contains(line, "需要") || strings.Contains(line, "建议") || strings.Contains(lower, "todo") || strings.Contains(lower, "next") || strings.Contains(lower, "plan") || strings.Contains(lower, "will") || strings.Contains(lower, "should") {
			currentPlan = appendUniqueLimit(currentPlan, seenPlan, line, 6)
		}
		if strings.Contains(line, "已") || strings.Contains(line, "完成") || strings.Contains(line, "实现") || strings.Contains(line, "修复") || strings.Contains(line, "新增") || strings.Contains(line, "更新") || strings.Contains(lower, "done") || strings.Contains(lower, "implemented") || strings.Contains(lower, "fixed") || strings.Contains(lower, "added") || strings.Contains(lower, "updated") {
			completedWork = appendUniqueLimit(completedWork, seenDone, line, 6)
		}
		if strings.Contains(line, "失败") || strings.Contains(line, "错误") || strings.Contains(line, "阻塞") || strings.Contains(line, "等待") || strings.Contains(line, "需要你") || strings.Contains(line, "审批") || strings.Contains(line, "确认") || strings.Contains(lower, "error") || strings.Contains(lower, "failed") || strings.Contains(lower, "blocked") || strings.Contains(lower, "waiting") || strings.Contains(lower, "approval") || strings.Contains(lower, "confirm") {
			blockers = appendUniqueLimit(blockers, seenBlockers, line, 6)
		}
	}
	pending := ""
	if thread.WaitingOnApproval {
		pending = "Codex 正在等待审批。"
	} else if thread.WaitingOnUserInput {
		pending = "Codex 正在等待用户回复。"
	} else if len(blockers) > 0 {
		pending = blockers[0]
	}
	bundle := codexhub.ThreadContextBundle{
		ThreadID:                  thread.ID,
		NodeID:                    node.ID,
		NodeName:                  firstNonEmptyString(node.Name, node.ID),
		Repo:                      threadRepo(thread),
		CWD:                       thread.CWD,
		Provider:                  firstNonEmptyString(thread.Provider, "codex"),
		Status:                    threadState(thread),
		UserGoal:                  compactText(threadTitle(thread), 160),
		CurrentPlan:               currentPlan,
		CompletedWork:             completedWork,
		FilesMentioned:            extractFiles(joined),
		CommandsRun:               extractCommands(lines),
		Blockers:                  blockers,
		PendingQuestionOrApproval: compactText(firstNonEmptyString(pending, latest), 240),
		LatestCodexMessage:        compactText(latest, 900),
		RecentRawMessages:         rawMessages,
		RiskFlags:                 extractRiskFlags(joined),
		SummaryModel:              "codexhub-extractive-v1",
		SummaryUpdatedAt:          nowISO(),
		ContextSignature:          signature,
	}
	s.state.agentSummaries[cacheKey] = bundle
	if len(s.state.agentSummaries) > 500 {
		for key := range s.state.agentSummaries {
			delete(s.state.agentSummaries, key)
			break
		}
	}
	return bundle
}

func proposalRisk(bundle codexhub.ThreadContextBundle) string {
	for _, flag := range bundle.RiskFlags {
		if strings.Contains(flag, "生产") || strings.Contains(flag, "删除") || strings.Contains(flag, "push") || strings.Contains(flag, "密钥") || strings.Contains(flag, "数据库") || strings.Contains(flag, "支付") || strings.Contains(flag, "集群") || strings.Contains(flag, "高风险") || strings.Contains(flag, "失败") {
			return "high"
		}
	}
	if bundle.Status == "waiting_approval" || bundle.Status == "waiting_reply" {
		return "medium"
	}
	return "low"
}

func buildProposalText(bundle codexhub.ThreadContextBundle, body map[string]any) string {
	intent := stringValue(body["intent"])
	if bundle.Status == "waiting_approval" || intent == "approve" {
		return strings.Join([]string{
			fmt.Sprintf("建议先不要直接放行高风险动作。请 Codex 基于「%s」补充：", bundle.UserGoal),
			"1. 将要执行的具体命令或变更范围。",
			"2. 影响面、回滚方式和验证命令。",
			"3. 明确避开 deploy、git push、delete、secret access、database mutation。",
			"如果确认只是低风险代码或文档改动，再由人类批准继续。",
		}, "\n")
	}
	if bundle.Status == "waiting_reply" {
		return strings.Join([]string{
			fmt.Sprintf("请继续处理「%s」。", bundle.UserGoal),
			"优先给出最小可验证实现；完成后汇报修改文件、验证命令、剩余风险。",
			"不要部署、推送、删除文件或访问密钥；遇到这些动作必须再次请求人工确认。",
		}, "\n")
	}
	return strings.Join([]string{
		fmt.Sprintf("请基于当前上下文继续推进「%s」。", bundle.UserGoal),
		"保持改动最小，先验证再继续；如遇高风险动作，停止并请求人工审批。",
	}, "\n")
}

func buildAgentProposal(bundle codexhub.ThreadContextBundle, body map[string]any) codexhub.AgentProposal {
	risk := proposalRisk(bundle)
	confidence := 0.84
	if risk == "high" {
		confidence = 0.72
	}
	rationaleParts := []string{"基于压缩后的 ThreadContextBundle 生成。"}
	if len(bundle.RiskFlags) > 0 {
		rationaleParts = append(rationaleParts, "风险信号："+strings.Join(bundle.RiskFlags, "、")+"。")
	} else {
		rationaleParts = append(rationaleParts, "未发现明显高风险信号。")
	}
	rationaleParts = append(rationaleParts, "该 proposal 只供人工审核，不会自动写入 Codex。")
	return codexhub.AgentProposal{
		ProposalID:            uuid(),
		ThreadID:              bundle.ThreadID,
		NodeID:                bundle.NodeID,
		AgentID:               "codexhub-agent-proposal-v1",
		PolicyID:              "human-approved-proposal-v1",
		Kind:                  firstNonEmptyString(stringValue(body["kind"]), "reply"),
		Text:                  buildProposalText(bundle, body),
		Risk:                  risk,
		Confidence:            confidence,
		Rationale:             strings.Join(rationaleParts, " "),
		Boundaries:            []string{"Agent 只能生成 proposal", "人类批准后才下发 action", "禁止 deploy / git push / delete", "禁止 secret access / database mutation", "高风险动作必须二次确认"},
		RequiresHumanApproval: true,
		CreatedAt:             nowISO(),
		ExpiresAt:             time.Now().UTC().Add(30 * time.Minute).Format(time.RFC3339),
		ContextSignature:      bundle.ContextSignature,
		ContextSummary:        compactText(firstNonEmptyString(bundle.LatestCodexMessage, bundle.PendingQuestionOrApproval, bundle.UserGoal), 260),
	}
}

func decodedPathPart(value string) string {
	decoded, err := url.PathUnescape(value)
	if err != nil {
		return value
	}
	return decoded
}

func contextKey(nodeID, threadID string) string {
	return nodeID + ":" + threadID
}

func intFromAny(value any, fallback int) int {
	switch v := value.(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	case json.Number:
		n, err := v.Int64()
		if err == nil {
			return int(n)
		}
	case string:
		n, err := strconv.Atoi(strings.TrimSpace(v))
		if err == nil {
			return n
		}
	}
	return fallback
}

func fullContextFromCommandResult(nodeID, fallbackThreadID string, body map[string]any) (codexhub.FullThreadContext, bool) {
	result, ok := body["result"].(map[string]any)
	if !ok {
		return codexhub.FullThreadContext{}, false
	}
	data, err := json.Marshal(result)
	if err != nil {
		return codexhub.FullThreadContext{}, false
	}
	var fullContext codexhub.FullThreadContext
	if err := json.Unmarshal(data, &fullContext); err != nil {
		return codexhub.FullThreadContext{}, false
	}
	if fullContext.ThreadID == "" {
		fullContext.ThreadID = fallbackThreadID
	}
	if fullContext.ThreadID == "" {
		return codexhub.FullThreadContext{}, false
	}
	fullContext.NodeID = nodeID
	if fullContext.Mode == "" {
		fullContext.Mode = "full"
	}
	if fullContext.CollectedAt == "" {
		fullContext.CollectedAt = nowISO()
	}
	if fullContext.MessageCount == 0 {
		fullContext.MessageCount = len(fullContext.Messages)
	}
	return fullContext, true
}

func fullContextExpired(fullContext codexhub.FullThreadContext) bool {
	if fullContext.ExpiresAt == "" {
		return false
	}
	expiresAt, ok := parseTime(fullContext.ExpiresAt)
	return ok && !time.Now().UTC().Before(expiresAt)
}

func (s *server) installProfile(r *http.Request) map[string]any {
	base := s.publicBaseURL(r)
	installKey := s.currentInstallKey()
	releaseVersion := env("CODEXHUB_VERSION", version)
	if releaseVersion == "dev" || releaseVersion == "" {
		releaseVersion = "0.4.9"
	}
	downloads := map[string]string{
		"androidApk":         fmt.Sprintf("%s/downloads/codexhub-android-v%s.apk", base, releaseVersion),
		"windowsAgent":       fmt.Sprintf("%s/downloads/codexhub-windows-agent-v%s.zip", base, releaseVersion),
		"linuxAgent":         fmt.Sprintf("%s/downloads/codexhub-linux-agent-v%s.zip", base, releaseVersion),
		"macosAgent":         fmt.Sprintf("%s/downloads/codexhub-macos-agent-v%s.zip", base, releaseVersion),
		"server":             fmt.Sprintf("%s/downloads/codexhub-server-v%s.zip", base, releaseVersion),
		"companionInstaller": fmt.Sprintf("%s/downloads/codexhub-companion-installer-windows-x64-v%s.exe", base, releaseVersion),
	}
	win := strings.Join([]string{
		fmt.Sprintf("$u=%q; $z=\"$env:TEMP\\codexhub-windows-agent-v%s.zip\"; $d=\"$env:TEMP\\codexhub-agent-v%s\"; Invoke-WebRequest $u -OutFile $z; Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue; Expand-Archive $z -DestinationPath $d -Force; Set-Location $d; powershell -ExecutionPolicy Bypass -File .\\scripts\\install-desktop-agent.ps1", downloads["windowsAgent"], releaseVersion, releaseVersion),
		fmt.Sprintf("  -Server %q", base),
		fmt.Sprintf("  -InstallKey %q", installKey),
		"  -NodeId \"TMT1\"",
		"  -NodeName \"TMT1\"",
	}, " `\n")
	linux := strings.Join([]string{
		fmt.Sprintf("tmp=$(mktemp -d) && curl -fsSL %q -o \"$tmp/codexhub-linux-agent.zip\" && unzip -q \"$tmp/codexhub-linux-agent.zip\" -d \"$tmp/codexhub-linux-agent\" && cd \"$tmp/codexhub-linux-agent\" && bash ./scripts/install-linux-agent.sh", downloads["linuxAgent"]),
		fmt.Sprintf("  --server %q", base),
		fmt.Sprintf("  --install-key %q", installKey),
		"  --node-id \"$(hostname)\"",
		"  --node-name \"$(hostname)\"",
	}, " \\\n")
	macos := strings.Join([]string{
		fmt.Sprintf("tmp=$(mktemp -d) && curl -fsSL %q -o \"$tmp/codexhub-macos-agent.zip\" && unzip -q \"$tmp/codexhub-macos-agent.zip\" -d \"$tmp/codexhub-macos-agent\" && cd \"$tmp/codexhub-macos-agent\" && bash ./scripts/install-macos-agent.sh", downloads["macosAgent"]),
		fmt.Sprintf("  --server %q", base),
		fmt.Sprintf("  --install-key %q", installKey),
		"  --node-id \"$(scutil --get ComputerName)\"",
		"  --node-name \"$(scutil --get ComputerName)\"",
	}, " \\\n")
	return map[string]any{
		"ok": true, "version": releaseVersion, "serverUrl": base, "adminToken": s.cfg.AdminToken, "readonlyToken": nullableString(s.cfg.ReadonlyToken), "installKey": installKey, "downloads": downloads,
		"desktop": map[string]any{"powershell": win, "windows": win, "linux": linux, "macos": macos},
		"mobile":  map[string]any{"serverUrl": base, "token": s.cfg.AdminToken},
	}
}

func (s *server) publicBaseURL(r *http.Request) string {
	if s.cfg.PublicURL != "" {
		return s.cfg.PublicURL
	}
	proto := strings.TrimSpace(strings.Split(r.Header.Get("x-forwarded-proto"), ",")[0])
	if proto == "" {
		proto = "http"
	}
	host := strings.TrimSpace(strings.Split(r.Header.Get("x-forwarded-host"), ",")[0])
	if host == "" {
		host = r.Host
	}
	if host == "" {
		host = "127.0.0.1:" + strconv.Itoa(s.cfg.Port)
	}
	return proto + "://" + host
}

func (s *server) serveStatic(w http.ResponseWriter, r *http.Request) {
	requestPath := r.URL.Path
	if requestPath == "/" {
		requestPath = "/index.html"
	}
	cleaned := filepath.Clean(strings.TrimPrefix(requestPath, "/"))
	filePath := filepath.Join(s.cfg.PublicDir, cleaned)
	rel, err := filepath.Rel(s.cfg.PublicDir, filePath)
	if err != nil || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
		writeJSON(w, http.StatusForbidden, errorBody("Forbidden"))
		return
	}
	if !exists(filePath) || isDir(filePath) {
		filePath = filepath.Join(s.cfg.PublicDir, "index.html")
	}
	ctype := mime.TypeByExtension(strings.ToLower(filepath.Ext(filePath)))
	if ctype == "" {
		switch strings.ToLower(filepath.Ext(filePath)) {
		case ".webmanifest":
			ctype = "application/manifest+json"
		default:
			ctype = "application/octet-stream"
		}
	}
	w.Header().Set("content-type", ctype)
	w.Header().Set("cache-control", "no-cache")
	http.ServeFile(w, r, filePath)
}

func (s *server) loadState() error {
	if s.cfg.StorageDriver == "sqlite" {
		if loaded, err := s.loadSQLiteState(); err == nil && loaded {
			return nil
		} else if err != nil {
			log.Printf("sqlite state load warning: %v", err)
		}
	}
	if s.cfg.DataFile == "" || !exists(s.cfg.DataFile) {
		return nil
	}
	data, err := os.ReadFile(s.cfg.DataFile)
	if err != nil {
		return err
	}
	var payload persistedState
	if err := json.Unmarshal(data, &payload); err != nil {
		return err
	}
	s.state.mu.Lock()
	defer s.state.mu.Unlock()
	for _, node := range payload.Nodes {
		n := node
		if n.ID == "" {
			continue
		}
		if n.Commands == nil {
			n.Commands = []codexhub.Command{}
		}
		s.state.nodes[n.ID] = &n
	}
	if len(payload.AuditLogs) > 500 {
		payload.AuditLogs = payload.AuditLogs[len(payload.AuditLogs)-500:]
	}
	s.state.auditLogs = payload.AuditLogs
	if len(payload.ProposalAudits) > 500 {
		payload.ProposalAudits = payload.ProposalAudits[len(payload.ProposalAudits)-500:]
	}
	s.state.proposalAudits = payload.ProposalAudits
	if len(payload.PushSubscriptions) > 200 {
		payload.PushSubscriptions = payload.PushSubscriptions[len(payload.PushSubscriptions)-200:]
	}
	s.state.pushSubscriptions = payload.PushSubscriptions
	if strings.TrimSpace(payload.InstallKey) != "" {
		s.state.installKey = strings.TrimSpace(payload.InstallKey)
	}
	return nil
}

func (s *server) persistState() {
	s.state.mu.RLock()
	payload := persistedState{
		SavedAt:           nowISO(),
		SchemaVersion:     2,
		StorageDriver:     s.cfg.StorageDriver,
		InstallKey:        s.state.installKey,
		AuditLogs:         append([]codexhub.AuditEntry(nil), s.state.auditLogs...),
		ProposalAudits:    append([]codexhub.ProposalAuditEntry(nil), s.state.proposalAudits...),
		PushSubscriptions: append([]codexhub.PushSubscription(nil), s.state.pushSubscriptions...),
	}
	for _, node := range s.state.nodes {
		n := *node
		commands := []codexhub.Command{}
		for _, c := range n.Commands {
			if c.Status != "done" {
				commands = append(commands, c)
			}
		}
		n.Commands = commands
		payload.Nodes = append(payload.Nodes, n)
	}
	s.state.mu.RUnlock()
	if s.cfg.DataFile != "" {
		_ = os.MkdirAll(filepath.Dir(s.cfg.DataFile), 0755)
		tmp := s.cfg.DataFile + ".tmp"
		if data, err := json.MarshalIndent(payload, "", "  "); err == nil {
			_ = os.WriteFile(tmp, data, 0644)
			_ = os.Rename(tmp, s.cfg.DataFile)
		}
	}
	if s.cfg.StorageDriver == "sqlite" {
		if err := s.persistSQLiteState(payload); err != nil {
			log.Printf("sqlite state persist warning: %v", err)
		}
	}
}

func (s *server) applyPersistedState(payload persistedState) {
	s.state.mu.Lock()
	defer s.state.mu.Unlock()
	for _, node := range payload.Nodes {
		n := node
		if n.ID == "" {
			continue
		}
		if n.Commands == nil {
			n.Commands = []codexhub.Command{}
		}
		s.state.nodes[n.ID] = &n
	}
	if len(payload.AuditLogs) > 500 {
		payload.AuditLogs = payload.AuditLogs[len(payload.AuditLogs)-500:]
	}
	s.state.auditLogs = payload.AuditLogs
	if len(payload.ProposalAudits) > 500 {
		payload.ProposalAudits = payload.ProposalAudits[len(payload.ProposalAudits)-500:]
	}
	s.state.proposalAudits = payload.ProposalAudits
	if len(payload.PushSubscriptions) > 200 {
		payload.PushSubscriptions = payload.PushSubscriptions[len(payload.PushSubscriptions)-200:]
	}
	s.state.pushSubscriptions = payload.PushSubscriptions
	if strings.TrimSpace(payload.InstallKey) != "" {
		s.state.installKey = strings.TrimSpace(payload.InstallKey)
	}
}

func (s *server) loadSQLiteState() (bool, error) {
	if err := s.sqliteExec(sqliteSchemaSQL()); err != nil {
		return false, err
	}
	output, err := s.sqliteQuery("SELECT payload FROM state_snapshots ORDER BY id DESC LIMIT 1;\n")
	if err != nil || strings.TrimSpace(output) == "" {
		return false, err
	}
	var payload persistedState
	if err := json.Unmarshal([]byte(strings.TrimSpace(output)), &payload); err != nil {
		return false, err
	}
	s.applyPersistedState(payload)
	return true, nil
}

func (s *server) persistSQLiteState(payload persistedState) error {
	if !s.shouldPersistSQLite() {
		return nil
	}
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	statements := []string{sqliteSchemaSQL(), "BEGIN;"}
	statements = append(statements,
		fmt.Sprintf("INSERT OR REPLACE INTO state_snapshots(id,saved_at,payload) VALUES(1,%s,%s);", sqlString(payload.SavedAt), sqlString(string(data))),
		"DELETE FROM state_snapshots WHERE id != 1;",
		fmt.Sprintf("INSERT OR REPLACE INTO meta(key,value,updated_at) VALUES('installKey',%s,%s);", sqlString(payload.InstallKey), sqlString(payload.SavedAt)),
		fmt.Sprintf("INSERT OR REPLACE INTO meta(key,value,updated_at) VALUES('schemaVersion','2',%s);", sqlString(payload.SavedAt)),
		"DELETE FROM nodes;",
		"DELETE FROM notifications;",
		"DELETE FROM audit_logs;",
	)
	for _, node := range payload.Nodes {
		nodeData, _ := json.Marshal(node)
		status := "offline"
		if node.RevokedAt != "" {
			status = "revoked"
		} else if node.LastSeenAt != "" {
			if last, err := time.Parse(time.RFC3339, node.LastSeenAt); err == nil && time.Since(last) <= s.cfg.OfflineAfter {
				status = "online"
			}
		}
		statements = append(statements, fmt.Sprintf(
			"INSERT OR REPLACE INTO nodes(id,name,status,last_seen_at,version,payload,updated_at) VALUES(%s,%s,%s,%s,%s,%s,%s);",
			sqlString(node.ID), sqlString(firstNonEmptyString(node.Name, node.ID)), sqlString(status), sqlString(node.LastSeenAt), sqlString(stringValue(node.Version)), sqlString(string(nodeData)), sqlString(payload.SavedAt),
		))
		for _, notice := range node.Notifications {
			noticeData, _ := json.Marshal(notice)
			statements = append(statements, fmt.Sprintf(
				"INSERT OR REPLACE INTO notifications(id,node_id,thread_id,type,read_at,created_at,payload) VALUES(%s,%s,%s,%s,%s,%s,%s);",
				sqlString(notice.ID), sqlString(node.ID), sqlString(notice.ThreadID), sqlString(notice.Type), sqlString(notice.ReadAt), sqlString(notice.CreatedAt), sqlString(string(noticeData)),
			))
		}
	}
	for _, entry := range payload.AuditLogs {
		entryData, _ := json.Marshal(entry)
		statements = append(statements, fmt.Sprintf(
			"INSERT OR REPLACE INTO audit_logs(id,at,type,actor,payload) VALUES(%s,%s,%s,%s,%s);",
			sqlString(entry.ID), sqlString(entry.At), sqlString(entry.Type), sqlString(entry.Actor), sqlString(string(entryData)),
		))
	}
	statements = append(statements, "COMMIT;")
	return s.sqliteExec(strings.Join(statements, "\n"))
}

func (s *server) shouldPersistSQLite() bool {
	if s.cfg.SQLiteMinPersist <= 0 {
		return true
	}
	s.sqliteThrottleMu.Lock()
	defer s.sqliteThrottleMu.Unlock()
	now := time.Now()
	if !s.lastSQLitePersist.IsZero() && now.Sub(s.lastSQLitePersist) < s.cfg.SQLiteMinPersist {
		return false
	}
	s.lastSQLitePersist = now
	return true
}

func (s *server) sqliteExec(sql string) error {
	s.sqliteMu.Lock()
	defer s.sqliteMu.Unlock()
	if _, err := exec.LookPath("sqlite3"); err != nil {
		return fmt.Errorf("sqlite3 command not found")
	}
	if err := os.MkdirAll(filepath.Dir(s.cfg.SQLiteFile), 0755); err != nil {
		return err
	}
	cmd := exec.Command("sqlite3", "-batch", "-cmd", ".timeout 5000", s.cfg.SQLiteFile)
	cmd.Stdin = strings.NewReader(sql)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("%w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return nil
}

func (s *server) sqliteQuery(sql string) (string, error) {
	s.sqliteMu.Lock()
	defer s.sqliteMu.Unlock()
	if _, err := exec.LookPath("sqlite3"); err != nil {
		return "", fmt.Errorf("sqlite3 command not found")
	}
	cmd := exec.Command("sqlite3", "-batch", "-noheader", "-cmd", ".timeout 5000", s.cfg.SQLiteFile)
	cmd.Stdin = strings.NewReader(sql)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		return "", fmt.Errorf("%w: %s", err, strings.TrimSpace(stderr.String()))
	}
	return stdout.String(), nil
}

func (s *server) getOrCreateNodeLocked(nodeID string) *codexhub.Node {
	if node := s.state.nodes[nodeID]; node != nil {
		return node
	}
	node := &codexhub.Node{ID: nodeID, Name: nodeID, CreatedAt: nowISO(), Commands: []codexhub.Command{}, Notifications: []codexhub.Notification{}, Metrics: map[string]any{}}
	s.state.nodes[nodeID] = node
	return node
}

func (s *server) recordAuditLocked(kind, actor string, details map[string]any) {
	s.state.auditLogs = append(s.state.auditLogs, codexhub.AuditEntry{ID: uuid(), At: nowISO(), Type: kind, Actor: actor, Details: details})
	if len(s.state.auditLogs) > 500 {
		s.state.auditLogs = s.state.auditLogs[len(s.state.auditLogs)-500:]
	}
}

func (s *server) recordProposalAuditLocked(event, actor, nodeID, threadID string, proposal codexhub.AgentProposal, commandID, decision string) {
	if proposal.ProposalID == "" {
		return
	}
	if threadID == "" {
		threadID = proposal.ThreadID
	}
	if nodeID == "" {
		nodeID = proposal.NodeID
	}
	entry := codexhub.ProposalAuditEntry{
		ID:               uuid(),
		At:               nowISO(),
		Event:            event,
		NodeID:           nodeID,
		ThreadID:         threadID,
		ProposalID:       proposal.ProposalID,
		Actor:            actor,
		Risk:             proposal.Risk,
		Decision:         decision,
		CommandID:        commandID,
		ContextSignature: proposal.ContextSignature,
		Proposal:         proposal,
	}
	if len(s.state.proposalAudits) > 0 {
		entry.PreviousHash = s.state.proposalAudits[len(s.state.proposalAudits)-1].EntryHash
	}
	entry.EntryHash = proposalAuditEntryHash(entry)
	s.state.proposalAudits = append(s.state.proposalAudits, entry)
	if len(s.state.proposalAudits) > 500 {
		s.state.proposalAudits = s.state.proposalAudits[len(s.state.proposalAudits)-500:]
	}
}

func proposalAuditEntryHash(entry codexhub.ProposalAuditEntry) string {
	payload := map[string]any{
		"id":               entry.ID,
		"at":               entry.At,
		"event":            entry.Event,
		"nodeId":           entry.NodeID,
		"threadId":         entry.ThreadID,
		"proposalId":       entry.ProposalID,
		"actor":            entry.Actor,
		"risk":             entry.Risk,
		"decision":         entry.Decision,
		"commandId":        entry.CommandID,
		"contextSignature": entry.ContextSignature,
		"previousHash":     entry.PreviousHash,
		"proposal":         entry.Proposal,
	}
	data, _ := json.Marshal(payload)
	sum := sha256.Sum256(data)
	return fmt.Sprintf("%x", sum[:])
}

func (s *server) cleanupCommandsLocked(node *codexhub.Node) {
	now := time.Now()
	commands := node.Commands[:0]
	for _, c := range node.Commands {
		if c.Status == "leased" {
			if leased, ok := parseTime(c.LeasedAt); ok && now.Sub(leased) > s.cfg.CommandLease {
				c.Status = "queued"
				c.LeasedAt = nil
			}
		}
		if c.Status == "queued" || c.Status == "leased" {
			commands = append(commands, c)
			continue
		}
		if completed, ok := parseTime(c.CompletedAt); ok && now.Sub(completed) <= s.cfg.CommandTTL {
			commands = append(commands, c)
		}
	}
	node.Commands = commands
}

func (s *server) nodeStatusLocked(node *codexhub.Node) string {
	if node.RevokedAt != "" {
		return "revoked"
	}
	if node.LastSeenAt == "" {
		return "offline"
	}
	last, err := time.Parse(time.RFC3339, node.LastSeenAt)
	if err != nil || time.Since(last) > s.cfg.OfflineAfter {
		return "offline"
	}
	return "online"
}

func (s *server) listBackups() ([]map[string]any, error) {
	if err := os.MkdirAll(s.cfg.BackupDir, 0750); err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(s.cfg.BackupDir)
	if err != nil {
		return nil, err
	}
	backups := []map[string]any{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), "codexhub-backup-") || !strings.HasSuffix(entry.Name(), ".tar.gz") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		backups = append(backups, map[string]any{"name": entry.Name(), "size": info.Size(), "modifiedAt": info.ModTime().UTC().Format(time.RFC3339)})
	}
	sort.Slice(backups, func(i, j int) bool {
		return stringValue(backups[i]["modifiedAt"]) > stringValue(backups[j]["modifiedAt"])
	})
	return backups, nil
}

func (s *server) createBackup(reason string) (map[string]any, error) {
	s.persistState()
	if err := os.MkdirAll(s.cfg.BackupDir, 0750); err != nil {
		return nil, err
	}
	stamp := time.Now().UTC().Format("20060102T150405Z")
	name := fmt.Sprintf("codexhub-backup-%s.tar.gz", stamp)
	target := filepath.Join(s.cfg.BackupDir, name)
	tmp, err := os.MkdirTemp("", "codexhub-backup-*")
	if err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmp)
	payloadDir := filepath.Join(tmp, stamp)
	if err := os.MkdirAll(payloadDir, 0750); err != nil {
		return nil, err
	}
	files := []map[string]string{}
	if s.cfg.DataFile != "" && exists(s.cfg.DataFile) {
		if err := copyFile(s.cfg.DataFile, filepath.Join(payloadDir, "codexhub-state.json")); err != nil {
			return nil, err
		}
		files = append(files, map[string]string{"kind": "json", "name": "codexhub-state.json"})
	}
	if s.cfg.SQLiteFile != "" && exists(s.cfg.SQLiteFile) {
		sqliteTarget := filepath.Join(payloadDir, "codexhub.db")
		if sqlite3, err := exec.LookPath("sqlite3"); err == nil {
			cmd := exec.Command(sqlite3, s.cfg.SQLiteFile, ".backup '"+sqliteTarget+"'")
			if out, err := cmd.CombinedOutput(); err != nil {
				return nil, fmt.Errorf("sqlite backup failed: %v: %s", err, strings.TrimSpace(string(out)))
			}
		} else if err := copyFile(s.cfg.SQLiteFile, sqliteTarget); err != nil {
			return nil, err
		}
		files = append(files, map[string]string{"kind": "sqlite", "name": "codexhub.db"})
	}
	manifest := map[string]any{"createdAt": nowISO(), "reason": reason, "version": env("CODEXHUB_VERSION", version), "storage": s.storageStatus(), "files": files, "backupName": name}
	manifestData, _ := json.MarshalIndent(manifest, "", "  ")
	if err := os.WriteFile(filepath.Join(payloadDir, "manifest.json"), manifestData, 0600); err != nil {
		return nil, err
	}
	if err := writeTarGz(target, tmp); err != nil {
		return nil, err
	}
	info, err := os.Stat(target)
	if err != nil {
		return nil, err
	}
	return map[string]any{"name": name, "size": info.Size(), "modifiedAt": info.ModTime().UTC().Format(time.RFC3339)}, nil
}

func (s *server) restoreBackup(name string) error {
	source := filepath.Join(s.cfg.BackupDir, filepath.Base(name))
	if !exists(source) {
		return fmt.Errorf("backup not found: %s", name)
	}
	tmp, err := os.MkdirTemp("", "codexhub-restore-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(tmp)
	if err := extractTarGz(source, tmp); err != nil {
		return err
	}
	var jsonSource, sqliteSource string
	if err := filepath.WalkDir(tmp, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		switch entry.Name() {
		case "codexhub-state.json":
			jsonSource = path
		case "codexhub.db":
			sqliteSource = path
		}
		return nil
	}); err != nil {
		return err
	}
	if sqliteSource != "" && s.cfg.SQLiteFile != "" {
		if err := os.MkdirAll(filepath.Dir(s.cfg.SQLiteFile), 0750); err != nil {
			return err
		}
		if err := copyFile(sqliteSource, s.cfg.SQLiteFile); err != nil {
			return err
		}
	}
	if jsonSource != "" && s.cfg.DataFile != "" {
		if err := os.MkdirAll(filepath.Dir(s.cfg.DataFile), 0750); err != nil {
			return err
		}
		if err := copyFile(jsonSource, s.cfg.DataFile); err != nil {
			return err
		}
	}
	if sqliteSource == "" && jsonSource == "" {
		return fmt.Errorf("backup does not contain CodexHub data files")
	}
	return nil
}

func (s *server) fetchLatestRelease() (string, []map[string]any, string, error) {
	target := strings.TrimSpace(s.cfg.ReleaseManifestURL)
	if target != "" {
		var manifest struct {
			Version string           `json:"version"`
			Assets  []map[string]any `json:"assets"`
		}
		if err := getJSON(target, &manifest); err != nil {
			return "", nil, target, err
		}
		return strings.TrimPrefix(manifest.Version, "v"), manifest.Assets, target, nil
	}
	var release struct {
		TagName string `json:"tag_name"`
		HTMLURL string `json:"html_url"`
		Assets  []struct {
			Name               string `json:"name"`
			BrowserDownloadURL string `json:"browser_download_url"`
			Size               int64  `json:"size"`
		} `json:"assets"`
	}
	source := "https://api.github.com/repos/hedatu/codexhub/releases/latest"
	if err := getJSON(source, &release); err != nil {
		return "", nil, source, err
	}
	assets := []map[string]any{}
	for _, asset := range release.Assets {
		assets = append(assets, map[string]any{"name": asset.Name, "url": asset.BrowserDownloadURL, "size": asset.Size})
	}
	return strings.TrimPrefix(release.TagName, "v"), assets, release.HTMLURL, nil
}

func (s *server) storageStatus() map[string]any {
	sqliteAvailable := false
	if _, err := exec.LookPath("sqlite3"); err == nil {
		sqliteAvailable = true
	}
	note := "JSON file mode is active. Set CODEXHUB_STORAGE=sqlite during a future migration window."
	if s.cfg.StorageDriver == "sqlite" {
		if sqliteAvailable {
			note = "SQLite mode is active. JSON snapshots are still kept as a compatible fallback."
		} else {
			note = "SQLite mode is configured but sqlite3 was not found; install sqlite3 or switch back to JSON."
		}
	}
	file := s.cfg.DataFile
	if s.cfg.StorageDriver == "sqlite" {
		file = s.cfg.SQLiteFile
	}
	return map[string]any{
		"driver":        s.cfg.StorageDriver,
		"file":          file,
		"jsonFile":      nullableString(s.cfg.DataFile),
		"sqliteFile":    s.cfg.SQLiteFile,
		"sqliteEnabled": s.cfg.StorageDriver == "sqlite" && sqliteAvailable,
		"sqliteNote":    note,
	}
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	if err := os.MkdirAll(filepath.Dir(dst), 0750); err != nil {
		return err
	}
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()
	if _, err := io.Copy(out, in); err != nil {
		return err
	}
	return out.Close()
}

func writeTarGz(target, sourceDir string) error {
	out, err := os.Create(target)
	if err != nil {
		return err
	}
	defer out.Close()
	gz := gzip.NewWriter(out)
	defer gz.Close()
	tw := tar.NewWriter(gz)
	defer tw.Close()
	return filepath.WalkDir(sourceDir, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry.IsDir() {
			return err
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(sourceDir, path)
		if err != nil {
			return err
		}
		header, err := tar.FileInfoHeader(info, "")
		if err != nil {
			return err
		}
		header.Name = filepath.ToSlash(rel)
		if err := tw.WriteHeader(header); err != nil {
			return err
		}
		in, err := os.Open(path)
		if err != nil {
			return err
		}
		defer in.Close()
		_, err = io.Copy(tw, in)
		return err
	})
}

func extractTarGz(source, targetDir string) error {
	in, err := os.Open(source)
	if err != nil {
		return err
	}
	defer in.Close()
	gz, err := gzip.NewReader(in)
	if err != nil {
		return err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	for {
		header, err := tr.Next()
		if errors.Is(err, io.EOF) {
			return nil
		}
		if err != nil {
			return err
		}
		clean := filepath.Clean(header.Name)
		if clean == "." || strings.HasPrefix(clean, "..") || filepath.IsAbs(clean) {
			return fmt.Errorf("unsafe backup path: %s", header.Name)
		}
		path := filepath.Join(targetDir, clean)
		if header.FileInfo().IsDir() {
			if err := os.MkdirAll(path, 0750); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(path), 0750); err != nil {
			return err
		}
		out, err := os.Create(path)
		if err != nil {
			return err
		}
		if _, err := io.Copy(out, tr); err != nil {
			_ = out.Close()
			return err
		}
		if err := out.Close(); err != nil {
			return err
		}
	}
}

func getJSON(target string, out any) error {
	req, err := http.NewRequest(http.MethodGet, target, nil)
	if err != nil {
		return err
	}
	req.Header.Set("user-agent", "CodexHub/"+env("CODEXHUB_VERSION", version))
	resp, err := (&http.Client{Timeout: 8 * time.Second}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return fmt.Errorf("GET %s failed: %d %s", target, resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return json.NewDecoder(io.LimitReader(resp.Body, 4<<20)).Decode(out)
}

func compareVersions(a, b string) int {
	parse := func(value string) []int {
		value = strings.TrimPrefix(strings.TrimSpace(value), "v")
		parts := strings.Split(value, ".")
		nums := make([]int, 3)
		for i := 0; i < len(nums) && i < len(parts); i++ {
			part := strings.TrimFunc(parts[i], func(r rune) bool { return r < '0' || r > '9' })
			n, _ := strconv.Atoi(part)
			nums[i] = n
		}
		return nums
	}
	x, y := parse(a), parse(b)
	for i := 0; i < 3; i++ {
		if x[i] > y[i] {
			return 1
		}
		if x[i] < y[i] {
			return -1
		}
	}
	return 0
}

func sqliteSchemaSQL() string {
	return `
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS state_snapshots (id INTEGER PRIMARY KEY AUTOINCREMENT, saved_at TEXT NOT NULL, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS nodes (id TEXT PRIMARY KEY, name TEXT, status TEXT, last_seen_at TEXT, version TEXT, payload TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, node_id TEXT NOT NULL, thread_id TEXT, type TEXT, read_at TEXT, created_at TEXT, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, at TEXT NOT NULL, type TEXT NOT NULL, actor TEXT, payload TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_nodes_last_seen ON nodes(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_notifications_node_read ON notifications(node_id, read_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_at ON audit_logs(at);
`
}

func sqlString(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func (s *server) isAdminAuthed(r *http.Request) bool {
	return presentedToken(r) == s.cfg.AdminToken
}

func (s *server) isReadAuthed(r *http.Request) bool {
	token := presentedToken(r)
	return token == s.cfg.AdminToken || (s.cfg.ReadonlyToken != "" && token == s.cfg.ReadonlyToken)
}

func (s *server) isInstallAuthed(r *http.Request, body map[string]any) bool {
	token := presentedToken(r)
	installKey := s.currentInstallKey()
	return token == installKey || stringValue(body["installKey"]) == installKey || stringValue(body["install_key"]) == installKey
}

func (s *server) currentInstallKey() string {
	s.state.mu.RLock()
	key := strings.TrimSpace(s.state.installKey)
	s.state.mu.RUnlock()
	if key != "" {
		return key
	}
	return s.cfg.InstallKey
}

func (s *server) isNodeAuthedLocked(node *codexhub.Node, r *http.Request) bool {
	if node == nil || node.RevokedAt != "" {
		return false
	}
	token := presentedToken(r)
	return (node.DeviceKey != "" && token == node.DeviceKey) || (node.DeviceKey == "" && token == s.cfg.AdminToken)
}

func presentedToken(r *http.Request) string {
	auth := r.Header.Get("authorization")
	if strings.HasPrefix(auth, "Bearer ") {
		return strings.TrimSpace(strings.TrimPrefix(auth, "Bearer "))
	}
	if token := r.Header.Get("x-codexhub-token"); token != "" {
		return token
	}
	return r.URL.Query().Get("token")
}

func (s *server) sendEvent(event map[string]any) {
	data, _ := json.Marshal(event)
	payload := []byte("data: " + string(data) + "\n\n")
	s.state.mu.RLock()
	clients := make([]chan []byte, 0, len(s.state.clients))
	for ch := range s.state.clients {
		clients = append(clients, ch)
	}
	s.state.mu.RUnlock()
	for _, ch := range clients {
		select {
		case ch <- payload:
		default:
		}
	}
}

func (s *server) broadcastTicker() {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		s.sendEvent(map[string]any{"type": "state", "state": s.dashboardState()})
	}
}

func writeSSE(w io.Writer, event map[string]any) {
	data, _ := json.Marshal(event)
	_, _ = fmt.Fprintf(w, "data: %s\n\n", data)
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("content-type", "application/json; charset=utf-8")
	w.Header().Set("cache-control", "no-store")
	w.Header().Set("access-control-allow-origin", "*")
	w.Header().Set("access-control-allow-methods", "GET,POST,OPTIONS")
	w.Header().Set("access-control-allow-headers", "content-type, authorization, x-codexhub-token")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func readJSON(r *http.Request, target any) error {
	defer r.Body.Close()
	data, err := io.ReadAll(io.LimitReader(r.Body, 10<<20))
	if err != nil {
		return err
	}
	if len(strings.TrimSpace(string(data))) == 0 {
		data = []byte("{}")
	}
	decoder := json.NewDecoder(strings.NewReader(string(data)))
	decoder.UseNumber()
	return decoder.Decode(target)
}

func normalizeThreads(value any) []codexhub.Thread {
	items, ok := value.([]any)
	if !ok {
		return []codexhub.Thread{}
	}
	threads := []codexhub.Thread{}
	for _, item := range items {
		row, ok := item.(map[string]any)
		if !ok {
			continue
		}
		id := stringValue(row["id"])
		if id == "" {
			continue
		}
		provider := stringValue(row["provider"])
		if provider == "" {
			provider = "codex"
		}
		threads = append(threads, codexhub.Thread{
			ID:                      id,
			Provider:                provider,
			Title:                   first(row, "title", "name"),
			Preview:                 stringValue(row["preview"]),
			CWD:                     stringValue(row["cwd"]),
			Source:                  stringValue(row["source"]),
			CreatedAt:               row["createdAt"],
			UpdatedAt:               row["updatedAt"],
			LatestMessage:           stringValue(row["latestMessage"]),
			LatestMessageAt:         row["latestMessageAt"],
			LatestMessagePhase:      stringValue(row["latestMessagePhase"]),
			LatestFinalMessage:      stringValue(row["latestFinalMessage"]),
			LatestFinalMessageAt:    row["latestFinalMessageAt"],
			LatestProgressMessage:   stringValue(row["latestProgressMessage"]),
			LatestProgressMessageAt: row["latestProgressMessageAt"],
			RecentMessages:          normalizeRecentMessages(row["recentMessages"]),
			IsGenerating:            boolValue(row["isGenerating"]),
			WaitingOnApproval:       boolValue(row["waitingOnApproval"]),
			WaitingOnUserInput:      boolValue(row["waitingOnUserInput"]),
		})
	}
	return threads
}

func normalizeRecentMessages(value any) []codexhub.ThreadMessage {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	start := 0
	if len(items) > 20 {
		start = len(items) - 20
	}
	messages := []codexhub.ThreadMessage{}
	for _, item := range items[start:] {
		row, ok := item.(map[string]any)
		if !ok {
			continue
		}
		text := stringValue(row["text"])
		if strings.TrimSpace(text) == "" {
			continue
		}
		if len([]rune(text)) > 1800 {
			text = string([]rune(text)[:1800]) + "..."
		}
		messages = append(messages, codexhub.ThreadMessage{
			Text:  text,
			At:    row["at"],
			Phase: stringValue(row["phase"]),
			Role:  stringValue(row["role"]),
		})
	}
	return messages
}

func updateThreadNotificationsLocked(node *codexhub.Node, previousThreads []codexhub.Thread, nextThreads []codexhub.Thread, previousLastSeenAt string) []codexhub.Notification {
	created := []codexhub.Notification{}
	previousByID := map[string]codexhub.Thread{}
	for _, t := range previousThreads {
		previousByID[t.ID] = t
	}
	previousLastSeenMs := anyTimeMillis(previousLastSeenAt)
	for _, t := range nextThreads {
		previous, ok := previousByID[t.ID]
		threadUpdatedAt := firstNonZero(t.LatestFinalMessageAt, t.LatestMessageAt, t.UpdatedAt, t.CreatedAt)
		if !ok {
			finalAt := anyTimeMillis(t.LatestFinalMessageAt)
			if !t.IsGenerating && previousLastSeenMs > 0 && finalAt > previousLastSeenMs {
				if notice, ok := addNodeNotificationLocked(node, codexhub.Notification{
					Type:            "completed",
					ThreadID:        t.ID,
					ThreadUpdatedAt: firstNonZero(t.LatestFinalMessageAt, threadUpdatedAt),
					Title:           notificationTitle(t),
					Preview:         firstNonEmptyString(t.LatestFinalMessage, t.LatestMessage, t.Preview, "任务已结束，等待查看。"),
				}); ok {
					created = append(created, notice)
				}
			}
			continue
		}
		switch {
		case previous.IsGenerating && !t.IsGenerating:
			if notice, ok := addNodeNotificationLocked(node, codexhub.Notification{
				Type:            "completed",
				ThreadID:        t.ID,
				ThreadUpdatedAt: threadUpdatedAt,
				Title:           notificationTitle(t),
				Preview:         firstNonEmptyString(t.LatestFinalMessage, t.LatestMessage, t.Preview, "任务已结束，等待查看。"),
			}); ok {
				created = append(created, notice)
			}
		case !t.IsGenerating && anyTimeMillis(t.LatestFinalMessageAt) > anyTimeMillis(previous.LatestFinalMessageAt):
			if notice, ok := addNodeNotificationLocked(node, codexhub.Notification{
				Type:            "updated",
				ThreadID:        t.ID,
				ThreadUpdatedAt: t.LatestFinalMessageAt,
				Title:           notificationTitle(t),
				Preview:         firstNonEmptyString(t.LatestFinalMessage, "任务有新内容。"),
			}); ok {
				created = append(created, notice)
			}
		}
	}
	return created
}

func addNodeNotificationLocked(node *codexhub.Node, notice codexhub.Notification) (codexhub.Notification, bool) {
	notice.DedupeKey = notice.Type + ":" + notice.ThreadID + ":" + stringValue(notice.ThreadUpdatedAt)
	for i := range node.Notifications {
		existing := &node.Notifications[i]
		if existing.ReadAt == "" && existing.ThreadID == notice.ThreadID {
			existing.Type = notice.Type
			existing.ThreadUpdatedAt = notice.ThreadUpdatedAt
			existing.Title = notice.Title
			existing.Preview = notice.Preview
			existing.CreatedAt = nowISO()
			existing.DedupeKey = notice.DedupeKey
			return *existing, true
		}
	}
	for _, existing := range node.Notifications {
		if existing.DedupeKey == notice.DedupeKey {
			return codexhub.Notification{}, false
		}
	}
	notice.ID = uuid()
	notice.CreatedAt = nowISO()
	node.Notifications = append(node.Notifications, notice)
	if len(node.Notifications) > 100 {
		node.Notifications = node.Notifications[len(node.Notifications)-100:]
	}
	return notice, true
}

func notificationTitle(thread codexhub.Thread) string {
	title := strings.TrimSpace(stringValue(thread.Title))
	if title != "" {
		return title
	}
	preview := strings.TrimSpace(strings.Join(strings.Fields(thread.Preview), " "))
	if preview == "" {
		return "未命名任务"
	}
	if len([]rune(preview)) > 48 {
		return string([]rune(preview)[:48])
	}
	return preview
}

func deriveMetrics(threads []codexhub.Thread) map[string]any {
	m := map[string]any{"totalThreads": len(threads), "running": 0, "waitingReply": 0, "waitingApproval": 0, "attention": 0}
	for _, t := range threads {
		if t.IsGenerating {
			m["running"] = intNumber(m["running"]) + 1
		}
		if t.WaitingOnUserInput {
			m["waitingReply"] = intNumber(m["waitingReply"]) + 1
		}
		if t.WaitingOnApproval {
			m["waitingApproval"] = intNumber(m["waitingApproval"]) + 1
		}
		if t.WaitingOnUserInput || t.WaitingOnApproval {
			m["attention"] = intNumber(m["attention"]) + 1
		}
	}
	return m
}

func mapValue(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		return m
	}
	return map[string]any{}
}

func stringSlice(v any) []string {
	items, ok := v.([]any)
	if !ok {
		return nil
	}
	out := []string{}
	for _, item := range items {
		if s := strings.TrimSpace(stringValue(item)); s != "" {
			out = append(out, s)
		}
	}
	return out
}

func first(m map[string]any, keys ...string) any {
	for _, key := range keys {
		if v, ok := m[key]; ok {
			return v
		}
	}
	return nil
}

func firstNonZero(values ...any) any {
	for _, v := range values {
		if v == nil {
			continue
		}
		if s, ok := v.(string); ok && s == "" {
			continue
		}
		return v
	}
	return nil
}

func firstNonEmptyString(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func anyTimeMillis(v any) int64 {
	switch x := v.(type) {
	case nil:
		return 0
	case int:
		n := int64(x)
		if n < 10000000000 {
			return n * 1000
		}
		return n
	case int64:
		if x < 10000000000 {
			return x * 1000
		}
		return x
	case float64:
		n := int64(x)
		if n < 10000000000 {
			return n * 1000
		}
		return n
	case json.Number:
		n, err := x.Int64()
		if err == nil {
			if n < 10000000000 {
				return n * 1000
			}
			return n
		}
	case string:
		if n, err := strconv.ParseInt(x, 10, 64); err == nil {
			if n < 10000000000 {
				return n * 1000
			}
			return n
		}
		if t, err := time.Parse(time.RFC3339, x); err == nil {
			return t.UnixMilli()
		}
	}
	return 0
}

func stringValue(v any) string {
	switch x := v.(type) {
	case string:
		return x
	case json.Number:
		return x.String()
	case nil:
		return ""
	default:
		return fmt.Sprint(x)
	}
}

func boolValue(v any) bool {
	switch x := v.(type) {
	case bool:
		return x
	case string:
		return x == "true"
	default:
		return false
	}
}

func intNumber(v any) int {
	switch x := v.(type) {
	case int:
		return x
	case float64:
		return int(x)
	case json.Number:
		n, _ := x.Int64()
		return int(n)
	default:
		return 0
	}
}

func intParam(r *http.Request, key string, fallback int) int {
	n, err := strconv.Atoi(r.URL.Query().Get(key))
	if err != nil {
		return fallback
	}
	return n
}

func clamp(v, min, max int) int {
	if v < min {
		return min
	}
	if v > max {
		return max
	}
	return v
}

func nowISO() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func createSecret(prefix string) string {
	return prefix + "_" + randomBase64(24)
}

func uuid() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

func randomID(length int) string {
	id := randomBase64(8)
	if len(id) > length {
		return id[:length]
	}
	return id
}

func randomBase64(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func parseTime(v any) (time.Time, bool) {
	s := stringValue(v)
	if s == "" {
		return time.Time{}, false
	}
	t, err := time.Parse(time.RFC3339, s)
	return t, err == nil
}

func stripSlash(value string) string {
	return strings.TrimRight(value, "/")
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

func isDir(path string) bool {
	info, err := os.Stat(path)
	return err == nil && info.IsDir()
}

func nullableString(s string) any {
	if s == "" {
		return nil
	}
	return s
}

func errorBody(message string) map[string]any {
	return map[string]any{"ok": false, "error": message}
}
