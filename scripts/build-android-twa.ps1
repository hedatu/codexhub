param(
  [string]$Manifest = "$PSScriptRoot\..\android\twa-manifest.json",
  [string]$OutputDir = "$PSScriptRoot\..\dist\android",
  [string]$Version = "0.5.1",
  [string]$ApkOutput = "",
  [string]$KeyPassword = $env:CODEXHUB_ANDROID_KEY_PASSWORD,
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"

if (-not $ApkOutput) {
  $ApkOutput = "$PSScriptRoot\..\dist\codexhub-android-v$Version.apk"
}

function Resolve-CommandOrNull($Name) {
  $command = Get-Command $Name -ErrorAction SilentlyContinue
  if ($command) { return $command.Source }
  return $null
}

function Write-Utf8NoBom($Path, $Value) {
  [IO.File]::WriteAllText((Resolve-Path -LiteralPath (Split-Path -Parent $Path)).Path + [IO.Path]::DirectorySeparatorChar + (Split-Path -Leaf $Path), $Value, [Text.UTF8Encoding]::new($false))
}

function Assert-PngFile($Path) {
  if (-not (Test-Path -LiteralPath $Path)) {
    throw "PNG file not found: $Path"
  }
  $stream = [IO.File]::OpenRead((Resolve-Path -LiteralPath $Path))
  try {
    $header = New-Object byte[] 8
    if ($stream.Read($header, 0, 8) -ne 8) {
      throw "PNG file is too small: $Path"
    }
    $expected = [byte[]](0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
    for ($i = 0; $i -lt $expected.Length; $i++) {
      if ($header[$i] -ne $expected[$i]) {
        throw "Invalid PNG signature: $Path. The file may be base64 text instead of binary PNG."
      }
    }
  } finally {
    $stream.Dispose()
  }
}

if (-not (Resolve-CommandOrNull "java.exe")) {
  throw "Java 17+ is required to build the Android TWA package."
}

if (-not (Resolve-CommandOrNull "keytool.exe")) {
  throw "keytool is required to create the Android signing key."
}

if (-not $env:ANDROID_HOME -and -not $env:ANDROID_SDK_ROOT) {
  throw "ANDROID_HOME or ANDROID_SDK_ROOT must point to an Android SDK."
}

$androidSdk = if ($env:ANDROID_HOME) { $env:ANDROID_HOME } else { $env:ANDROID_SDK_ROOT }
$sdkBin = Join-Path $androidSdk "bin"
if (-not (Test-Path -LiteralPath $sdkBin)) {
  New-Item -ItemType Directory -Force -Path $sdkBin | Out-Null
  $cmdlineBin = Join-Path $androidSdk "cmdline-tools\latest\bin"
  if (Test-Path -LiteralPath (Join-Path $cmdlineBin "sdkmanager.bat")) {
    "@echo off`r`n`"%~dp0..\cmdline-tools\latest\bin\sdkmanager.bat`" %*`r`n" |
      Set-Content -LiteralPath (Join-Path $sdkBin "sdkmanager.bat") -Encoding ASCII
    "@echo off`r`n`"%~dp0..\cmdline-tools\latest\bin\avdmanager.bat`" %*`r`n" |
      Set-Content -LiteralPath (Join-Path $sdkBin "avdmanager.bat") -Encoding ASCII
  }
}

if (-not (Resolve-CommandOrNull "bubblewrap.cmd")) {
  if ($SkipInstall) {
    throw "bubblewrap is not installed. Run: npm install -g @bubblewrap/cli"
  }
  npm install -g @bubblewrap/cli
}

New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null
$projectDir = Join-Path $OutputDir "codexhub-twa"
$keystore = Join-Path $projectDir "codexhub-release.keystore"
$credentials = Join-Path $OutputDir "codexhub-android-signing-credentials.txt"

if (-not $KeyPassword -and (Test-Path -LiteralPath $credentials)) {
  $existingCredentials = Get-Content -LiteralPath $credentials -Raw
  $match = [regex]::Match($existingCredentials, "Keystore password: (\S+)")
  if ($match.Success) {
    $KeyPassword = $match.Groups[1].Value
  }
}

if (-not $KeyPassword) {
  $bytes = New-Object byte[] 18
  [Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
  $KeyPassword = [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "A").Replace("/", "B")
}

New-Item -ItemType Directory -Force -Path $projectDir | Out-Null
if (-not (Test-Path -LiteralPath $keystore)) {
  keytool -genkeypair -v `
    -keystore $keystore `
    -storetype PKCS12 `
    -alias codexhub `
    -keyalg RSA `
    -keysize 2048 `
    -validity 10000 `
    -storepass $KeyPassword `
    -keypass $KeyPassword `
    -dname "CN=CodexHub, OU=CodexHub, O=Hedatu, L=Hong Kong, S=Hong Kong, C=HK"
}

@"
CodexHub Android signing key
Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss zzz')
Keystore: $keystore
Alias: codexhub
Keystore password: $KeyPassword
Key password: $KeyPassword

Keep this file and keystore. Future APK upgrades must use the same keystore.
"@ | Set-Content -LiteralPath $credentials -Encoding UTF8

$manifestObject = Get-Content -LiteralPath $Manifest -Raw | ConvertFrom-Json
$manifestObject.signingKey.path = "./codexhub-release.keystore"
$manifestObject.appVersionName = $Version
$manifestObject.appVersionCode = [int]($Version -replace "\D", "")
$manifestObject | Add-Member -NotePropertyName generatorApp -NotePropertyValue "bubblewrap-cli" -Force

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$localIcon = Resolve-Path (Join-Path $repoRoot "public\icon-512.png")
$localMaskableIcon = Resolve-Path (Join-Path $repoRoot "public\maskable-icon-512.png")
Assert-PngFile $localIcon
Assert-PngFile $localMaskableIcon
$manifestObject.iconUrl = "https://codexhub.local/__codexhub-icon-512.png"
$manifestObject.maskableIconUrl = "https://codexhub.local/__codexhub-maskable-icon-512.png"

$projectManifest = Join-Path $projectDir "twa-manifest.json"
Write-Utf8NoBom $projectManifest ($manifestObject | ConvertTo-Json -Depth 20)

$globalNodeModules = (npm root -g).Trim()
$bubblewrapCore = Join-Path $globalNodeModules "@bubblewrap\cli\node_modules\@bubblewrap\core"
$env:CODEXHUB_TWA_PROJECT_DIR = (Resolve-Path $projectDir)
$env:CODEXHUB_TWA_MANIFEST = (Resolve-Path $projectManifest)
$env:CODEXHUB_BUBBLEWRAP_CORE = $bubblewrapCore
$env:CODEXHUB_TWA_ICON_FILE = $localIcon
$env:CODEXHUB_TWA_MASKABLE_ICON_FILE = $localMaskableIcon

@'
const fs = require("fs");
const crypto = require("crypto");
const path = require("path");
const core = require(process.env.CODEXHUB_BUBBLEWRAP_CORE);

(async () => {
  const localIcons = new Map([
    ["https://codexhub.local/__codexhub-icon-512.png", process.env.CODEXHUB_TWA_ICON_FILE],
    ["https://codexhub.local/__codexhub-maskable-icon-512.png", process.env.CODEXHUB_TWA_MASKABLE_ICON_FILE],
  ]);
  const originalFetch = core.fetchUtils.fetch.bind(core.fetchUtils);
  core.fetchUtils.fetch = async (input) => {
    const iconPath = localIcons.get(input);
    if (!iconPath) return originalFetch(input);
    const bytes = fs.readFileSync(iconPath);
    return {
      status: 200,
      headers: {
        get(name) {
          const key = String(name).toLowerCase();
          if (key === "content-type") return "image/png";
          if (key === "content-length") return String(bytes.length);
          return null;
        },
      },
      async arrayBuffer() {
        return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
      },
    };
  };
  const projectDir = process.env.CODEXHUB_TWA_PROJECT_DIR;
  const manifestFile = process.env.CODEXHUB_TWA_MANIFEST;
  const manifest = await core.TwaManifest.fromFile(manifestFile);
  const generator = new core.TwaGenerator();
  const log = new core.BufferedLog(new core.ConsoleLog("generate"));
  await generator.removeTwaProject(projectDir);
  await generator.createTwaProject(projectDir, manifest, log, () => {});
  log.flush();
  fs.copyFileSync(manifestFile, path.join(projectDir, "twa-manifest.json"));
  const sum = crypto.createHash("sha1").update(fs.readFileSync(manifestFile)).digest("hex");
  fs.writeFileSync(path.join(projectDir, "manifest-checksum.txt"), sum);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
'@ | node
if ($LASTEXITCODE -ne 0) {
  throw "Failed to generate the Android TWA project."
}

$rootGradle = Join-Path $projectDir "build.gradle"
$rootGradleText = Get-Content -LiteralPath $rootGradle -Raw
$rootGradleText = $rootGradleText -replace "jcenter\(\)", "mavenCentral()"
$rootGradleText = $rootGradleText -replace "repositories \{\s*google\(\)\s*mavenCentral\(\)\s*\}", @"
repositories {
        maven { url 'https://maven.aliyun.com/repository/google' }
        maven { url 'https://maven.aliyun.com/repository/central' }
        google()
        mavenCentral()
    }
"@
Write-Utf8NoBom $rootGradle $rootGradleText

$appGradle = Join-Path $projectDir "app\build.gradle"
$appGradleText = Get-Content -LiteralPath $appGradle -Raw
$appGradleText = $appGradleText -replace 'versionName ""', "versionName `"$Version`""
Write-Utf8NoBom $appGradle $appGradleText

Push-Location $projectDir
try {
  if (Resolve-CommandOrNull "gradle.cmd") {
    gradle assembleRelease --no-daemon
  } else {
    .\gradlew.bat assembleRelease --no-daemon
  }
  if ($LASTEXITCODE -ne 0) {
    throw "Gradle assembleRelease failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}

$unsigned = Join-Path $projectDir "app\build\outputs\apk\release\app-release-unsigned.apk"
$aligned = Join-Path $projectDir "app-release-unsigned-aligned.apk"
$signed = Join-Path $projectDir "app-release-signed.apk"
$buildTools = Get-ChildItem -LiteralPath (Join-Path $androidSdk "build-tools") -Directory |
  Sort-Object Name -Descending |
  Select-Object -First 1
if (-not $buildTools) {
  throw "Android build-tools were not found under $androidSdk."
}
$zipalign = Join-Path $buildTools.FullName "zipalign.exe"
$apksigner = Join-Path $buildTools.FullName "apksigner.bat"

Remove-Item -LiteralPath $aligned,$signed,$ApkOutput -Force -ErrorAction SilentlyContinue
& $zipalign -p -f 4 $unsigned $aligned
if ($LASTEXITCODE -ne 0) {
  throw "zipalign failed with exit code $LASTEXITCODE."
}
& $apksigner sign --ks $keystore --ks-key-alias codexhub --ks-pass "pass:$KeyPassword" --key-pass "pass:$KeyPassword" --out $signed $aligned
if ($LASTEXITCODE -ne 0) {
  throw "apksigner failed with exit code $LASTEXITCODE."
}
$verifyOutput = & $apksigner verify --verbose --print-certs $signed 2>&1
$verifyOutput | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) {
  throw "APK signature verification failed with exit code $LASTEXITCODE."
}
Copy-Item -LiteralPath $signed -Destination $ApkOutput -Force

$digestLine = $verifyOutput | Where-Object { $_ -match "Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F]+)" } | Select-Object -First 1
if ($digestLine -match "Signer #1 certificate SHA-256 digest:\s*([0-9a-fA-F]+)") {
  $fingerprint = (($Matches[1].ToUpperInvariant() -split "(.{2})" | Where-Object { $_ }) -join ":")
  $assetLinksObject = @(
    [ordered]@{
      relation = @("delegate_permission/common.handle_all_urls")
      target = [ordered]@{
        namespace = "android_app"
        package_name = $manifestObject.packageId
        sha256_cert_fingerprints = @($fingerprint)
      }
    }
  )
  $assetLinks = ConvertTo-Json -InputObject $assetLinksObject -Depth 8
  Write-Utf8NoBom (Join-Path $repoRoot "public\.well-known\assetlinks.json") $assetLinks
  Write-Utf8NoBom (Join-Path $repoRoot "android\assetlinks.template.json") $assetLinks
  Write-Host "Android asset links fingerprint: $fingerprint"
} else {
  Write-Warning "Could not parse APK signing certificate SHA-256 fingerprint from apksigner output."
}

Write-Host "Android APK built: $ApkOutput"
Write-Host "Signing credentials: $credentials"
