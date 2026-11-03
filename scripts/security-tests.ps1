# VaultDrop security test suite
# Run from the repo root with the server running:  .\scripts\security-tests.ps1

$API     = "http://localhost:4000/api"
$uploads = Join-Path $PSScriptRoot "..\server\uploads"
$tmp     = Join-Path $env:TEMP "vaultdrop-tests"
New-Item -ItemType Directory -Force $tmp | Out-Null
$testFile = Join-Path $tmp "test.txt"
"VaultDrop security test file" | Out-File -Encoding ascii $testFile
$results = @()

function Report($name, $pass, $detail) {
  $script:results += [pscustomobject]@{
    Test = $name; Result = $(if ($pass) { 'PASS' } else { 'FAIL' }); Detail = $detail
  }
}

function Upload($expiry, $cap, $passkey) {
  $curlArgs = @('-s', '-F', "expiry=$expiry", '-F', "maxDownloads=$cap")
  if ($passkey) { $curlArgs += @('-F', "passkey=$passkey") }
  $curlArgs += @('-F', "file=@$testFile", "$API/files")
  return ((& curl.exe @curlArgs) -join '') | ConvertFrom-Json
}

# POST JSON via a temp file (avoids PowerShell quote mangling). Returns Code + Body.
function PostJson($url, $obj) {
  $bodyFile = Join-Path $tmp "body.json"
  ($obj | ConvertTo-Json -Compress) | Out-File -Encoding ascii -NoNewline $bodyFile
  $out = (& curl.exe -s -w "`n%{http_code}" -X POST -H "Content-Type: application/json" --data-binary "@$bodyFile" $url) -join "`n"
  $lines = $out -split "`n"
  return [pscustomobject]@{ Code = [int]$lines[-1]; Body = ($lines[0..($lines.Length - 2)] -join "`n") }
}

function GetCode($url) { return [int](& curl.exe -s -o NUL -w "%{http_code}" $url) }

Write-Host "Running VaultDrop security tests..." -ForegroundColor Cyan

# 1. Enumeration: random tokens reveal nothing
$code = GetCode "$API/vault/abc123/status"
Report "1. Random token rejected (no enumeration)" ($code -eq 404) "HTTP $code"

# 2. Invalid options rejected
$code = [int](& curl.exe -s -o NUL -w "%{http_code}" -F expiry=5d -F maxDownloads=7 -F "file=@$testFile" "$API/files")
Report "2. Invalid expiry/cap rejected" ($code -eq 400) "HTTP $code"

# 3. Metadata hidden before passkey
$a = Upload "1h" 3 "hello"
$status = ((& curl.exe -s "$API/vault/$($a.shareToken)/status") -join '') | ConvertFrom-Json
$fields = @($status.PSObject.Properties.Name)
Report "3. Status shows no file details before unlock" (($fields.Count -eq 1) -and $status.requiresPassword) ("Fields: " + ($fields -join ', '))

# 4. Wrong passkey rejected
$r = PostJson "$API/vault/$($a.shareToken)/unlock" @{ passkey = "nope" }
Report "4. Wrong passkey rejected" ($r.Code -eq 401) "HTTP $($r.Code)"

# 5. Correct passkey unlocks and returns a session
$r = PostJson "$API/vault/$($a.shareToken)/unlock" @{ passkey = "hello" }
$unlockA = $r.Body | ConvertFrom-Json
Report "5. Correct passkey unlocks" (($r.Code -eq 200) -and $unlockA.unlockSession) "HTTP $($r.Code)"

# 6. Download works and sends nosniff; ticket cannot be reused
$hdr = Join-Path $tmp "headers.txt"
$dl  = Join-Path $tmp "download.txt"
$code = [int](& curl.exe -s -D $hdr -o $dl -w "%{http_code}" "$API/vault/$($a.shareToken)/download?ticket=$($unlockA.downloadTicket)")
$nosniff = (Get-Content $hdr) -match 'x-content-type-options:\s*nosniff'
Report "6a. Download succeeds" ($code -eq 200) "HTTP $code"
Report "6b. nosniff header sent" ([bool]$nosniff) $(if ($nosniff) { 'header present' } else { 'missing' })
$code = GetCode "$API/vault/$($a.shareToken)/download?ticket=$($unlockA.downloadTicket)"
Report "6c. Used ticket rejected" ($code -eq 403) "HTTP $code"

# 7. Fresh ticket via unlock session (no passkey)
$r = PostJson "$API/vault/$($a.shareToken)/ticket" @{ unlockSession = $unlockA.unlockSession }
Report "7. Session gives fresh ticket without passkey" ($r.Code -eq 200) "HTTP $($r.Code)"

# 8. Session from file A cannot be used on file B
$b = Upload "1h" 3 $null
$r = PostJson "$API/vault/$($b.shareToken)/ticket" @{ unlockSession = $unlockA.unlockSession }
Report "8. Session cannot be reused on another link" ($r.Code -eq 403) "HTTP $($r.Code)"

# 9. Brute force: 6th wrong attempt is rate limited
$c = Upload "1h" 1 "secret"
$codes = @()
1..6 | ForEach-Object { $codes += (PostJson "$API/vault/$($c.shareToken)/unlock" @{ passkey = "wrong$_" }).Code }
Report "9. Brute force blocked on 6th attempt" (($codes[0..4] -notcontains 429) -and ($codes[5] -eq 429)) ("Codes: " + ($codes -join ', '))

# 10. Race condition: two simultaneous downloads of a one-time file
$d = Upload "1h" 1 $null
$u = (PostJson "$API/vault/$($d.shareToken)/unlock" @{}).Body | ConvertFrom-Json
$t2 = ((PostJson "$API/vault/$($d.shareToken)/ticket" @{ unlockSession = $u.unlockSession }).Body | ConvertFrom-Json).downloadTicket
$out = (& curl.exe -s -Z -w "%{http_code}`n" `
  -o (Join-Path $tmp "race1.txt") "$API/vault/$($d.shareToken)/download?ticket=$($u.downloadTicket)" `
  -o (Join-Path $tmp "race2.txt") "$API/vault/$($d.shareToken)/download?ticket=$t2") -join ' '
$raceCodes = @([regex]::Matches($out, '\d{3}') | ForEach-Object { $_.Value })
$ok = (($raceCodes | Where-Object { $_ -eq '200' }).Count -eq 1) -and (($raceCodes | Where-Object { $_ -eq '410' }).Count -eq 1)
Report "10. One-time file: exactly one of two parallel downloads wins" $ok ("Codes: " + ($raceCodes -join ', '))

# 11. Size limit: 101MB rejected, no partial file left behind
$big = Join-Path $tmp "big.bin"
$fs = [System.IO.File]::Create($big); $fs.SetLength(101MB); $fs.Close()
$before = @(Get-ChildItem $uploads -File -ErrorAction SilentlyContinue).Count
$code = [int](& curl.exe -s -o NUL -w "%{http_code}" -F expiry=1h -F maxDownloads=1 -F "file=@$big" "$API/files")
Start-Sleep -Milliseconds 500
$after = @(Get-ChildItem $uploads -File -ErrorAction SilentlyContinue).Count
Report "11. Over-100MB upload rejected, no leftover file" (($code -eq 413) -and ($after -eq $before)) "HTTP $code, files before/after: $before/$after"
Remove-Item $big

# Summary
$results | Format-Table -AutoSize
$failed = @($results | Where-Object { $_.Result -eq 'FAIL' }).Count
if ($failed -eq 0) { Write-Host "All $($results.Count) tests passed." -ForegroundColor Green }
else { Write-Host "$failed test(s) failed." -ForegroundColor Red }