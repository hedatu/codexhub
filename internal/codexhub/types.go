package codexhub

type HostInfo struct {
	Hostname string `json:"hostname,omitempty"`
	Platform string `json:"platform,omitempty"`
	Release  string `json:"release,omitempty"`
	Arch     string `json:"arch,omitempty"`
}

type FarfieldState struct {
	OK             bool   `json:"ok"`
	AppReady       bool   `json:"appReady"`
	IPCConnected   bool   `json:"ipcConnected"`
	IPCInitialized bool   `json:"ipcInitialized"`
	CodexAvailable bool   `json:"codexAvailable"`
	LastError      any    `json:"lastError,omitempty"`
	SocketPath     string `json:"socketPath,omitempty"`
	AppExecutable  string `json:"appExecutable,omitempty"`
	GitCommit      string `json:"gitCommit,omitempty"`
}

type ThreadMessage struct {
	Text  string `json:"text,omitempty"`
	At    any    `json:"at,omitempty"`
	Phase string `json:"phase,omitempty"`
	Role  string `json:"role,omitempty"`
}

type Thread struct {
	ID                      string          `json:"id"`
	Provider                string          `json:"provider,omitempty"`
	Title                   any             `json:"title,omitempty"`
	Preview                 string          `json:"preview,omitempty"`
	CWD                     string          `json:"cwd,omitempty"`
	Source                  string          `json:"source,omitempty"`
	CreatedAt               any             `json:"createdAt,omitempty"`
	UpdatedAt               any             `json:"updatedAt,omitempty"`
	LatestMessage           string          `json:"latestMessage,omitempty"`
	LatestMessageAt         any             `json:"latestMessageAt,omitempty"`
	LatestMessagePhase      string          `json:"latestMessagePhase,omitempty"`
	LatestFinalMessage      string          `json:"latestFinalMessage,omitempty"`
	LatestFinalMessageAt    any             `json:"latestFinalMessageAt,omitempty"`
	LatestProgressMessage   string          `json:"latestProgressMessage,omitempty"`
	LatestProgressMessageAt any             `json:"latestProgressMessageAt,omitempty"`
	RecentMessages          []ThreadMessage `json:"recentMessages,omitempty"`
	IsGenerating            bool            `json:"isGenerating"`
	WaitingOnApproval       bool            `json:"waitingOnApproval"`
	WaitingOnUserInput      bool            `json:"waitingOnUserInput"`
}

type Metrics struct {
	TotalThreads    int `json:"totalThreads"`
	Running         int `json:"running"`
	WaitingReply    int `json:"waitingReply"`
	WaitingApproval int `json:"waitingApproval"`
	Attention       int `json:"attention"`
}

type Command struct {
	ID          string         `json:"id"`
	Status      string         `json:"status"`
	CreatedAt   string         `json:"createdAt"`
	LeasedAt    any            `json:"leasedAt"`
	CompletedAt any            `json:"completedAt"`
	Action      map[string]any `json:"action"`
	Result      any            `json:"result"`
}

type Notification struct {
	ID              string `json:"id"`
	Type            string `json:"type"`
	ThreadID        string `json:"threadId"`
	ThreadUpdatedAt any    `json:"threadUpdatedAt,omitempty"`
	Title           string `json:"title"`
	Preview         string `json:"preview,omitempty"`
	CreatedAt       string `json:"createdAt"`
	ReadAt          string `json:"readAt,omitempty"`
	DedupeKey       string `json:"dedupeKey,omitempty"`
}

type Node struct {
	ID             string         `json:"id"`
	Name           string         `json:"name"`
	DeviceKey      string         `json:"deviceKey,omitempty"`
	CreatedAt      string         `json:"createdAt,omitempty"`
	EnrolledAt     string         `json:"enrolledAt,omitempty"`
	LastSeenAt     string         `json:"lastSeenAt,omitempty"`
	Version        any            `json:"version,omitempty"`
	HeartbeatSeq   any            `json:"heartbeatSeq,omitempty"`
	CollectedAt    any            `json:"collectedAt,omitempty"`
	AgentStartedAt any            `json:"agentStartedAt,omitempty"`
	Update         any            `json:"update,omitempty"`
	RevokedAt      string         `json:"revokedAt,omitempty"`
	Tags           []string       `json:"tags,omitempty"`
	Host           any            `json:"host,omitempty"`
	Farfield       any            `json:"farfield,omitempty"`
	Metrics        map[string]any `json:"metrics,omitempty"`
	Threads        []Thread       `json:"threads,omitempty"`
	Commands       []Command      `json:"commands,omitempty"`
	Notifications  []Notification `json:"notifications,omitempty"`
	LastError      any            `json:"lastError,omitempty"`
}

type AuditEntry struct {
	ID      string         `json:"id"`
	At      string         `json:"at"`
	Type    string         `json:"type"`
	Actor   string         `json:"actor"`
	Details map[string]any `json:"details"`
}
