<#
.SYNOPSIS
  Records every remote connection made by File Browser 2's process tree during a session (NFR-1).

.DESCRIPTION
  Uses the Windows Filtering Platform audit: while it runs, the "Filtering Platform Connection"
  audit subcategory is on (success and failure), and Security-log events 5156 (allowed) and
  5157 (blocked) give the process ID, remote address, port and protocol of every TCP and UDP
  connection on the machine. Only connections from the app's own process tree count:
  the shell exe, the msedgewebview2.exe / uv / python processes it starts, and everything those
  start. Other apps' WebView2 processes and Windows services are left out; loopback is listed as
  local; EdgeUpdate (the WebView2 runtime updater) is listed under "Windows".

  Before starting the app it checks the audit really records: a loopback connection from the
  script itself must appear as a 5156 event within 10 s, or the run stops.

  The script starts the debug build (npx tauri build --debug --no-bundle) un-elevated through
  Explorer, so the app runs exactly as it would for the user. Use the app normally for the
  session. When time is up the script closes the app, writes network-check-<timestamp>.json
  and prints a summary, with a warning if WebView2, uv or python never ran or the audit was
  turned off during the run.

  It restores the previous audit policy and Security-log size afterwards, also when it fails or
  is stopped with Ctrl+C. The values to restore are kept in
  %LOCALAPPDATA%\FileBrowser2\network-check\restore.json; if the window is closed outright, the
  next run restores them first.

  Must run elevated (the audit policy and the Security log need it). Adds no dependencies.

.PARAMETER Minutes
  Length of the capture. Default 10.

.PARAMETER DryRun
  Checks the prerequisites and changes nothing. Works without elevation.

.PARAMETER Exe
  The app to start. Default: app/src-tauri/target/debug/file-browser-2.exe.

.PARAMETER OutDir
  Where the JSON goes. Default: app/src-tauri/target/network-check (git-ignored).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File app\scripts\network-check.ps1 -DryRun
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File app\scripts\network-check.ps1 -Minutes 10
#>
[CmdletBinding()]
param(
    [ValidateRange(1, 240)][int]$Minutes = 10,
    [switch]$DryRun,
    [string]$Exe,
    [string]$OutDir
)

Set-StrictMode -Version 2.0
$ErrorActionPreference = 'Stop'
# Windows PowerShell 5.1 otherwise writes some arrays as {"value": [...], "Count": n}.
Remove-TypeData System.Array -ErrorAction SilentlyContinue

$AppDir = Split-Path -Parent $PSScriptRoot
if (-not $Exe) { $Exe = Join-Path $AppDir 'src-tauri\target\debug\file-browser-2.exe' }
if (-not $OutDir) { $OutDir = Join-Path $AppDir 'src-tauri\target\network-check' }
$Exe = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Exe)
$OutDir = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($OutDir)
$EngineDir = Join-Path (Split-Path -Parent $AppDir) 'engine'
# Fixed, outside target/ (cargo clean) and independent of -OutDir, so a later run always finds it.
$StateFile = Join-Path $env:LOCALAPPDATA 'FileBrowser2\network-check\restore.json'

# "Filtering Platform Connection" by GUID, so auditpol works on any Windows display language.
$AuditGuid = '{0CCE9226-69AE-11D9-BED3-505054503030}'
$LogBytesDuringRun = 1GB
$PollSeconds = 1
$SaveEverySeconds = 30
$CloseGraceSeconds = 15

# The app's tree: the root exe plus only these images below it. Anything else the app starts
# (the default app for an opened file, for example) is someone else's program and is not counted.
$TreeImages = @('msedgewebview2.exe', 'uv.exe', 'python.exe', 'pythonw.exe')
$UpdaterImages = @('microsoftedgeupdate.exe', 'msedgeupdate.exe', 'microsoftedgeupdatecore.exe', 'edgeupdate.exe')
$WebViewImage = 'msedgewebview2.exe'

# ---------------------------------------------------------------- helpers

function Test-Elevated {
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-WindowsVersion {
    $v = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
    $name = [string]$v.ProductName
    # ProductName still says "Windows 10" on Windows 11; the build number tells them apart.
    if ([int]$v.CurrentBuild -ge 22000) { $name = $name -replace 'Windows 10', 'Windows 11' }
    $display = ''
    if ($v.PSObject.Properties['DisplayVersion']) { $display = " $($v.DisplayVersion)" }
    return "$name$display (build $($v.CurrentBuild).$($v.UBR))"
}

function Get-WebView2Version {
    $client = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
    foreach ($key in @(
            "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$client",
            "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$client",
            "HKCU:\SOFTWARE\Microsoft\EdgeUpdate\Clients\$client")) {
        $item = Get-ItemProperty $key -ErrorAction SilentlyContinue
        if ($item -and $item.PSObject.Properties['pv'] -and $item.pv -and $item.pv -ne '0.0.0.0') { return [string]$item.pv }
    }
    return $null
}

# Our subcategory's value from the lines of an `auditpol /backup` file: 0 none, 1 success,
# 2 failure, 3 both. Throws when the row is missing or unreadable: guessing 0 would make the
# restore turn off an audit that was on.
function ConvertFrom-AuditBackup([string[]]$lines) {
    # Own headers: the file's own header row may be localized.
    $rows = $lines | Select-Object -Skip 1 |
        ConvertFrom-Csv -Header Machine, Target, Subcategory, Guid, Inclusion, Exclusion, Value
    $row = @($rows | Where-Object { $_.Guid -eq $AuditGuid })
    if ($row.Count -eq 0) { throw "auditpol /backup has no row for $AuditGuid (Filtering Platform Connection)" }
    $value = [string]$row[0].Value
    if ($value -notmatch '^\s*[0-3]\s*$') { throw "auditpol /backup has an unreadable value '$value' for $AuditGuid" }
    return [int]$value
}

function Get-AuditSetting {
    $tmp = Join-Path $env:TEMP ("fb2-auditpol-{0}.csv" -f [guid]::NewGuid())
    try {
        $null = & auditpol.exe /backup "/file:$tmp"
        if ($LASTEXITCODE -ne 0) { throw "auditpol /backup failed (exit $LASTEXITCODE)" }
        return ConvertFrom-AuditBackup @(Get-Content -LiteralPath $tmp)
    }
    finally {
        Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue
    }
}

function Set-AuditSetting([int]$value) {
    $success = if ($value -band 1) { 'enable' } else { 'disable' }
    $failure = if ($value -band 2) { 'enable' } else { 'disable' }
    $null = & auditpol.exe /set "/subcategory:$AuditGuid" "/success:$success" "/failure:$failure"
    if ($LASTEXITCODE -ne 0) { throw "auditpol /set failed (exit $LASTEXITCODE)" }
}

function Get-SecurityLogConfig {
    return New-Object System.Diagnostics.Eventing.Reader.EventLogConfiguration('Security')
}

function Set-SecurityLogSize([long]$bytes) {
    try {
        $config = Get-SecurityLogConfig
        $config.MaximumSizeInBytes = $bytes
        $config.SaveChanges()
    }
    catch {
        # Security is a classic log; its size also lives in the registry.
        Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Services\EventLog\Security' -Name MaxSize -Value ([int]$bytes) -Type DWord
    }
}

function Save-State($state) {
    $dir = Split-Path -Parent $StateFile
    if (-not (Test-Path -LiteralPath $dir)) { $null = New-Item -ItemType Directory -Path $dir }
    $state | ConvertTo-Json | Set-Content -LiteralPath $StateFile -Encoding UTF8
}

# Puts back what a run changed. Returns a record of what was restored and whether it matches.
function Restore-Settings($state) {
    $result = [ordered]@{ auditBefore = $state.auditBefore; auditAfter = $null; logBytesBefore = $state.logBytesBefore; logBytesAfter = $null; ok = $true; problems = @() }
    if ($state.auditChanged) {
        try { Set-AuditSetting ([int]$state.auditBefore) } catch { $result.problems += "audit policy: $($_.Exception.Message)" }
    }
    try { $result.auditAfter = Get-AuditSetting } catch { $result.problems += "audit policy check: $($_.Exception.Message)" }
    if ($state.logChanged) {
        try { Set-SecurityLogSize ([long]$state.logBytesBefore) } catch { $result.problems += "Security log size: $($_.Exception.Message)" }
    }
    try { $result.logBytesAfter = (Get-SecurityLogConfig).MaximumSizeInBytes } catch { $result.problems += "Security log size check: $($_.Exception.Message)" }
    if ($result.auditAfter -ne $state.auditBefore) { $result.problems += "audit policy is $($result.auditAfter), was $($state.auditBefore)" }
    if ($result.logBytesAfter -ne $state.logBytesBefore) { $result.problems += "Security log size is $($result.logBytesAfter), was $($state.logBytesBefore)" }
    $result.ok = ($result.problems.Count -eq 0)
    if ($result.ok) { Remove-Item -LiteralPath $StateFile -Force -ErrorAction SilentlyContinue }
    return $result
}

function Test-LocalAddress([string]$ip) {
    $ip = $ip.Trim()
    if ($ip -match '^::ffff:(\d+\.\d+\.\d+\.\d+)$') { $ip = $Matches[1] }
    return ($ip -match '^127\.' -or $ip -eq '::1' -or $ip -eq '0.0.0.0' -or $ip -eq '::')
}

function Get-ProtocolName([int]$number) {
    switch ($number) { 6 { 'TCP' } 17 { 'UDP' } 1 { 'ICMP' } 58 { 'ICMPv6' } default { "IP-$number" } }
}

# The Chromium process role from a msedgewebview2.exe command line ("browser", "renderer",
# "utility:network.mojom.NetworkService", ...). The command line itself is not kept: it holds user paths.
function Get-Role([string]$name, [string]$commandLine) {
    if ($name -ne $WebViewImage) { return $null }
    if (-not $commandLine) { return 'unknown' }
    if ($commandLine -notmatch '--type=(\S+)') { return 'browser' }
    $role = $Matches[1].Trim('"')
    if ($commandLine -match '--utility-sub-type=(\S+)') { $role = "${role}:$($Matches[1].Trim('"'))" }
    return $role
}

function Get-NewestRecordId {
    $query = New-Object System.Diagnostics.Eventing.Reader.EventLogQuery('Security', [System.Diagnostics.Eventing.Reader.PathType]::LogName)
    $query.ReverseDirection = $true
    $reader = New-Object System.Diagnostics.Eventing.Reader.EventLogReader($query)
    try {
        $ev = $reader.ReadEvent()
        if ($ev) { try { return [long]$ev.RecordId } finally { $ev.Dispose() } }
        return 0
    }
    finally { $reader.Dispose() }
}

# True when the Security log holds a 5156 from this PowerShell process for the given local port.
function Find-OwnConnectionEvent([int]$port, [long]$afterRecordId) {
    $xpath = "*[System[EventID=5156 and EventRecordID > $afterRecordId]] and *[EventData[Data[@Name='ProcessID']='$PID']]"
    $query = New-Object System.Diagnostics.Eventing.Reader.EventLogQuery('Security', [System.Diagnostics.Eventing.Reader.PathType]::LogName, $xpath)
    $reader = New-Object System.Diagnostics.Eventing.Reader.EventLogReader($query)
    try {
        while ($true) {
            $ev = $reader.ReadEvent()
            if (-not $ev) { return $false }
            try {
                if ([int](Get-Field $ev 'DestPort') -eq $port -or [int](Get-Field $ev 'SourcePort') -eq $port) { return $true }
            }
            finally { $ev.Dispose() }
        }
    }
    finally { $reader.Dispose() }
}

# Positive control: a loopback TCP connection from this script must show up as a 5156 event,
# or the audit isn't recording and a "0 connections" result would mean nothing.
function Test-AuditRecording([int]$timeoutSeconds = 10) {
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try {
        $port = $listener.LocalEndpoint.Port
        $client = New-Object System.Net.Sockets.TcpClient
        try { $client.Connect([System.Net.IPAddress]::Loopback, $port) } finally { $client.Close() }
    }
    finally { $listener.Stop() }
    $script:auditSelfTest = [ordered]@{ ok = $false; port = $port; waitedSeconds = 0 }
    for ($i = 0; $i -le $timeoutSeconds * 2; $i++) {
        if (Find-OwnConnectionEvent $port ($capture.firstRecordId - 1)) {
            $auditSelfTest.ok = $true
            $auditSelfTest.waitedSeconds = $i / 2
            return $auditSelfTest
        }
        Start-Sleep -Milliseconds 500
    }
    $auditSelfTest.waitedSeconds = $timeoutSeconds
    throw "the audit is not recording connections (no 5156 event for the self-test connection within $timeoutSeconds s)"
}

# CreationDate as text, so tree records can be compared with live processes and written to JSON.
function Format-Created($p) {
    if ($p.CreationDate) { return ([datetime]$p.CreationDate).ToString('o') }
    return ''
}

# Stops the tree processes that are still running: only PIDs whose live process has the
# recorded image and CreationDate, so a reused PID is never touched.
function Stop-TreeProcesses {
    $liveById = @{}
    foreach ($p in @(Get-CimInstance Win32_Process -Property ProcessId, Name, CreationDate)) { $liveById[[long]$p.ProcessId] = $p }
    foreach ($rec in @($tree.Values)) {
        $p = $liveById[[long]$rec.pid]
        if ($p -and ([string]$p.Name).ToLowerInvariant() -eq $rec.name -and (Format-Created $p) -eq $rec.creationDate) {
            Stop-Process -Id $rec.pid -Force -ErrorAction SilentlyContinue
        }
    }
}

function Hide-UserProfile($text) {
    if ($null -eq $text -or -not $env:USERPROFILE) { return $text }
    return [regex]::Replace([string]$text, [regex]::Escape($env:USERPROFILE), '%USERPROFILE%', 'IgnoreCase')
}

# ---------------------------------------------------------------- prerequisites

function Get-Prerequisites {
    $checks = New-Object System.Collections.ArrayList
    $add = { param($name, $ok, $detail) $null = $checks.Add([pscustomobject]@{ Check = $name; OK = [bool]$ok; Detail = $detail }) }

    $elevated = Test-Elevated
    & $add 'Running as administrator' $elevated $(if ($elevated) { 'yes' } else { 'no - start PowerShell with "Run as administrator"' })

    $build = 0
    try { $build = [int](Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').CurrentBuild } catch {}
    & $add 'Windows 11' ($build -ge 22000) (Get-WindowsVersion)

    $wv = Get-WebView2Version
    & $add 'WebView2 runtime' ([bool]$wv) $(if ($wv) { $wv } else { 'not found' })

    $exeOk = Test-Path -LiteralPath $Exe -PathType Leaf
    $exeDetail = 'not found - build it with: cd app; npx tauri build --debug --no-bundle'
    if ($exeOk) { $item = Get-Item -LiteralPath $Exe; $exeDetail = "$Exe (built $($item.LastWriteTime.ToString('yyyy-MM-dd HH:mm')))" }
    & $add 'Debug build' $exeOk $exeDetail

    $running = @(Get-CimInstance Win32_Process -Filter "Name = 'file-browser-2.exe'" -ErrorAction SilentlyContinue)
    & $add 'App not already running' ($running.Count -eq 0) $(if ($running.Count) { 'close File Browser 2 first' } else { 'yes' })

    $uv = Get-Command uv -ErrorAction SilentlyContinue
    & $add 'uv on PATH' ([bool]$uv) $(if ($uv) { $uv.Source } else { 'not found' })

    $venv = Test-Path -LiteralPath (Join-Path $EngineDir '.venv')
    & $add 'Engine environment synced' $venv $(if ($venv) { 'engine\.venv present (uv run --offline needs it)' } else { 'run: cd engine; uv sync' })

    $dns = [bool](Get-Command Get-DnsClientCache -ErrorAction SilentlyContinue)
    & $add 'Get-DnsClientCache available' $dns $(if ($dns) { 'yes' } else { 'no - hostnames will be missing' })

    if ($elevated) {
        try { $a = Get-AuditSetting; & $add 'Audit policy readable' $true "Filtering Platform Connection = $a (0 none, 1 success, 2 failure, 3 both)" }
        catch { & $add 'Audit policy readable' $false $_.Exception.Message }
        try { $c = Get-SecurityLogConfig; & $add 'Security log readable' $true ("max size {0:N0} MB" -f ($c.MaximumSizeInBytes / 1MB)) }
        catch { & $add 'Security log readable' $false $_.Exception.Message }
    }
    else {
        & $add 'Audit policy readable' $false 'needs administrator'
        & $add 'Security log readable' $false 'needs administrator'
    }

    $leftover = Test-Path -LiteralPath $StateFile
    & $add 'No unrestored earlier run' (-not $leftover) $(if ($leftover) { "found $StateFile - the next elevated run restores it first" } else { 'yes' })

    return $checks
}


function Update-Tree {
    $procs = @(Get-CimInstance Win32_Process -Property ProcessId, ParentProcessId, Name, CommandLine, CreationDate)
    $now = (Get-Date).ToString('o')
    $byPid = @{}
    foreach ($p in $procs) { $byPid[[long]$p.ProcessId] = $p }
    $alive = @{}
    # Seeds: the root, by PID, image and CreationDate; and every tree process seen before that is
    # still the same process (same PID, image, CreationDate), even when its parent has gone.
    foreach ($p in $procs) {
        $procId = [long]$p.ProcessId
        $name = ([string]$p.Name).ToLowerInvariant()
        $created = Format-Created $p
        $isRoot = $procId -eq $rootPid -and $name -eq $rootName -and $created -eq $rootCreated
        $isKnown = $tree.ContainsKey($procId) -and $tree[$procId].name -eq $name -and $tree[$procId].creationDate -eq $created
        if ($isRoot -or $isKnown) { $alive[$procId] = $true }
    }
    # Descendants. Below the root only the tree images count: a file's default app also starts
    # there. Below any other tree process (WebView2, uv, the engine's python) everything counts.
    $changed = $true
    while ($changed) {
        $changed = $false
        foreach ($p in $procs) {
            $procId = [long]$p.ProcessId
            $parentId = [long]$p.ParentProcessId
            $name = ([string]$p.Name).ToLowerInvariant()
            if ($alive.ContainsKey($parentId) -and -not $alive.ContainsKey($procId) -and $byPid.ContainsKey($parentId) -and
                $p.CreationDate -ge $byPid[$parentId].CreationDate) {
                if ($parentId -ne $rootPid -or $TreeImages -contains $name) { $alive[$procId] = $true; $changed = $true }
                else { $excluded[$name] = $true }
            }
        }
    }
    $script:aliveNow = @($alive.Keys)
    foreach ($procId in $alive.Keys) {
        $p = $byPid[$procId]
        if (-not $tree.ContainsKey($procId) -or $tree[$procId].creationDate -ne (Format-Created $p)) {
            $tree[$procId] = [ordered]@{
                pid = $procId; parentPid = [long]$p.ParentProcessId; name = ([string]$p.Name).ToLowerInvariant()
                role = (Get-Role ([string]$p.Name).ToLowerInvariant() ([string]$p.CommandLine))
                creationDate = (Format-Created $p); firstSeen = $now; lastSeen = $now
            }
        }
        else { $tree[$procId].lastSeen = $now }
    }
    # EdgeUpdate and everything below it count as Windows.
    $upd = @{}
    foreach ($p in $procs) { if ($UpdaterImages -contains ([string]$p.Name).ToLowerInvariant()) { $upd[[long]$p.ProcessId] = $true } }
    $changed = $true
    while ($changed) {
        $changed = $false
        foreach ($p in $procs) {
            if ($upd.ContainsKey([long]$p.ParentProcessId) -and -not $upd.ContainsKey([long]$p.ProcessId)) { $upd[[long]$p.ProcessId] = $true; $changed = $true }
        }
    }
    foreach ($procId in $upd.Keys) { $updater[$procId] = ([string]$byPid[$procId].Name).ToLowerInvariant() }
    return $alive.Count
}

function Update-DnsNames {
    if (-not (Get-Command Get-DnsClientCache -ErrorAction SilentlyContinue)) { return }
    foreach ($entry in @(Get-DnsClientCache -ErrorAction SilentlyContinue)) {
        if (($entry.Type -eq 1 -or $entry.Type -eq 28) -and $entry.Data) {
            $ip = [string]$entry.Data
            if (-not $dnsNames.ContainsKey($ip)) { $dnsNames[$ip] = @{} }
            $dnsNames[$ip][[string]$entry.Entry] = $true
        }
    }
}

function Get-Field($ev, [string]$name) {
    $id = $ev.Id
    if (-not $fieldIndex.ContainsKey($id)) {
        $xml = [xml]$ev.ToXml()
        $map = @{}
        $i = 0
        foreach ($d in $xml.Event.EventData.Data) { if ($d -is [System.Xml.XmlElement]) { $map[[string]$d.GetAttribute('Name')] = $i }; $i++ }
        # The documented 5156/5157 layout, in case the event carries no field names.
        $documented = @('ProcessID', 'Application', 'Direction', 'SourceAddress', 'SourcePort', 'DestAddress', 'DestPort', 'Protocol')
        for ($j = 0; $j -lt $documented.Count; $j++) { if (-not $map.ContainsKey($documented[$j])) { $map[$documented[$j]] = $j } }
        $fieldIndex[$id] = $map
    }
    return $ev.Properties[$fieldIndex[$id][$name]].Value
}

function Add-Endpoint([string]$category, $c, $role) {
    $key = "$category|$($c.process)|$role|$($c.remote)|$($c.port)|$($c.protocol)|$($c.direction)|$($c.result)"
    if (-not $endpoints.ContainsKey($key)) {
        $endpoints[$key] = [ordered]@{
            category = $category; process = $c.process; role = $role; remote = $c.remote; port = $c.port; protocol = $c.protocol
            direction = $c.direction; result = $c.result; count = 0; first = $c.when; last = $c.when; hosts = @()
        }
    }
    $endpoints[$key].count++
    $endpoints[$key].last = $c.when
}

# Sorts connections into app / local / windows / other WebView2. A connection from a tree image
# (msedgewebview2, uv, python) whose process the tree poll hasn't seen yet waits a couple of polls,
# so a process that starts and connects between two polls is still attributed. -Final sorts everything.
function Resolve-Pending([switch]$Final) {
    $keep = New-Object System.Collections.ArrayList
    foreach ($c in $pending) {
        $c.polls++
        # A tree record counts for an event only while that process can still have made it:
        # alive at the last poll, or last seen no more than one poll before the event.
        $isTree = $false
        if ($tree.ContainsKey($c.pid) -and $tree[$c.pid].name -eq $c.process) {
            $rec = $tree[$c.pid]
            $isTree = ($aliveNow -contains $c.pid) -or ([datetime]$c.when -le ([datetime]$rec.lastSeen).AddSeconds($PollSeconds + 1))
        }
        if ($isTree) {
            $category = if (Test-LocalAddress $c.remote) { 'local' } else { 'app' }
            Add-Endpoint $category $c $tree[$c.pid].role
        }
        elseif ($updater.ContainsKey($c.pid) -or $UpdaterImages -contains $c.process) {
            Add-Endpoint 'windows' $c $null
        }
        elseif (-not $Final -and $c.polls -lt 3) {
            $null = $keep.Add($c)
        }
        elseif ($c.process -eq $WebViewImage) {
            $otherWebView.events++; $otherWebView.pids[$c.pid] = $true
        }
    }
    $script:pending = $keep
}

# Turns one 5156/5157 event into a pending connection, when it can belong to the app tree or EdgeUpdate.
function Add-EventConnection($ev) {
    $capture.eventsRead++
    $capture.lastRecordId = [long]$ev.RecordId
    $procId = [long](Get-Field $ev 'ProcessID')
    $application = [string](Get-Field $ev 'Application')
    $process = $application.Substring($application.LastIndexOf('\') + 1).ToLowerInvariant()
    $interesting = $tree.ContainsKey($procId) -or $updater.ContainsKey($procId) -or
        $UpdaterImages -contains $process -or $TreeImages -contains $process
    if (-not $interesting) { return }
    $dirCode = [string](Get-Field $ev 'Direction')
    $null = $pending.Add([pscustomobject]@{
            pid = $procId; process = $process; polls = 0; when = $ev.TimeCreated.ToString('o')
            remote = [string](Get-Field $ev 'DestAddress')
            port = [int](Get-Field $ev 'DestPort')
            protocol = Get-ProtocolName ([int](Get-Field $ev 'Protocol'))
            direction = $(if ($dirCode -match '14592') { 'inbound' } elseif ($dirCode -match '14593') { 'outbound' } else { $dirCode })
            result = $(if ($ev.Id -eq 5156) { 'allowed' } else { 'blocked' })
        })
}

function Read-NewEvents {
    $after = $capture.lastRecordId
    $xpath = "*[System[(EventID=5156 or EventID=5157) and EventRecordID > $after]]"
    $query = New-Object System.Diagnostics.Eventing.Reader.EventLogQuery('Security', [System.Diagnostics.Eventing.Reader.PathType]::LogName, $xpath)
    $reader = New-Object System.Diagnostics.Eventing.Reader.EventLogReader($query)
    try {
        while ($true) {
            $ev = $reader.ReadEvent()
            if (-not $ev) { break }
            try { Add-EventConnection $ev }
            finally { $ev.Dispose() }
        }
    }
    finally { $reader.Dispose() }
}

function Write-Results {
    foreach ($e in $endpoints.Values) {
        if ($dnsNames.ContainsKey($e.remote)) { $e.hosts = @($dnsNames[$e.remote].Keys | Sort-Object) }
    }
    $all = @($endpoints.Values | Sort-Object { $_.category }, { -$_.count })
    $app = @($all | Where-Object { $_.category -eq 'app' })
    $exeItem = Get-Item -LiteralPath $Exe -ErrorAction SilentlyContinue
    # Was every part of the app measured? Each must have been in the tree at some point.
    $treeNames = @($tree.Values | ForEach-Object { $_.name })
    $components = [ordered]@{}
    foreach ($image in @('msedgewebview2.exe', 'uv.exe', 'python.exe')) { $components[$image] = ($treeNames -contains $image) }
    $complete = -not ($components.Values -contains $false)
    # Error and restore texts can quote paths under the user's profile.
    $restoreOut = $null
    if ($restore) {
        $restoreOut = [ordered]@{}
        foreach ($k in $restore.Keys) { $restoreOut[$k] = $restore[$k] }
        $restoreOut.problems = @($restore.problems | ForEach-Object { Hide-UserProfile $_ })
    }
    $report = [ordered]@{
        script = 'app/scripts/network-check.ps1'
        startedAt = $startedAt.ToString('o')
        endedAt = (Get-Date).ToString('o')
        minutesPlanned = $Minutes
        endedEarly = $endedEarly
        interrupted = $interrupted
        error = (Hide-UserProfile $errorText)
        warnings = @($warnings | ForEach-Object { Hide-UserProfile $_ })
        auditSelfTest = $auditSelfTest
        auditAtEnd = $auditAtEnd
        components = $components
        build = [ordered]@{
            command = 'npx tauri build --debug --no-bundle'
            exe = (Split-Path -Leaf $Exe)
            builtAt = $(if ($exeItem) { $exeItem.LastWriteTime.ToString('o') } else { $null })
            sizeBytes = $(if ($exeItem) { $exeItem.Length } else { $null })
        }
        versions = [ordered]@{ windows = (Get-WindowsVersion); webview2 = (Get-WebView2Version) }
        method = 'WFP audit: Security events 5156 (allowed) and 5157 (blocked), attributed by process ID to the app tree'
        capture = $capture
        summary = [ordered]@{
            complete = $complete
            appConnections = $app.Count
            appEvents = [int]($app | ForEach-Object -Begin { $n = 0 } -Process { $n += $_.count } -End { $n })
            localEndpoints = @($all | Where-Object { $_.category -eq 'local' }).Count
            windowsEndpoints = @($all | Where-Object { $_.category -eq 'windows' }).Count
            otherWebView2Events = $otherWebView.events
            otherWebView2Processes = $otherWebView.pids.Count
        }
        app = $app
        local = @($all | Where-Object { $_.category -eq 'local' })
        windows = @($all | Where-Object { $_.category -eq 'windows' })
        tree = @($tree.Values | Sort-Object { $_.firstSeen }, { $_.pid })
        notInTree = @($excluded.Keys | Sort-Object)
        restore = $restoreOut
    }
    if (-not (Test-Path -LiteralPath $OutDir)) { $null = New-Item -ItemType Directory -Path $OutDir }
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $OutFile -Encoding UTF8
    return $report
}

# ---------------------------------------------------------------- run

# The run's state lives at script scope: the helpers above read it and the run fills it.
function Initialize-RunState {
    $script:startedAt = Get-Date
    $script:OutFile = Join-Path $OutDir ("network-check-{0}.json" -f $startedAt.ToString('yyyyMMdd-HHmmss'))

    $script:tree = @{}          # pid -> process record (the app's tree, first seen to last seen)
    $script:updater = @{}       # pid -> image name (EdgeUpdate and what it starts)
    $script:excluded = @{}      # image names the app started that are not part of the tree
    $script:endpoints = @{}     # category|process|role|remote|port|protocol|direction|result -> record
    $script:otherWebView = @{ events = 0; pids = @{} }
    $script:dnsNames = @{}      # ip -> set of hostnames
    $script:fieldIndex = @{}    # event id -> @{ fieldName = index }
    $script:pending = New-Object System.Collections.ArrayList   # connections not yet sorted (see Resolve-Pending)
    $script:aliveNow = @()      # tree PIDs alive at the last poll
    $script:capture = [ordered]@{ firstRecordId = $null; lastRecordId = $null; eventsRead = 0 }
    $script:state = [ordered]@{ auditBefore = $null; auditChanged = $false; logBytesBefore = $null; logChanged = $false }
    $script:restore = $null
    $script:warnings = New-Object System.Collections.ArrayList
    $script:auditSelfTest = $null
    $script:auditAtEnd = $null
    $script:rootPid = $null
    $script:rootName = $null       # the root's image and CreationDate: a reused PID is not the app
    $script:rootCreated = $null
    $script:endedEarly = $false
    $script:interrupted = $true    # cleared when the session reaches its normal end
    $script:errorText = $null
}

function Invoke-DryRun {
    Write-Host 'Network check - dry run (nothing is changed)'
    $checks = Get-Prerequisites
    $checks | Format-Table -AutoSize -Wrap | Out-String -Width 200 | Write-Host
    $failed = @($checks | Where-Object { -not $_.OK })
    if ($failed.Count) { Write-Host "$($failed.Count) prerequisite(s) not met."; return 1 }
    Write-Host 'All prerequisites met.'
    return 0
}

# The capture. Returns the exit code.
function Invoke-NetworkCheck {
    if (-not (Test-Elevated)) {
        Write-Host 'This check needs administrator rights. Open PowerShell with "Run as administrator" and run it again. Nothing was changed.'
        return 1
    }

    # An earlier run that was closed before it could clean up: put its settings back first.
    if (Test-Path -LiteralPath $StateFile) {
        $old = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json
        $r = Restore-Settings $old
        if (-not $r.ok) { Write-Host "Could not restore the settings from an earlier run: $($r.problems -join '; ')"; return 1 }
        Write-Host 'Restored the audit policy and Security-log size left over from an earlier run.'
    }

    $blocking = @(Get-Prerequisites | Where-Object { -not $_.OK -and $_.Check -notin @('Get-DnsClientCache available') })
    if ($blocking.Count) {
        Write-Host 'Cannot start the check. Nothing was changed.'
        $blocking | Format-Table -AutoSize -Wrap | Out-String -Width 200 | Write-Host
        return 1
    }

    Initialize-RunState
    try {
        # Record what is there before touching anything, on disk too, so a closed window can be undone.
        $state.auditBefore = Get-AuditSetting
        $state.logBytesBefore = (Get-SecurityLogConfig).MaximumSizeInBytes
        Save-State $state

        if ($state.auditBefore -ne 3) {
            $state.auditChanged = $true; Save-State $state
            Set-AuditSetting 3
        }
        if ($state.logBytesBefore -lt $LogBytesDuringRun) {
            $state.logChanged = $true; Save-State $state
            Set-SecurityLogSize $LogBytesDuringRun
        }

        $capture.firstRecordId = (Get-NewestRecordId) + 1
        $capture.lastRecordId = $capture.firstRecordId - 1
        $script:auditSelfTest = Test-AuditRecording
        Write-Host ("Audit self-test passed (loopback connection recorded after {0} s)." -f $auditSelfTest.waitedSeconds)
        Update-DnsNames

        # Explorer starts the app with the user's normal (un-elevated) rights.
        $launchedAt = Get-Date
        Start-Process -FilePath "$env:WINDIR\explorer.exe" -ArgumentList "`"$Exe`""
        $exeName = Split-Path -Leaf $Exe
        for ($i = 0; $i -lt 40 -and -not $rootPid; $i++) {
            Start-Sleep -Milliseconds 500
            $found = @(Get-CimInstance Win32_Process -Filter "Name = '$exeName'" | Where-Object { $_.ExecutablePath -eq $Exe -and $_.CreationDate -ge $launchedAt.AddSeconds(-2) })
            if ($found.Count) {
                $script:rootName = ([string]$found[0].Name).ToLowerInvariant()
                $script:rootCreated = Format-Created $found[0]
                $script:rootPid = [long]$found[0].ProcessId
            }
        }
        if (-not $rootPid) { throw "the app did not start within 20 seconds ($Exe)" }

        Write-Host ("Capturing for {0} minute(s). Use the app: browse, open files, Show in folder, F5. Ctrl+C stops early." -f $Minutes)
        $deadline = $launchedAt.AddMinutes($Minutes)
        $lastSave = Get-Date
        $lastDns = Get-Date
        while ((Get-Date) -lt $deadline) {
            $aliveCount = Update-Tree
            Read-NewEvents
            Resolve-Pending
            if (((Get-Date) - $lastDns).TotalSeconds -ge 10) { Update-DnsNames; $lastDns = Get-Date }
            if (((Get-Date) - $lastSave).TotalSeconds -ge $SaveEverySeconds) { $null = Write-Results; $lastSave = Get-Date }
            if ($aliveCount -eq 0) { $script:endedEarly = $true; Write-Host 'The app was closed; ending the capture early.'; break }
            $left = [int]($deadline - (Get-Date)).TotalSeconds
            Write-Progress -Activity 'Network check' -Status ("{0}:{1:D2} left - {2} app endpoint(s) so far" -f [int][math]::Floor($left / 60), ($left % 60), @($endpoints.Values | Where-Object { $_.category -eq 'app' }).Count)
            Start-Sleep -Seconds $PollSeconds
        }
        Write-Progress -Activity 'Network check' -Completed

        # Close the app gracefully and keep capturing through its shutdown.
        if (-not $endedEarly) {
            Write-Host 'Time is up; closing the app.'
            $root = Get-Process -Id $rootPid -ErrorAction SilentlyContinue
            if ($root -and ($root.ProcessName + '.exe') -ieq $rootName) { $null = $root.CloseMainWindow() }
            $graceEnd = (Get-Date).AddSeconds($CloseGraceSeconds)
            while ((Get-Date) -lt $graceEnd) {
                Start-Sleep -Seconds $PollSeconds
                $aliveCount = Update-Tree
                Read-NewEvents
                Resolve-Pending
                if ($aliveCount -eq 0) { break }
            }
        }
        Start-Sleep -Seconds 2   # let the last events reach the log
        $null = Update-Tree
        Read-NewEvents
        Update-DnsNames
        $script:interrupted = $false
    }
    catch {
        $script:errorText = $_.Exception.Message
        $script:interrupted = $false
        Write-Host "The check stopped: $errorText"
    }
    finally {
        # Runs on success, on error and on Ctrl+C.
        if ($rootPid) {
            try { Stop-TreeProcesses } catch { $null = $warnings.Add("could not stop the app: $($_.Exception.Message)") }
        }
        if ($null -ne $state.auditBefore) {
            try { if ($null -ne $capture.lastRecordId) { Read-NewEvents } } catch {}
            Resolve-Pending -Final
            # Still on? Group Policy or another tool could have turned the audit off mid-run.
            try { $script:auditAtEnd = Get-AuditSetting } catch { $script:auditAtEnd = $null }
            if ($auditAtEnd -ne 3) {
                $null = $warnings.Add("the audit was $auditAtEnd at the end of the run, not 3: connections after it changed were not recorded")
            }
            $script:restore = Restore-Settings $state
            if ($restore.ok) { Write-Host 'Audit policy and Security-log size restored.' }
            else { Write-Host "Restore problem: $($restore.problems -join '; '). Settings to restore are in $StateFile" }
        }
        if ($null -ne $capture.firstRecordId) {
            $report = Write-Results
            Write-Host ''
            Write-Host "Results: $OutFile"
            Write-Host ("Windows {0}; WebView2 {1}" -f $report.versions.windows, $report.versions.webview2)
            Write-Host ("App tree: {0} process(es); not counted: {1}" -f $report.tree.Count, ($report.notInTree -join ', '))
            Write-Host ("App remote connections: {0} endpoint(s), {1} event(s)" -f $report.summary.appConnections, $report.summary.appEvents)
            foreach ($e in $report.app) {
                Write-Host ("  {0} {1} {2}:{3} {4} {5} x{6} {7}" -f $e.process, $e.role, $e.remote, $e.port, $e.protocol, $e.result, $e.count, ($e.hosts -join ','))
            }
            Write-Host ("Local (loopback): {0} endpoint(s); Windows (EdgeUpdate): {1}; other apps' WebView2 events (not counted): {2}" -f $report.summary.localEndpoints, $report.summary.windowsEndpoints, $report.summary.otherWebView2Events)
            if (-not $report.summary.complete) {
                $missing = @($report.components.Keys | Where-Object { -not $report.components[$_] })
                Write-Host ("WARNING: not every part of the app was measured; never in the tree: {0}" -f ($missing -join ', '))
            }
            foreach ($w in $report.warnings) { Write-Host "WARNING: $w" }
            if ($report.interrupted) { Write-Host 'Stopped before the end: partial results.' }
        }
    }
    if ($errorText) { return 1 }
    return 0
}

# Entry point. Dot-sourcing the script (as network-check.Tests.ps1 does) loads the functions only.
if ($MyInvocation.InvocationName -ne '.') {
    # Last value only: the exit code, whatever else a step may have written to the pipeline.
    if ($DryRun) { $code = Invoke-DryRun } else { $code = Invoke-NetworkCheck }
    exit ([int]@($code)[-1])
}
