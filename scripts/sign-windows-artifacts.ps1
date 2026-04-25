param(
  [Parameter(Mandatory = $true)]
  [string[]]$Path,

  [string]$CertificateThumbprint = $env:CODEXHUB_CODESIGN_THUMBPRINT,
  [string]$PfxPath = $env:CODEXHUB_CODESIGN_PFX,
  [string]$PfxPassword = $env:CODEXHUB_CODESIGN_PFX_PASSWORD,
  [string]$TimestampServer = "http://timestamp.digicert.com"
)

$ErrorActionPreference = "Stop"

function Resolve-Certificate {
  if ($CertificateThumbprint) {
    $cert = Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My -CodeSigningCert |
      Where-Object { $_.Thumbprint -eq $CertificateThumbprint } |
      Select-Object -First 1
    if (-not $cert) {
      throw "Code signing certificate not found by thumbprint: $CertificateThumbprint"
    }
    return $cert
  }

  if ($PfxPath) {
    $secure = ConvertTo-SecureString $PfxPassword -AsPlainText -Force
    $imported = Import-PfxCertificate -FilePath $PfxPath -CertStoreLocation Cert:\CurrentUser\My -Password $secure
    return $imported
  }

  throw "Set CODEXHUB_CODESIGN_THUMBPRINT or CODEXHUB_CODESIGN_PFX before signing."
}

$certificate = Resolve-Certificate

foreach ($item in $Path) {
  $resolved = Resolve-Path -LiteralPath $item
  foreach ($file in $resolved) {
    $signature = Set-AuthenticodeSignature -FilePath $file.Path -Certificate $certificate -TimestampServer $TimestampServer -HashAlgorithm SHA256
    if ($signature.Status -ne "Valid") {
      throw "Signing failed for $($file.Path): $($signature.StatusMessage)"
    }
    $signature | Select-Object Path,Status,SignerCertificate
  }
}
