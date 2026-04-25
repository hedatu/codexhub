package main

import (
	"archive/zip"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

const (
	appName        = "CodexHub Companion"
)

var defaultVersion = "0.3.2"

func main() {
	version := flag.String("version", defaultVersion, "CodexHub Companion version to install")
	url := flag.String("url", "", "Companion zip URL")
	uninstall := flag.Bool("uninstall", false, "uninstall CodexHub Companion")
	noStart := flag.Bool("no-start", false, "do not start Companion after install")
	flag.Parse()

	if *uninstall {
		must(uninstallCompanion())
		fmt.Println("CodexHub Companion uninstalled.")
		return
	}

	downloadURL := *url
	if downloadURL == "" {
		downloadURL = fmt.Sprintf("https://github.com/hedatu/codexhub/releases/download/v%s/codexhub-companion-windows-x64-v%s.zip", *version, *version)
	}

	installDir := companionInstallDir()
	tmpZip := filepath.Join(os.TempDir(), fmt.Sprintf("codexhub-companion-windows-x64-v%s.zip", *version))

	fmt.Println("Downloading:", downloadURL)
	must(downloadFile(downloadURL, tmpZip))
	fmt.Println("Installing to:", installDir)
	must(os.RemoveAll(installDir))
	must(os.MkdirAll(installDir, 0755))
	must(unzip(tmpZip, installDir))
	must(setRunKey(filepath.Join(installDir, "CodexHub Companion.exe")))

	if !*noStart {
		_ = exec.Command(filepath.Join(installDir, "CodexHub Companion.exe")).Start()
	}

	fmt.Println("CodexHub Companion installed.")
}

func companionInstallDir() string {
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData == "" {
		localAppData = filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Local")
	}
	return filepath.Join(localAppData, "CodexHub Companion")
}

func must(err error) {
	if err != nil {
		fmt.Fprintln(os.Stderr, "Error:", err)
		os.Exit(1)
	}
}

func downloadFile(url, target string) error {
	client := &http.Client{Timeout: 10 * time.Minute}
	response, err := client.Get(url)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return fmt.Errorf("download failed: %s", response.Status)
	}
	file, err := os.Create(target)
	if err != nil {
		return err
	}
	defer file.Close()
	_, err = io.Copy(file, response.Body)
	return err
}

func unzip(zipPath, targetDir string) error {
	reader, err := zip.OpenReader(zipPath)
	if err != nil {
		return err
	}
	defer reader.Close()

	for _, file := range reader.File {
		target := filepath.Join(targetDir, file.Name)
		if !isInside(targetDir, target) {
			return fmt.Errorf("unsafe zip path: %s", file.Name)
		}
		if file.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0755); err != nil {
				return err
			}
			continue
		}
		if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
			return err
		}
		source, err := file.Open()
		if err != nil {
			return err
		}
		destination, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, file.Mode())
		if err != nil {
			source.Close()
			return err
		}
		_, copyErr := io.Copy(destination, source)
		closeErr := errors.Join(source.Close(), destination.Close())
		if copyErr != nil {
			return copyErr
		}
		if closeErr != nil {
			return closeErr
		}
	}
	return nil
}

func isInside(root, target string) bool {
	relative, err := filepath.Rel(root, target)
	if err != nil {
		return false
	}
	return relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !filepath.IsAbs(relative)
}

func setRunKey(exePath string) error {
	command := exec.Command("reg", "add", `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, "/v", appName, "/t", "REG_SZ", "/d", fmt.Sprintf(`"%s"`, exePath), "/f")
	return command.Run()
}

func deleteRunKey() error {
	command := exec.Command("reg", "delete", `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`, "/v", appName, "/f")
	_ = command.Run()
	return nil
}

func uninstallCompanion() error {
	_ = exec.Command("taskkill", "/IM", "CodexHub Companion.exe", "/F").Run()
	_ = deleteRunKey()
	return os.RemoveAll(companionInstallDir())
}
