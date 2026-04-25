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
	cmd := exec.Command("node", args...)
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
