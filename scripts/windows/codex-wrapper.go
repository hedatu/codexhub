//go:build codexhub_codex_wrapper
// +build codexhub_codex_wrapper

package main

import (
	"os"
	"os/exec"
	"path/filepath"
)

func main() {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		os.Stderr.WriteString("APPDATA is not set\n")
		os.Exit(1)
	}

	codexJs := filepath.Join(appData, "npm", "node_modules", "@openai", "codex", "bin", "codex.js")
	args := append([]string{codexJs}, os.Args[1:]...)
	cmd := exec.Command(resolveNode(), args...)
	cmd.Stdin = os.Stdin
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Env = os.Environ()

	if err := cmd.Run(); err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			os.Exit(exitErr.ExitCode())
		}
		os.Stderr.WriteString(err.Error() + "\n")
		os.Exit(1)
	}
}

func resolveNode() string {
	if node := os.Getenv("NODE_EXE"); node != "" {
		if _, err := os.Stat(node); err == nil {
			return node
		}
	}
	exe, err := os.Executable()
	if err == nil {
		installDir := filepath.Dir(filepath.Dir(exe))
		bundled := filepath.Join(installDir, "node-runtime", "node.exe")
		if _, err := os.Stat(bundled); err == nil {
			return bundled
		}
	}
	return "node"
}
