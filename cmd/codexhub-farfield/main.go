package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

var version = "dev"

func main() {
	exe, _ := os.Executable()
	baseDir := filepath.Dir(filepath.Dir(exe))
	defaultRuntime := filepath.Join(baseDir, "farfield-runtime")
	defaultLogDir := filepath.Join(baseDir, "logs")
	defaultCodexCLI := filepath.Join(baseDir, "bin", "codex-wrapper.exe")
	if runtime.GOOS != "windows" {
		defaultCodexCLI = "codex"
	}

	home, _ := os.UserHomeDir()
	runtimeDir := flag.String("runtime", defaultRuntime, "Farfield runtime directory")
	port := flag.String("port", firstNonEmpty(os.Getenv("PORT"), "4311"), "Farfield port")
	codexCLI := flag.String("codex-cli", firstNonEmpty(os.Getenv("CODEX_CLI_PATH"), defaultCodexCLI), "Codex CLI executable")
	workDir := flag.String("cwd", firstNonEmpty(os.Getenv("CODEXHUB_FARFIELD_CWD"), home), "Working directory")
	logDir := flag.String("log-dir", defaultLogDir, "Log directory")
	printVersion := flag.Bool("version", false, "Print version")
	flag.Parse()

	if *printVersion {
		fmt.Println(version)
		return
	}

	if err := runFarfield(*runtimeDir, *port, *codexCLI, *workDir, *logDir); err != nil {
		_ = appendLog(*logDir, "farfield-launcher.err.log", fmt.Sprintf("%s %v\n", time.Now().Format(time.RFC3339), err))
		os.Exit(1)
	}
}

func runFarfield(runtimeDir, port, codexCLI, workDir, logDir string) error {
	if strings.TrimSpace(port) == "" {
		port = "4311"
	}
	if isPortOpen("127.0.0.1", port) {
		return nil
	}
	node, err := findNode()
	if err != nil {
		return err
	}
	cli := filepath.Join(runtimeDir, "node_modules", "@farfield", "server", "dist", "cli.js")
	if _, err := os.Stat(cli); err != nil {
		return fmt.Errorf("Farfield runtime is missing at %s", cli)
	}
	if workDir == "" {
		workDir, _ = os.UserHomeDir()
	}
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return err
	}
	stdout, err := os.OpenFile(filepath.Join(logDir, "farfield.out.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	defer stdout.Close()
	stderr, err := os.OpenFile(filepath.Join(logDir, "farfield.err.log"), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	defer stderr.Close()

	cmd := exec.Command(node, cli)
	cmd.Dir = workDir
	cmd.Env = append(os.Environ(),
		"PORT="+port,
		"CODEX_CLI_PATH="+codexCLI,
	)
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	hideConsoleWindow(cmd)
	return cmd.Run()
}

func findNode() (string, error) {
	if value := strings.TrimSpace(os.Getenv("NODE_EXE")); value != "" {
		if _, err := os.Stat(value); err == nil {
			return value, nil
		}
	}
	names := []string{"node"}
	if runtime.GOOS == "windows" {
		names = []string{"node.exe", "node"}
	}
	for _, name := range names {
		if path, err := exec.LookPath(name); err == nil {
			return path, nil
		}
	}
	return "", errors.New("Node.js 20+ is required to run bundled Farfield")
}

func isPortOpen(host, port string) bool {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, port), 500*time.Millisecond)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

func appendLog(dir, name, text string) error {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	file, err := os.OpenFile(filepath.Join(dir, name), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o644)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = io.WriteString(file, text)
	return err
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
