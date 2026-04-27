package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/hedatu/codexhub/internal/codexhub"
)

func TestAgentDraftRouteReturnsProposalWithoutQueueingCommand(t *testing.T) {
	node := &codexhub.Node{
		ID:   "node-1",
		Name: "Node 1",
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
	s := &server{
		cfg: serverConfig{AdminToken: "dev-token"},
		state: &appState{
			nodes:          map[string]*codexhub.Node{"node-1": node},
			clients:        map[chan []byte]bool{},
			agentSummaries: map[string]codexhub.ThreadContextBundle{},
			agentProposals: map[string]codexhub.AgentProposal{},
		},
	}
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
