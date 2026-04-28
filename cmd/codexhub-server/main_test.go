package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/hedatu/codexhub/internal/codexhub"
)

func newTestServer(node *codexhub.Node) *server {
	return &server{
		cfg: serverConfig{
			AdminToken:     "dev-token",
			ReadonlyToken:  "read-token",
			CommandTTL:     10 * time.Minute,
			CommandLease:   time.Minute,
			FullContextTTL: 30 * time.Minute,
		},
		state: &appState{
			nodes:          map[string]*codexhub.Node{node.ID: node},
			clients:        map[chan []byte]bool{},
			agentSummaries: map[string]codexhub.ThreadContextBundle{},
			agentProposals: map[string]codexhub.AgentProposal{},
			fullContexts:   map[string]codexhub.FullThreadContext{},
		},
	}
}

func testNode() *codexhub.Node {
	return &codexhub.Node{
		ID:        "node-1",
		Name:      "Node 1",
		DeviceKey: "node-key",
		Threads: []codexhub.Thread{{
			ID:                "thread-1",
			Provider:          "codex",
			Title:             "生产集群变更",
			Preview:           "计划执行 kubectl apply -f C:\\repo\\deploy.yaml，请确认影响范围和回滚方式。",
			CWD:               "C:\\repo",
			WaitingOnApproval: true,
			RecentMessages: []codexhub.ThreadMessage{{
				Text:  "已生成变更计划，下一步需要审批 kubectl apply -f C:\\repo\\deploy.yaml。",
				Role:  "assistant",
				Phase: "progress",
			}},
		}},
	}
}

func TestAgentDraftRouteReturnsProposalWithoutQueueingCommand(t *testing.T) {
	node := testNode()
	s := newTestServer(node)
	body := bytes.NewBufferString(`{"intent":"approve","kind":"reply"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/nodes/node-1/threads/thread-1/agent-draft", body)
	req.Header.Set("Authorization", "Bearer dev-token")
	res := httptest.NewRecorder()

	s.handle(res, req)

	if res.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d: %s", res.Code, res.Body.String())
	}
	var payload struct {
		OK            bool                         `json:"ok"`
		Proposal      codexhub.AgentProposal       `json:"proposal"`
		ContextBundle codexhub.ThreadContextBundle `json:"contextBundle"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !payload.OK || !payload.Proposal.RequiresHumanApproval {
		t.Fatalf("expected human-approved proposal, got %#v", payload.Proposal)
	}
	if payload.ContextBundle.SummaryModel != "codexhub-extractive-v1" {
		t.Fatalf("unexpected summary model: %s", payload.ContextBundle.SummaryModel)
	}
	if payload.ContextBundle.Status != "waiting_approval" {
		t.Fatalf("unexpected context status: %s", payload.ContextBundle.Status)
	}
	if !strings.Contains(payload.Proposal.Text, "不要直接放行高风险动作") {
		t.Fatalf("proposal text did not include approval guardrail: %q", payload.Proposal.Text)
	}
	if len(node.Commands) != 0 {
		t.Fatalf("agent draft must not enqueue commands, got %d", len(node.Commands))
	}
	if len(s.state.proposalAudits) != 1 || s.state.proposalAudits[0].Event != "created" {
		t.Fatalf("expected created proposal audit, got %#v", s.state.proposalAudits)
	}
}

func TestBuildAgentProposalRaisesRiskFromContextFlags(t *testing.T) {
	proposal := buildAgentProposal(codexhub.ThreadContextBundle{
		ThreadID:           "thread-1",
		NodeID:             "node-1",
		Status:             "waiting_reply",
		UserGoal:           "修复支付回调",
		LatestCodexMessage: "需要确认是否允许修改数据库记录。",
		RiskFlags:          []string{"数据库", "支付链路"},
		ContextSignature:   "abc123",
	}, map[string]any{"kind": "reply"})

	if proposal.Risk != "high" {
		t.Fatalf("expected high risk, got %s", proposal.Risk)
	}
	if !proposal.RequiresHumanApproval {
		t.Fatal("proposal must require human approval")
	}
	if proposal.ContextSignature != "abc123" {
		t.Fatalf("context signature was not preserved: %s", proposal.ContextSignature)
	}
}

func TestThreadContextRequestCachesFullContext(t *testing.T) {
	node := testNode()
	s := newTestServer(node)

	req := httptest.NewRequest(http.MethodGet, "/api/nodes/node-1/threads/thread-1/context-bundle?mode=compressed", nil)
	req.Header.Set("Authorization", "Bearer read-token")
	res := httptest.NewRecorder()
	s.handle(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("expected compressed context 200, got %d: %s", res.Code, res.Body.String())
	}
	var compressed struct {
		OK            bool                         `json:"ok"`
		Mode          string                       `json:"mode"`
		Status        string                       `json:"status"`
		ContextBundle codexhub.ThreadContextBundle `json:"contextBundle"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &compressed); err != nil {
		t.Fatalf("decode compressed context: %v", err)
	}
	if compressed.Mode != "compressed" || compressed.Status != "ready" || compressed.ContextBundle.ContextSignature == "" {
		t.Fatalf("unexpected compressed context response: %#v", compressed)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/nodes/node-1/threads/thread-1/context-request", bytes.NewBufferString(`{"maxMessages":5,"maxChars":12000}`))
	req.Header.Set("Authorization", "Bearer dev-token")
	res = httptest.NewRecorder()
	s.handle(res, req)
	if res.Code != http.StatusAccepted {
		t.Fatalf("expected context request 202, got %d: %s", res.Code, res.Body.String())
	}
	if len(node.Commands) != 1 {
		t.Fatalf("expected one queued command, got %d", len(node.Commands))
	}
	command := node.Commands[0]
	if stringValue(command.Action["kind"]) != "readThreadContext" {
		t.Fatalf("unexpected command action: %#v", command.Action)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/nodes/node-1/threads/thread-1/context-request", bytes.NewBufferString(`{"maxMessages":5,"maxChars":12000}`))
	req.Header.Set("Authorization", "Bearer dev-token")
	res = httptest.NewRecorder()
	s.handle(res, req)
	if res.Code != http.StatusAccepted {
		t.Fatalf("expected duplicate context request 202, got %d: %s", res.Code, res.Body.String())
	}
	if len(node.Commands) != 1 {
		t.Fatalf("duplicate context request should reuse queued command, got %d", len(node.Commands))
	}
	var duplicate struct {
		Deduped bool             `json:"deduped"`
		Command codexhub.Command `json:"command"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &duplicate); err != nil {
		t.Fatalf("decode duplicate response: %v", err)
	}
	if !duplicate.Deduped || duplicate.Command.ID != command.ID {
		t.Fatalf("expected duplicate response to reuse command %s, got %#v", command.ID, duplicate)
	}

	resultBody := bytes.NewBufferString(`{"ok":true,"result":{"threadId":"thread-1","mode":"full","messageCount":1,"truncated":false,"redacted":true,"collectedAt":"2026-04-28T00:00:00Z","contextSignature":"ctx-full","messages":[{"role":"user","phase":"message","text":"hello"}]}}`)
	req = httptest.NewRequest(http.MethodPost, "/api/nodes/node-1/commands/"+command.ID+"/result", resultBody)
	req.Header.Set("Authorization", "Bearer node-key")
	res = httptest.NewRecorder()
	s.handle(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("expected command result 200, got %d: %s", res.Code, res.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/nodes/node-1/threads/thread-1/context-bundle?mode=full", nil)
	req.Header.Set("Authorization", "Bearer dev-token")
	res = httptest.NewRecorder()
	s.handle(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("expected full context 200, got %d: %s", res.Code, res.Body.String())
	}
	var full struct {
		OK          bool                       `json:"ok"`
		Mode        string                     `json:"mode"`
		Status      string                     `json:"status"`
		FullContext codexhub.FullThreadContext `json:"fullContext"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &full); err != nil {
		t.Fatalf("decode full context: %v", err)
	}
	if full.Mode != "full" || full.Status != "ready" || full.FullContext.NodeID != "node-1" || full.FullContext.MessageCount != 1 {
		t.Fatalf("unexpected full context response: %#v", full)
	}
	if full.FullContext.CachedAt == "" || full.FullContext.ExpiresAt == "" {
		t.Fatalf("expected cachedAt and expiresAt on full context: %#v", full.FullContext)
	}

	req = httptest.NewRequest(http.MethodPost, "/api/nodes/node-1/threads/thread-1/context-clear", nil)
	req.Header.Set("Authorization", "Bearer dev-token")
	res = httptest.NewRecorder()
	s.handle(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("expected context clear 200, got %d: %s", res.Code, res.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/nodes/node-1/threads/thread-1/context-bundle?mode=full", nil)
	req.Header.Set("Authorization", "Bearer dev-token")
	res = httptest.NewRecorder()
	s.handle(res, req)
	if res.Code != http.StatusAccepted {
		t.Fatalf("expected cleared full context to be not ready, got %d: %s", res.Code, res.Body.String())
	}
}

func TestThreadContextAndProposalAuthBoundaries(t *testing.T) {
	node := testNode()
	s := newTestServer(node)

	cases := []struct {
		name   string
		method string
		path   string
		token  string
		body   string
		want   int
	}{
		{
			name:   "readonly can read compressed context",
			method: http.MethodGet,
			path:   "/api/nodes/node-1/threads/thread-1/context-bundle?mode=compressed",
			token:  "read-token",
			want:   http.StatusOK,
		},
		{
			name:   "readonly cannot read full context",
			method: http.MethodGet,
			path:   "/api/nodes/node-1/threads/thread-1/context-bundle?mode=full",
			token:  "read-token",
			want:   http.StatusUnauthorized,
		},
		{
			name:   "readonly cannot request full context",
			method: http.MethodPost,
			path:   "/api/nodes/node-1/threads/thread-1/context-request",
			token:  "read-token",
			body:   `{}`,
			want:   http.StatusUnauthorized,
		},
		{
			name:   "readonly cannot clear full context",
			method: http.MethodPost,
			path:   "/api/nodes/node-1/threads/thread-1/context-clear",
			token:  "read-token",
			body:   `{}`,
			want:   http.StatusUnauthorized,
		},
		{
			name:   "readonly cannot read proposal audit trail",
			method: http.MethodGet,
			path:   "/api/nodes/node-1/threads/thread-1/proposals",
			token:  "read-token",
			want:   http.StatusUnauthorized,
		},
	}

	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			req := httptest.NewRequest(tt.method, tt.path, strings.NewReader(tt.body))
			req.Header.Set("Authorization", "Bearer "+tt.token)
			res := httptest.NewRecorder()
			s.handle(res, req)
			if res.Code != tt.want {
				t.Fatalf("expected status %d, got %d: %s", tt.want, res.Code, res.Body.String())
			}
		})
	}
}

func TestThreadProposalsReturnsAuditTrail(t *testing.T) {
	node := testNode()
	s := newTestServer(node)

	req := httptest.NewRequest(http.MethodPost, "/api/nodes/node-1/threads/thread-1/agent-draft", bytes.NewBufferString(`{"intent":"approve","kind":"reply"}`))
	req.Header.Set("Authorization", "Bearer dev-token")
	res := httptest.NewRecorder()
	s.handle(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("expected agent draft 200, got %d: %s", res.Code, res.Body.String())
	}
	var draft struct {
		Proposal codexhub.AgentProposal `json:"proposal"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &draft); err != nil {
		t.Fatalf("decode draft: %v", err)
	}

	actionBody, _ := json.Marshal(map[string]any{
		"kind":                     "sendMessage",
		"provider":                 "codex",
		"threadId":                 "thread-1",
		"text":                     "请补充影响范围和回滚方式。",
		"proposalId":               draft.Proposal.ProposalID,
		"proposalDecision":         "approved",
		"proposalRisk":             draft.Proposal.Risk,
		"proposalContextSignature": draft.Proposal.ContextSignature,
	})
	req = httptest.NewRequest(http.MethodPost, "/api/nodes/node-1/actions", bytes.NewReader(actionBody))
	req.Header.Set("Authorization", "Bearer dev-token")
	res = httptest.NewRecorder()
	s.handle(res, req)
	if res.Code != http.StatusAccepted {
		t.Fatalf("expected action 202, got %d: %s", res.Code, res.Body.String())
	}

	req = httptest.NewRequest(http.MethodGet, "/api/nodes/node-1/threads/thread-1/proposals", nil)
	req.Header.Set("Authorization", "Bearer dev-token")
	res = httptest.NewRecorder()
	s.handle(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("expected proposals 200, got %d: %s", res.Code, res.Body.String())
	}
	var payload struct {
		Proposals []codexhub.AgentProposal      `json:"proposals"`
		Audits    []codexhub.ProposalAuditEntry `json:"audits"`
		Total     int                           `json:"totalAudits"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &payload); err != nil {
		t.Fatalf("decode proposals: %v", err)
	}
	if len(payload.Proposals) != 1 {
		t.Fatalf("expected one proposal, got %#v", payload.Proposals)
	}
	events := map[string]bool{}
	for _, entry := range payload.Audits {
		events[entry.Event] = true
	}
	if !events["created"] || !events["approved"] {
		t.Fatalf("expected created and approved audit events, got %#v", payload.Audits)
	}
	if payload.Total != 2 {
		t.Fatalf("expected total audit count 2, got %d", payload.Total)
	}
	if payload.Audits[0].EntryHash == "" || payload.Audits[1].EntryHash == "" {
		t.Fatalf("expected proposal audit hashes, got %#v", payload.Audits)
	}
	if payload.Audits[0].PreviousHash == "" && payload.Audits[1].PreviousHash == "" {
		t.Fatalf("expected proposal audit hash chain, got %#v", payload.Audits)
	}
	if payload.Audits[0].Event == "approved" && payload.Audits[0].PreviousHash != payload.Audits[1].EntryHash {
		t.Fatalf("expected approved audit to point at previous entry hash, got %#v", payload.Audits)
	}

	req = httptest.NewRequest(http.MethodGet, "/api/nodes/node-1/threads/thread-1/proposals?event=approved&limit=1", nil)
	req.Header.Set("Authorization", "Bearer dev-token")
	res = httptest.NewRecorder()
	s.handle(res, req)
	if res.Code != http.StatusOK {
		t.Fatalf("expected filtered proposals 200, got %d: %s", res.Code, res.Body.String())
	}
	var filtered struct {
		Audits []codexhub.ProposalAuditEntry `json:"audits"`
		Total  int                           `json:"totalAudits"`
	}
	if err := json.Unmarshal(res.Body.Bytes(), &filtered); err != nil {
		t.Fatalf("decode filtered proposals: %v", err)
	}
	if filtered.Total != 1 || len(filtered.Audits) != 1 || filtered.Audits[0].Event != "approved" {
		t.Fatalf("unexpected filtered audit result: %#v", filtered)
	}
}
