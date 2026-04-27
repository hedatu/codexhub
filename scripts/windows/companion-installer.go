//go:build codexhub_companion_installer
// +build codexhub_companion_installer

package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
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
	appName   = "CodexHub Companion"
	publisher = "Hedatu"
)

var defaultVersion = "0.4.3"

func main() {
	version := flag.String("version", defaultVersion, "CodexHub Companion version to install")
	url := flag.String("url", "", "Companion zip URL")
	sha256sum := flag.String("sha256", "", "expected SHA256 hash for the downloaded zip")
	uninstall := flag.Bool("uninstall", false, "uninstall CodexHub Companion")
	noStart := flag.Bool("no-start", false, "do not start Companion after install")
	noStartup := flag.Bool("no-startup", false, "do not register Companion to start at user login")
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
	if *sha256sum != "" {
		fmt.Println("Verifying SHA256:", *sha256sum)
		must(verifySHA256(tmpZip, *sha256sum))
	}
	fmt.Println("Installing to:", installDir)
	must(os.RemoveAll(installDir))
	must(os.MkdirAll(installDir, 0755))
	must(unzip(tmpZip, installDir))
	exePath := filepath.Join(installDir, "CodexHub Companion.exe")
	if _, err := os.Stat(exePath); err != nil {
		must(fmt.Errorf("Companion executable was not found after install: %s", exePath))
	}
	uninstallerPath, err := installUninstaller()
	must(err)
	if !*noStartup {
		must(setRunKey(exePath))
	}
	must(createStartMenuShortcut(exePath))
	must(writeUninstallEntry(*version, exePath, installDir, uninstallerPath))

	if !*noStart {
		_ = exec.Command(exePath).Start()
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

func companionInstallerDir() string {
	localAppData := os.Getenv("LOCALAPPDATA")
	if localAppData == "" {
		localAppData = filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Local")
	}
	return filepath.Join(localAppData, "CodexHub Companion Installer")
}

func startMenuShortcutPath() string {
	appData := os.Getenv("APPDATA")
	if appData == "" {
		appData = filepath.Join(os.Getenv("USERPROFILE"), "AppData", "Roaming")
	}
	return filepath.Join(appData, "Microsoft", "Windows", "Start Menu", "Programs", appName+".lnk")
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

func verifySHA256(filePath, expected string) error {
	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer file.Close()
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return err
	}
	actual := hex.EncodeToString(hash.Sum(nil))
	if !strings.EqualFold(strings.TrimSpace(expected), actual) {
		return fmt.Errorf("SHA256 mismatch: expected %s, got %s", expected, actual)
	}
	return nil
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

func installUninstaller() (string, error) {
	currentExe, err := os.Executable()
	if err != nil {
		return "", err
	}
	targetDir := companionInstallerDir()
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return "", err
	}
	target := filepath.Join(targetDir, "codexhub-companion-installer.exe")
	if samePath(currentExe, target) {
		return target, nil
	}
	source, err := os.Open(currentExe)
	if err != nil {
		return "", err
	}
	defer source.Close()
	destination, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0755)
	if err != nil {
		return "", err
	}
	_, copyErr := io.Copy(destination, source)
	closeErr := destination.Close()
	return target, errors.Join(copyErr, closeErr)
}

func samePath(left, right string) bool {
	leftAbs, leftErr := filepath.Abs(left)
	rightAbs, rightErr := filepath.Abs(right)
	if leftErr != nil || rightErr != nil {
		return false
	}
	return strings.EqualFold(leftAbs, rightAbs)
}

func createStartMenuShortcut(exePath string) error {
	shortcut := startMenuShortcutPath()
	if err := os.MkdirAll(filepath.Dir(shortcut), 0755); err != nil {
		return err
	}
	script := `$shell = New-Object -ComObject WScript.Shell; ` +
		`$shortcut = $shell.CreateShortcut($env:CODEXHUB_SHORTCUT); ` +
		`$shortcut.TargetPath = $env:CODEXHUB_EXE; ` +
		`$shortcut.WorkingDirectory = $env:CODEXHUB_WORKDIR; ` +
		`$shortcut.Description = 'CodexHub Companion'; ` +
		`$shortcut.Save()`
	command := exec.Command("powershell.exe", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script)
	command.Env = append(os.Environ(),
		"CODEXHUB_SHORTCUT="+shortcut,
		"CODEXHUB_EXE="+exePath,
		"CODEXHUB_WORKDIR="+filepath.Dir(exePath),
	)
	return command.Run()
}

func deleteStartMenuShortcut() error {
	_ = os.Remove(startMenuShortcutPath())
	return nil
}

func writeUninstallEntry(version, exePath, installDir, uninstallerPath string) error {
	key := `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\` + appName
	values := [][]string{
		{"DisplayName", "REG_SZ", appName},
		{"DisplayVersion", "REG_SZ", version},
		{"Publisher", "REG_SZ", publisher},
		{"InstallLocation", "REG_SZ", installDir},
		{"DisplayIcon", "REG_SZ", exePath},
		{"UninstallString", "REG_SZ", fmt.Sprintf(`"%s" --uninstall`, uninstallerPath)},
		{"QuietUninstallString", "REG_SZ", fmt.Sprintf(`"%s" --uninstall`, uninstallerPath)},
		{"NoModify", "REG_DWORD", "1"},
		{"NoRepair", "REG_DWORD", "1"},
	}
	for _, value := range values {
		if err := exec.Command("reg", "add", key, "/v", value[0], "/t", value[1], "/d", value[2], "/f").Run(); err != nil {
			return err
		}
	}
	return nil
}

func deleteUninstallEntry() error {
	command := exec.Command("reg", "delete", `HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\`+appName, "/f")
	_ = command.Run()
	return nil
}

func uninstallCompanion() error {
	_ = exec.Command("taskkill", "/IM", "CodexHub Companion.exe", "/F").Run()
	_ = deleteRunKey()
	_ = deleteStartMenuShortcut()
	_ = deleteUninstallEntry()
	_ = cleanupInstallerDirIfExternal()
	return os.RemoveAll(companionInstallDir())
}

func cleanupInstallerDirIfExternal() error {
	currentExe, err := os.Executable()
	if err != nil {
		return nil
	}
	if samePath(filepath.Dir(currentExe), companionInstallerDir()) {
		return nil
	}
	return os.RemoveAll(companionInstallerDir())
}
