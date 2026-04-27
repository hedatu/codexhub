package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/hedatu/codexhub/internal/codexhub"
)

var version = "dev"

type config struct {
	ConfigPath  string `json:"-"`
	Server      string `json:"server"`
	NodeID      string `json:"nodeId"`
	NodeName    string `json:"nodeName"`
	NodeKey     string `json:"nodeKey"`
	InstallKey  string `json:"installKey,omitempty"`
	FarfieldURL string `json:"farfieldUrl"`
	Provider    string `json:"provider"`
	IntervalMS  int    `json:"intervalMs,omitempty"`
	EnrolledAt  string `json:"enrolledAt,omitempty"`
}

type app struct {
	cfg    config
	client *http.Client
}

type sessionMessage struct {
	Text  string
	At    any
	Phase string
}

var sessionFileIndex map[string]string

func main() {
	cfg := loadConfig()
	agent := &app{cfg: cfg, client: &http.Client{Timeout: 20 * time.Second}}
	log.Printf("CodexHub Go agent %s %s -> %s", version, cfg.NodeID, cfg.Server)
	log.Printf("Farfield source: %s", cfg.FarfieldURL)
	log.Printf("Agent config: %s", cfg.ConfigPath)
	agent.tick()
	ticker := time.NewTicker(time.Duration(cfg.IntervalMS) * time.Millisecond)
	defer ticker.Stop()
	for range ticker.C {
		agent.tick()
	}
}

func loadConfig() config {
	var configPath string
	flag.StringVar(&configPath, "config", env("CODEXHUB_AGENT_CONFIG", defaultConfigPath()), "agent config path")
	server := flag.String("server", "", "CodexHub server URL")
	node := flag.String("node", "", "node id")
	name := flag.String("name", "", "node name")
	nodeKey := flag.String("node-key", "", "node key")
	installKey := flag.String("install-key", "", "install key")
	farfield := flag.String("farfield", "", "Farfield URL")
	interval := flag.Int("interval", 0, "heartbeat interval ms")
	provider := flag.String("provider", "", "provider tag")
	flag.Parse()

	saved := readConfig(configPath)
	cfg := saved
	cfg.ConfigPath = configPath
	cfg.Server = stripSlash(firstNonEmpty(*server, os.Getenv("CODEXHUB_SERVER"), saved.Server, "http://127.0.0.1:8787"))
	cfg.NodeID = firstNonEmpty(*node, os.Getenv("CODEXHUB_NODE_ID"), saved.NodeID, hostname())
	cfg.NodeName = firstNonEmpty(*name, os.Getenv("CODEXHUB_NODE_NAME"), saved.NodeName, cfg.NodeID)
	cfg.NodeKey = firstNonEmpty(*nodeKey, os.Getenv("CODEXHUB_NODE_KEY"), os.Getenv("CODEXHUB_TOKEN"), saved.NodeKey)
	cfg.InstallKey = firstNonEmpty(*installKey, os.Getenv("CODEXHUB_INSTALL_KEY"), saved.InstallKey)
	cfg.FarfieldURL = stripSlash(firstNonEmpty(*farfield, os.Getenv("FARFIELD_URL"), saved.FarfieldURL, "http://127.0.0.1:4311"))
	cfg.Provider = firstNonEmpty(*provider, os.Getenv("CODEXHUB_PROVIDER"), saved.Provider, "codex")
	cfg.IntervalMS = firstInt(*interval, envInt("CODEXHUB_INTERVAL_MS", 0), saved.IntervalMS, 5000)
	return cfg
}

func defaultConfigPath() string {
	if runtime.GOOS == "windows" {
		base := os.Getenv("ProgramData")
		if base == "" {
			base = os.Getenv("USERPROFILE")
		}
		return filepath.Join(base, "CodexHub", "agent.json")
	}
	if runtime.GOOS == "darwin" {
		return filepath.Join(homeDir(), "Library", "Application Support", "CodexHub", "agent.json")
	}
	return filepath.Join(homeDir(), ".config", "codexhub", "agent.json")
}

func (a *app) tick() {
	if err := a.enrollIfNeeded(); err != nil {
		log.Printf("enroll failed: %v", err)
		return
	}
	snapshot, err := a.collectSnapshot()
	if err != nil {
		log.Printf("snapshot failed: %v", err)
		snapshot = map[string]any{
			"name":      a.cfg.NodeName,
			"version":   "go-" + version,
			"host":      hostInfo(),
			"farfield":  map[string]any{"ok": false},
			"threads":   []any{},
			"metrics":   map[string]any{},
			"lastError": err.Error(),
		}
	}
	var response struct {
		OK             bool `json:"ok"`
		QueuedCommands int  `json:"queuedCommands"`
	}
	err = a.postJSON(fmt.Sprintf("%s/api/nodes/%s/heartbeat", a.cfg.Server, urlPathEscape(a.cfg.NodeID)), a.cfg.NodeKey, snapshot, &response)
	if err != nil {
		log.Printf("heartbeat failed: %v", err)
		return
	}
	if response.QueuedCommands > 0 {
		if a.pollCommands() > 0 {
			if nextSnapshot, err := a.collectSnapshot(); err == nil {
				var ignored map[string]any
				if err := a.postJSON(fmt.Sprintf("%s/api/nodes/%s/heartbeat", a.cfg.Server, urlPathEscape(a.cfg.NodeID)), a.cfg.NodeKey, nextSnapshot, &ignored); err != nil {
					log.Printf("post-command heartbeat failed: %v", err)
				}
			}
		}
	}
	count := 0
	if rows, ok := snapshot["threads"].([]codexhub.Thread); ok {
		count = len(rows)
	}
	log.Printf("heartbeat ok: %d threads", count)
}

func (a *app) enrollIfNeeded() error {
	if a.cfg.NodeKey != "" {
		return nil
	}
	if a.cfg.InstallKey == "" {
		return errors.New("no node key found and no install key provided")
	}
	body := map[string]any{
		"installKey": a.cfg.InstallKey,
		"nodeId":     a.cfg.NodeID,
		"nodeName":   a.cfg.NodeName,
		"tags":       []string{a.cfg.Provider},
		"host":       hostInfo(),
	}
	var response struct {
		OK          bool           `json:"ok"`
		Node        map[string]any `json:"node"`
		Credentials struct {
			NodeID  string `json:"nodeId"`
			NodeKey string `json:"nodeKey"`
		} `json:"credentials"`
	}
	if err := a.requestJSON(http.MethodPost, a.cfg.Server+"/api/enroll", a.cfg.InstallKey, body, &response); err != nil {
		return err
	}
	a.cfg.NodeID = response.Credentials.NodeID
	a.cfg.NodeKey = response.Credentials.NodeKey
	if name, ok := response.Node["name"].(string); ok && name != "" {
		a.cfg.NodeName = name
	}
	a.cfg.EnrolledAt = time.Now().UTC().Format(time.RFC3339)
	if err := writeConfig(a.cfg.ConfigPath, a.cfg); err != nil {
		return err
	}
	log.Printf("enrolled %s; saved device key to %s", a.cfg.NodeID, a.cfg.ConfigPath)
	return nil
}

func (a *app) collectSnapshot() (map[string]any, error) {
	var health map[string]any
	if err := a.farfieldJSON(http.MethodGet, "/api/health", nil, &health); err != nil {
		return nil, err
	}
	var sidebar map[string]any
	err := a.farfieldJSON(http.MethodGet, "/api/unified/sidebar?limit=80&archived=false&all=true", nil, &sidebar)
	if err != nil {
		if fallbackErr := a.farfieldJSON(http.MethodGet, "/api/unified/threads?limit=80&archived=false&all=true", nil, &sidebar); fallbackErr != nil {
			return nil, err
		}
	}
	threads := normalizeThreads(sidebar, health, a.cfg.Provider)
	return map[string]any{
		"name":      a.cfg.NodeName,
		"version":   "go-" + version,
		"host":      hostInfo(),
		"tags":      []string{a.cfg.Provider},
		"farfield":  normalizeFarfield(health),
		"metrics":   deriveMetrics(threads),
		"threads":   threads,
		"lastError": lastError(health),
	}, nil
}

func (a *app) pollCommands() int {
	var payload struct {
		OK       bool               `json:"ok"`
		Commands []codexhub.Command `json:"commands"`
	}
	url := fmt.Sprintf("%s/api/nodes/%s/commands/poll?limit=5", a.cfg.Server, urlPathEscape(a.cfg.NodeID))
	if err := a.requestJSON(http.MethodGet, url, a.cfg.NodeKey, nil, &payload); err != nil {
		log.Printf("command poll failed: %v", err)
		return 0
	}
	processed := 0
	for _, command := range payload.Commands {
		result, err := a.executeCommand(command)
		processed++
		body := map[string]any{"ok": true, "result": result}
		if err != nil {
			body = map[string]any{"ok": false, "error": err.Error()}
		}
		resultURL := fmt.Sprintf("%s/api/nodes/%s/commands/%s/result", a.cfg.Server, urlPathEscape(a.cfg.NodeID), urlPathEscape(command.ID))
		var ignored map[string]any
		if err := a.postJSON(resultURL, a.cfg.NodeKey, body, &ignored); err != nil {
			log.Printf("command result failed: %v", err)
		}
	}
	return processed
}

func (a *app) executeCommand(command codexhub.Command) (any, error) {
	kind := stringValue(command.Action["kind"])
	switch kind {
	case "refresh":
		sessionFileIndex = nil
		return map[string]any{"ok": true, "skipped": false, "message": "refresh acknowledged"}, nil
	case "sendMessage", "interrupt", "submitUserInput":
		return a.forwardUnifiedCommand(command.Action)
	default:
		return nil, fmt.Errorf("unsupported command kind: %s", kind)
	}
}

func (a *app) forwardUnifiedCommand(action map[string]any) (any, error) {
	if action["provider"] == nil {
		action["provider"] = a.cfg.Provider
	}
	var result any
	err := a.farfieldJSON(http.MethodPost, "/api/unified/command", action, &result)
	return result, err
}

func (a *app) farfieldJSON(method, path string, body any, target any) error {
	return a.requestJSON(method, a.cfg.FarfieldURL+path, "", body, target)
}

func (a *app) postJSON(url, token string, body any, target any) error {
	return a.requestJSON(http.MethodPost, url, token, body, target)
}

func (a *app) requestJSON(method, url, token string, body any, target any) error {
	var reader io.Reader
	if body != nil {
		data, _ := json.Marshal(body)
		reader = bytes.NewReader(data)
	}
	req, err := http.NewRequest(method, url, reader)
	if err != nil {
		return err
	}
	req.Header.Set("content-type", "application/json")
	if token != "" {
		req.Header.Set("authorization", "Bearer "+token)
	}
	resp, err := a.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(resp.Body)
	if len(data) > 0 && target != nil {
		decoder := json.NewDecoder(bytes.NewReader(data))
		decoder.UseNumber()
		_ = decoder.Decode(target)
	}
	if resp.StatusCode < 200 || resp.StatusCode > 299 {
		var payload map[string]any
		_ = json.Unmarshal(data, &payload)
		msg := string(data)
		if errText := stringValue(payload["error"]); errText != "" {
			msg = errText
		}
		return fmt.Errorf("%d %s: %s", resp.StatusCode, resp.Status, msg)
	}
	return nil
}

func normalizeFarfield(health map[string]any) map[string]any {
	state, _ := health["state"].(map[string]any)
	return map[string]any{
		"ok":             boolValue(health["ok"]),
		"appReady":       boolValue(state["appReady"]),
		"ipcConnected":   boolValue(state["ipcConnected"]),
		"ipcInitialized": boolValue(state["ipcInitialized"]),
		"codexAvailable": state["codexAvailable"] != false,
		"lastError":      state["lastError"],
		"socketPath":     state["socketPath"],
		"appExecutable":  state["appExecutable"],
		"gitCommit":      state["gitCommit"],
		"activeTrace":    state["activeTrace"],
	}
}

func normalizeThreads(sidebar map[string]any, health map[string]any, provider string) []codexhub.Thread {
	rows := anySlice(first(sidebar, "rows", "data", "threads"))
	clearGenerating := farfieldHasNoActiveTrace(health)
	threads := []codexhub.Thread{}
	for _, rowAny := range rows {
		row, ok := rowAny.(map[string]any)
		if !ok {
			continue
		}
		id := stringValue(row["id"])
		if id == "" {
			continue
		}
		p := stringValue(row["provider"])
		if p == "" {
			p = provider
		}
		latest := readLatestSessionMessage(id)
		latestFinalAt := valueTime(latest.LatestFinalMessageAt)
		latestProgressAt := valueTime(latest.LatestProgressMessageAt)
		hasFreshFinal := latestFinalAt > 0 && latestFinalAt >= latestProgressAt
		isGenerating := boolValue(row["isGenerating"])
		if clearGenerating && hasFreshFinal {
			isGenerating = false
		}
		threads = append(threads, codexhub.Thread{
			ID:                      id,
			Provider:                p,
			Title:                   first(row, "title", "name"),
			Preview:                 stringValue(row["preview"]),
			CWD:                     stringValue(row["cwd"]),
			Source:                  stringValue(row["source"]),
			CreatedAt:               row["createdAt"],
			UpdatedAt:               row["updatedAt"],
			LatestMessage:           latest.LatestMessage,
			LatestMessageAt:         latest.LatestMessageAt,
			LatestMessagePhase:      latest.LatestMessagePhase,
			LatestFinalMessage:      latest.LatestFinalMessage,
			LatestFinalMessageAt:    latest.LatestFinalMessageAt,
			LatestProgressMessage:   latest.LatestProgressMessage,
			LatestProgressMessageAt: latest.LatestProgressMessageAt,
			RecentMessages:          latest.RecentMessages,
			IsGenerating:            isGenerating,
			WaitingOnApproval:       boolValue(row["waitingOnApproval"]),
			WaitingOnUserInput:      boolValue(row["waitingOnUserInput"]),
		})
	}
	return threads
}

func sessionRoot() string {
	return filepath.Join(env("CODEX_HOME", filepath.Join(homeDir(), ".codex")), "sessions")
}

func buildSessionFileIndex() map[string]string {
	index := map[string]string{}
	_ = filepath.WalkDir(sessionRoot(), func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry == nil || entry.IsDir() {
			return nil
		}
		name := entry.Name()
		if !strings.HasSuffix(name, ".jsonl") {
			return nil
		}
		threadID := strings.TrimSuffix(name, ".jsonl")
		if looksLikeUUID(threadID) {
			index[threadID] = path
		}
		return nil
	})
	return index
}

func looksLikeUUID(value string) bool {
	if len(value) != 36 {
		return false
	}
	for index, ch := range value {
		switch index {
		case 8, 13, 18, 23:
			if ch != '-' {
				return false
			}
		default:
			if !((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')) {
				return false
			}
		}
	}
	return true
}

func sessionFileForThread(threadID string) string {
	if sessionFileIndex == nil {
		sessionFileIndex = buildSessionFileIndex()
	}
	if path := sessionFileIndex[threadID]; path != "" {
		return path
	}
	sessionFileIndex = buildSessionFileIndex()
	return sessionFileIndex[threadID]
}

func readLatestSessionMessage(threadID string) codexhub.Thread {
	filePath := sessionFileForThread(threadID)
	if filePath == "" {
		return codexhub.Thread{}
	}
	data, err := os.ReadFile(filePath)
	if err != nil {
		return codexhub.Thread{}
	}
	lines := strings.Split(strings.TrimRight(string(data), "\r\n"), "\n")
	var latestFinal *sessionMessage
	var latestProgress *sessionMessage
	recentMessages := []codexhub.ThreadMessage{}
	for index := len(lines) - 1; index >= 0; index-- {
		line := strings.TrimSpace(lines[index])
		if line == "" {
			continue
		}
		var event map[string]any
		decoder := json.NewDecoder(strings.NewReader(line))
		decoder.UseNumber()
		if err := decoder.Decode(&event); err != nil {
			continue
		}
		payload, _ := event["payload"].(map[string]any)
		text := extractSessionMessageText(payload)
		if text == "" {
			continue
		}
		if len(text) > 1800 {
			text = text[:1800] + "..."
		}
		entry := &sessionMessage{
			Text:  text,
			At:    event["timestamp"],
			Phase: stringValue(payload["phase"]),
		}
		if len(recentMessages) < 6 {
			recentMessages = append(recentMessages, codexhub.ThreadMessage{Text: entry.Text, At: entry.At, Phase: entry.Phase})
		}
		if latestFinal == nil && entry.Phase == "final_answer" {
			latestFinal = entry
		} else if latestProgress == nil && entry.Phase != "final_answer" {
			latestProgress = entry
		}
		if latestFinal != nil && latestProgress != nil && len(recentMessages) >= 6 {
			break
		}
	}
	preferred := latestFinal
	if preferred == nil {
		preferred = latestProgress
	}
	if preferred == nil {
		return codexhub.Thread{}
	}
	thread := codexhub.Thread{
		LatestMessage:      preferred.Text,
		LatestMessageAt:    preferred.At,
		LatestMessagePhase: preferred.Phase,
		RecentMessages:     reverseThreadMessages(recentMessages),
	}
	if latestFinal != nil {
		thread.LatestFinalMessage = latestFinal.Text
		thread.LatestFinalMessageAt = latestFinal.At
	}
	if latestProgress != nil {
		thread.LatestProgressMessage = latestProgress.Text
		thread.LatestProgressMessageAt = latestProgress.At
	}
	return thread
}

func reverseThreadMessages(messages []codexhub.ThreadMessage) []codexhub.ThreadMessage {
	out := append([]codexhub.ThreadMessage(nil), messages...)
	for left, right := 0, len(out)-1; left < right; left, right = left+1, right-1 {
		out[left], out[right] = out[right], out[left]
	}
	return out
}

func extractSessionMessageText(payload map[string]any) string {
	if payload == nil {
		return ""
	}
	if stringValue(payload["type"]) == "agent_message" {
		return strings.TrimSpace(stringValue(payload["message"]))
	}
	if stringValue(payload["type"]) != "message" || stringValue(payload["role"]) != "assistant" {
		return ""
	}
	texts := []string{}
	for _, partAny := range anySlice(payload["content"]) {
		part, ok := partAny.(map[string]any)
		if !ok {
			continue
		}
		if text := strings.TrimSpace(stringValue(part["text"])); text != "" {
			texts = append(texts, text)
		}
	}
	return strings.TrimSpace(strings.Join(texts, "\n"))
}

func valueTime(value any) int64 {
	switch v := value.(type) {
	case int:
		return numericMillis(float64(v))
	case int64:
		return numericMillis(float64(v))
	case float64:
		return numericMillis(v)
	case json.Number:
		n, err := v.Float64()
		if err != nil {
			return 0
		}
		return numericMillis(n)
	case string:
		s := strings.TrimSpace(v)
		if s == "" {
			return 0
		}
		if n, err := strconv.ParseFloat(s, 64); err == nil {
			return numericMillis(n)
		}
		if parsed, err := time.Parse(time.RFC3339Nano, s); err == nil {
			return parsed.UnixMilli()
		}
		return 0
	default:
		return 0
	}
}

func numericMillis(value float64) int64 {
	if value <= 0 {
		return 0
	}
	if value < 10_000_000_000 {
		return int64(value * 1000)
	}
	return int64(value)
}

func farfieldHasNoActiveTrace(health map[string]any) bool {
	state, ok := health["state"].(map[string]any)
	if !ok {
		return false
	}
	trace, exists := state["activeTrace"]
	return exists && trace == nil
}

func deriveMetrics(threads []codexhub.Thread) map[string]int {
	metrics := map[string]int{"running": 0, "waitingReply": 0, "waitingApproval": 0, "totalThreads": len(threads)}
	for _, thread := range threads {
		if thread.IsGenerating {
			metrics["running"]++
		}
		if thread.WaitingOnUserInput {
			metrics["waitingReply"]++
		}
		if thread.WaitingOnApproval {
			metrics["waitingApproval"]++
		}
	}
	return metrics
}

func lastError(health map[string]any) any {
	if state, ok := health["state"].(map[string]any); ok {
		return state["lastError"]
	}
	return nil
}

func readConfig(path string) config {
	var cfg config
	data, err := os.ReadFile(path)
	if err == nil {
		_ = json.Unmarshal(data, &cfg)
	}
	return cfg
}

func writeConfig(path string, cfg config) error {
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	data, _ := json.MarshalIndent(cfg, "", "  ")
	return os.WriteFile(path, data, 0600)
}

func hostInfo() codexhub.HostInfo {
	return codexhub.HostInfo{Hostname: hostname(), Platform: runtime.GOOS, Release: runtime.Version(), Arch: runtime.GOARCH}
}

func hostname() string {
	name, err := os.Hostname()
	if err != nil || name == "" {
		return "codexhub-node"
	}
	return name
}

func homeDir() string {
	home, _ := os.UserHomeDir()
	return home
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func firstInt(values ...int) int {
	for _, value := range values {
		if value != 0 {
			return value
		}
	}
	return 0
}

func env(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func envInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		n, err := strconv.Atoi(v)
		if err == nil {
			return n
		}
	}
	return fallback
}

func stripSlash(value string) string {
	return strings.TrimRight(value, "/")
}

func urlPathEscape(value string) string {
	return strings.ReplaceAll(value, "/", "%2F")
}

func first(m map[string]any, keys ...string) any {
	for _, key := range keys {
		if v, ok := m[key]; ok {
			return v
		}
	}
	return nil
}

func anySlice(value any) []any {
	if rows, ok := value.([]any); ok {
		return rows
	}
	return nil
}

func stringValue(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case json.Number:
		return v.String()
	case nil:
		return ""
	default:
		return fmt.Sprint(v)
	}
}

func boolValue(value any) bool {
	switch v := value.(type) {
	case bool:
		return v
	case string:
		return v == "true"
	default:
		return false
	}
}
