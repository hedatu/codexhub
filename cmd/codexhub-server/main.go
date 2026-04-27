package main

import (
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
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
	Root          string
	PublicDir     string
	Host          string
	Port          int
	PublicURL     string
	AdminToken    string
	ReadonlyToken string
	InstallKey    string
	DataFile      string
	OfflineAfter  time.Duration
	CommandTTL    time.Duration
	CommandLease  time.Duration
}

type appState struct {
	startedAt  string
	nodes      map[string]*codexhub.Node
	auditLogs  []codexhub.AuditEntry
	installKey string
	clients    map[chan []byte]bool
	mu         sync.RWMutex
}

type persistedState struct {
	SavedAt    string                `json:"savedAt"`
	InstallKey string                `json:"installKey,omitempty"`
	AuditLogs  []codexhub.AuditEntry `json:"auditLogs"`
	Nodes      []codexhub.Node       `json:"nodes"`
}

type server struct {
	cfg   serverConfig
	state *appState
}

func main() {
	cfg := loadConfig()
	state := &appState{
		startedAt:  time.Now().UTC().Format(time.RFC3339),
		nodes:      map[string]*codexhub.Node{},
		installKey: cfg.InstallKey,
		clients:    map[chan []byte]bool{},
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
	return serverConfig{
		Root:          root,
		PublicDir:     filepath.Join(root, "public"),
		Host:          env("CODEXHUB_HOST", "0.0.0.0"),
		Port:          port,
		PublicURL:     stripSlash(os.Getenv("CODEXHUB_PUBLIC_URL")),
		AdminToken:    admin,
		ReadonlyToken: strings.TrimSpace(os.Getenv("CODEXHUB_READONLY_TOKEN")),
		InstallKey:    install,
		DataFile:      os.Getenv("CODEXHUB_DATA_FILE"),
		OfflineAfter:  envDuration("CODEXHUB_OFFLINE_AFTER_MS", 45*time.Second),
		CommandTTL:    envDuration("CODEXHUB_COMMAND_TTL_MS", 10*time.Minute),
		CommandLease:  envDuration("CODEXHUB_COMMAND_LEASE_MS", time.Minute),
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
		s.state.mu.RUnlock()
		writeJSON(w, http.StatusOK, map[string]any{"ok": true, "version": version, "startedAt": s.state.startedAt, "nodes": nodes, "authRequired": true})
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
	node.Host = body["host"]
	previousLastSeenAt := node.LastSeenAt
	node.LastSeenAt = nowISO()
	node.Farfield = body["farfield"]
	node.Metrics = mapValue(body["metrics"])
	nextThreads := normalizeThreads(body["threads"])
	updateThreadNotificationsLocked(node, node.Threads, nextThreads, previousLastSeenAt)
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
	if !map[string]bool{"sendMessage": true, "interrupt": true, "submitUserInput": true, "refresh": true}[kind] {
		writeJSON(w, http.StatusBadRequest, errorBody("Unsupported action kind: "+kind))
		return
	}
	command := codexhub.Command{ID: uuid(), Status: "queued", CreatedAt: nowISO(), Action: action}
	s.state.mu.Lock()
	node := s.getOrCreateNodeLocked(nodeID)
	node.Commands = append(node.Commands, command)
	s.cleanupCommandsLocked(node)
	s.recordAuditLocked("command.queued", "admin", map[string]any{"nodeId": nodeID, "commandId": command.ID, "kind": kind, "threadId": action["threadId"]})
	s.state.mu.Unlock()
	s.persistState()
	s.sendEvent(map[string]any{"type": "commandQueued", "nodeId": nodeID, "command": command})
	writeJSON(w, http.StatusAccepted, map[string]any{"ok": true, "command": command})
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
			if cmd.Status == "failed" && stringValue(cmd.Action["threadId"]) != "" {
				addNodeNotificationLocked(node, codexhub.Notification{
					Type:            "commandFailed",
					ThreadID:        stringValue(cmd.Action["threadId"]),
					ThreadUpdatedAt: cmd.CompletedAt,
					Title:           "手机指令发送失败",
					Preview:         firstNonEmptyString(stringValue(body["error"]), stringValue(mapValue(body["result"])["error"]), "桌面端执行手机指令失败，请检查本机状态。"),
				})
			}
			s.recordAuditLocked("command.completed", "node", map[string]any{"nodeId": nodeID, "commandId": commandID, "status": cmd.Status})
			s.state.mu.Unlock()
			s.persistState()
			s.sendEvent(map[string]any{"type": "state", "state": s.dashboardState()})
			s.sendEvent(map[string]any{"type": "commandResult", "nodeId": nodeID, "command": cmd})
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
	return map[string]any{"ok": true, "generatedAt": nowISO(), "startedAt": startedAt, "totals": totals, "nodes": nodes}
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

func (s *server) installProfile(r *http.Request) map[string]any {
	base := s.publicBaseURL(r)
	installKey := s.currentInstallKey()
	releaseVersion := env("CODEXHUB_VERSION", version)
	if releaseVersion == "dev" || releaseVersion == "" {
		releaseVersion = "0.4.3"
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
	if strings.TrimSpace(payload.InstallKey) != "" {
		s.state.installKey = strings.TrimSpace(payload.InstallKey)
	}
	return nil
}

func (s *server) persistState() {
	if s.cfg.DataFile == "" {
		return
	}
	s.state.mu.RLock()
	payload := persistedState{SavedAt: nowISO(), InstallKey: s.state.installKey, AuditLogs: append([]codexhub.AuditEntry(nil), s.state.auditLogs...)}
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
	_ = os.MkdirAll(filepath.Dir(s.cfg.DataFile), 0755)
	tmp := s.cfg.DataFile + ".tmp"
	if data, err := json.MarshalIndent(payload, "", "  "); err == nil {
		_ = os.WriteFile(tmp, data, 0644)
		_ = os.Rename(tmp, s.cfg.DataFile)
	}
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
		})
	}
	return messages
}

func updateThreadNotificationsLocked(node *codexhub.Node, previousThreads []codexhub.Thread, nextThreads []codexhub.Thread, previousLastSeenAt string) {
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
				addNodeNotificationLocked(node, codexhub.Notification{
					Type:            "completed",
					ThreadID:        t.ID,
					ThreadUpdatedAt: firstNonZero(t.LatestFinalMessageAt, threadUpdatedAt),
					Title:           notificationTitle(t),
					Preview:         firstNonEmptyString(t.LatestFinalMessage, t.LatestMessage, t.Preview, "任务已结束，等待查看。"),
				})
			}
			continue
		}
		switch {
		case previous.IsGenerating && !t.IsGenerating:
			addNodeNotificationLocked(node, codexhub.Notification{
				Type:            "completed",
				ThreadID:        t.ID,
				ThreadUpdatedAt: threadUpdatedAt,
				Title:           notificationTitle(t),
				Preview:         firstNonEmptyString(t.LatestFinalMessage, t.LatestMessage, t.Preview, "任务已结束，等待查看。"),
			})
		case !t.IsGenerating && anyTimeMillis(t.LatestFinalMessageAt) > anyTimeMillis(previous.LatestFinalMessageAt):
			addNodeNotificationLocked(node, codexhub.Notification{
				Type:            "updated",
				ThreadID:        t.ID,
				ThreadUpdatedAt: t.LatestFinalMessageAt,
				Title:           notificationTitle(t),
				Preview:         firstNonEmptyString(t.LatestFinalMessage, "任务有新内容。"),
			})
		}
	}
}

func addNodeNotificationLocked(node *codexhub.Node, notice codexhub.Notification) {
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
			return
		}
	}
	for _, existing := range node.Notifications {
		if existing.DedupeKey == notice.DedupeKey {
			return
		}
	}
	notice.ID = uuid()
	notice.CreatedAt = nowISO()
	node.Notifications = append(node.Notifications, notice)
	if len(node.Notifications) > 100 {
		node.Notifications = node.Notifications[len(node.Notifications)-100:]
	}
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
