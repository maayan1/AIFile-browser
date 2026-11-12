# Pester 3.4 (ships with Windows PowerShell 5.1). Covers the I/O & edge-case matrix of Story 1.9
# with synthetic processes and 5156/5157 events: no elevation, no audit-policy or log change.
#   powershell -NoProfile -Command "Invoke-Pester app/scripts/network-check.Tests.ps1 -EnableExit"

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$scriptPath = Join-Path $here 'network-check.ps1'
. $scriptPath   # dot-sourced: loads the functions, runs nothing

$isElevated = Test-Elevated
$t0 = (Get-Date).AddMinutes(-5)
$webViewPath = '\device\harddiskvolume3\program files (x86)\microsoft\edgewebview\application\157.0.4341.46\msedgewebview2.exe'

function New-Proc([long]$procId, [long]$parentId, [string]$name, [string]$commandLine = '', $created = $null) {
    if ($null -eq $created) { $created = $t0.AddSeconds($procId / 1000) }
    [pscustomobject]@{ ProcessId = $procId; ParentProcessId = $parentId; Name = $name; CommandLine = $commandLine; CreationDate = $created; ExecutablePath = $null }
}

# The app tree used by most tests: exe 100 -> WebView2 browser 101 -> network service 102,
# exe -> uv 103 -> python 104, plus Notepad 105 (a file the user opened; not part of the tree).
function Get-AppProcs {
    @(
        (New-Proc 4 0 'System'),
        (New-Proc 100 50 'file-browser-2.exe' 'file-browser-2.exe'),
        (New-Proc 101 100 'msedgewebview2.exe' 'msedgewebview2.exe --embedded-browser-webview=1'),
        (New-Proc 102 101 'msedgewebview2.exe' 'msedgewebview2.exe --type=utility --utility-sub-type=network.mojom.NetworkService --lang=en-US'),
        (New-Proc 103 100 'uv.exe' 'uv run --offline --project engine python main.py'),
        (New-Proc 104 103 'python.exe' 'python main.py'),
        (New-Proc 105 100 'notepad.exe' 'notepad.exe notes.txt')
    )
}

# A Security event shaped like 5156 (allowed) or 5157 (blocked): named EventData fields, Properties by index.
function New-WfpEvent([long]$procId, [string]$application, [string]$remote, [int]$port = 443, [int]$protocol = 6,
    [int]$id = 5156, [string]$direction = '%%14593') {
    $names = 'ProcessID', 'Application', 'Direction', 'SourceAddress', 'SourcePort', 'DestAddress', 'DestPort', 'Protocol', 'FilterRTID', 'LayerName', 'LayerRTID', 'RemoteUserID', 'RemoteMachineID'
    $values = @($procId, $application, $direction, '192.168.1.20', 50123, $remote, $port, $protocol, 0, '%%14611', 48, 'S-1-0-0', 'S-1-0-0')
    $data = for ($i = 0; $i -lt $names.Count; $i++) { "<Data Name='$($names[$i])'>$([Security.SecurityElement]::Escape([string]$values[$i]))</Data>" }
    $script:recordId++
    $ev = [pscustomobject]@{
        Id = $id; RecordId = $script:recordId; TimeCreated = Get-Date
        Properties = @($values | ForEach-Object { [pscustomobject]@{ Value = $_ } })
        XmlText = "<Event xmlns='http://schemas.microsoft.com/win/2004/08/events/event'><System><EventID>$id</EventID></System><EventData>$($data -join '')</EventData></Event>"
    }
    $ev | Add-Member -MemberType ScriptMethod -Name ToXml -Value { $this.XmlText } -PassThru
}

# Fresh run state, output and restore file into TestDrive, a fake exe, the root of Get-AppProcs.
function Initialize-TestRun {
    $script:OutDir = Join-Path $TestDrive ([guid]::NewGuid().ToString('n'))
    $script:StateFile = Join-Path $TestDrive ("state-{0}\restore.json" -f [guid]::NewGuid().ToString('n'))
    $script:Exe = Join-Path $TestDrive 'file-browser-2.exe'
    if (-not (Test-Path -LiteralPath $Exe)) { Set-Content -LiteralPath $Exe -Value 'fake exe' }
    $script:recordId = 0
    Initialize-RunState
    $script:capture.firstRecordId = 1
    $script:capture.lastRecordId = 0
    $script:rootPid = 100
    $script:rootName = 'file-browser-2.exe'
    $script:rootCreated = $t0.AddSeconds(0.1).ToString('o')
}

function Read-Json([string]$path) { Get-Content -LiteralPath $path -Raw | ConvertFrom-Json }

# Mocks for a whole Invoke-NetworkCheck run, dot-sourced inside an It. $sim simulates the audit
# setting and the log size; $live is what Get-CimInstance returns (launch lookup and the kill step).
$runMocks = {
    Mock Test-Elevated { $true }
    Mock Get-Prerequisites { @() }
    $script:sim = @{ audit = 0; log = 20MB; tree = 0; read = 0; closed = $false; auditAfterClose = $null }
    Mock Get-AuditSetting { $sim.audit }
    Mock Set-AuditSetting { $sim.audit = $value }
    Mock Get-SecurityLogConfig { [pscustomobject]@{ MaximumSizeInBytes = $sim.log } }
    Mock Set-SecurityLogSize { $sim.log = $bytes }
    Mock Get-NewestRecordId { 100 }
    Mock Test-AuditRecording { [ordered]@{ ok = $true; port = 50000; waitedSeconds = 0.5 } }
    Mock Update-DnsNames {}
    Mock Start-Process {}
    Mock Start-Sleep {}
    Mock Write-Progress {}
    Mock Stop-Process {}
    Mock Get-Process { $null }
    $script:rootAt = Get-Date
    $script:simRoot = [pscustomobject]@{ ProcessId = 100; ParentProcessId = 50; Name = 'file-browser-2.exe'; ExecutablePath = $Exe; CreationDate = $rootAt; CommandLine = '' }
    $script:netLive = New-Proc 102 101 'msedgewebview2.exe'
    # PID 103 is alive again, as a different uv.exe: it must never be stopped.
    $script:simLive = @($simRoot, $netLive, (New-Proc 103 100 'uv.exe' '' $t0.AddHours(1)))
    $script:simAfterClose = @((New-Proc 103 100 'uv.exe' '' $t0.AddHours(1)))
    Mock Get-CimInstance { if ($sim.closed) { $simAfterClose } else { $simLive } }
    # Tree as Update-Tree would have built it: root, network service, and uv (since gone).
    $script:fillTree = {
        $now = (Get-Date).ToString('o')
        $tree[[long]100] = [ordered]@{ pid = [long]100; parentPid = [long]50; name = 'file-browser-2.exe'; role = $null; creationDate = $rootAt.ToString('o'); firstSeen = $now; lastSeen = $now }
        $tree[[long]102] = [ordered]@{ pid = [long]102; parentPid = [long]101; name = 'msedgewebview2.exe'; role = 'utility:network.mojom.NetworkService'; creationDate = (Format-Created $netLive); firstSeen = $now; lastSeen = $now }
        $tree[[long]103] = [ordered]@{ pid = [long]103; parentPid = [long]100; name = 'uv.exe'; role = $null; creationDate = $t0.ToString('o'); firstSeen = $now; lastSeen = $now }
    }
    Mock Read-NewEvents {
        $sim.read++
        if ($sim.read -eq 1) { Add-EventConnection (New-WfpEvent 102 $webViewPath '20.1.2.3') }
    }
}

Describe 'network-check.ps1' {
    Mock Get-WindowsVersion { 'Windows 11 Pro 26H2 (build 26300.9974)' }
    Mock Get-WebView2Version { '157.0.4341.46' }
    Mock Get-CimInstance { Get-AppProcs }
    Mock Get-DnsClientCache { @() }
    # Safety nets: no test may touch a real process, the audit policy or the Security log.
    Mock Stop-Process {}
    Mock Get-Process { $null }
    Mock Start-Process {}
    Mock Set-AuditSetting {}
    Mock Set-SecurityLogSize {}

    # ---- 'dot-sourcing'
        Context 'loads the functions without running a capture' {
            It 'loads the functions without running a capture' {
                Get-Command Invoke-NetworkCheck, Restore-Settings, Resolve-Pending | Should Not BeNullOrEmpty
                $AuditGuid | Should Be '{0CCE9226-69AE-11D9-BED3-505054503030}'
            }
        }

        Context 'keeps the restore file at a fixed path under LOCALAPPDATA, independent of -OutDir' {
            It 'keeps the restore file at a fixed path under LOCALAPPDATA, independent of -OutDir' {
                $out = & powershell.exe -NoProfile -Command ". '$scriptPath' -OutDir '$TestDrive\elsewhere'; `$StateFile"
                $out | Should Be (Join-Path $env:LOCALAPPDATA 'FileBrowser2\network-check\restore.json')
            }
        }

    # ---- 'clean run: no connection from the tree'
        Context 'reports 0 app connections and records the run date, build and versions' {
            It 'reports 0 app connections and records the run date, build and versions' {
                Initialize-TestRun
                (Update-Tree) | Should Be 5
                # Traffic from programs outside the tree is ignored entirely.
                Add-EventConnection (New-WfpEvent 900 '\device\harddiskvolume3\program files\other\chrome.exe' '142.250.1.1')
                Add-EventConnection (New-WfpEvent 4 'System' '20.1.1.1' 445)
                Resolve-Pending -Final
                $null = Write-Results

                $json = Read-Json $OutFile
                $json.summary.appConnections | Should Be 0
                $json.summary.appEvents | Should Be 0
                @($json.app).Count | Should Be 0
                $json.capture.eventsRead | Should Be 2
                ([datetime]$json.startedAt).Date | Should Be (Get-Date).Date
                $json.build.command | Should Be 'npx tauri build --debug --no-bundle'
                $json.build.exe | Should Be 'file-browser-2.exe'
                $json.build.builtAt | Should Not BeNullOrEmpty
                $json.build.sizeBytes | Should BeGreaterThan 0
                $json.versions.windows | Should Be 'Windows 11 Pro 26H2 (build 26300.9974)'
                $json.versions.webview2 | Should Be '157.0.4341.46'
                @($json.tree).Count | Should Be 5
                @($json.tree | ForEach-Object { $_.name }) -join ',' | Should Not Match 'notepad'
                @($json.notInTree) -contains 'notepad.exe' | Should Be $true
            }
        }

        Context 'writes no user paths or command lines into the JSON' {
            It 'writes no user paths or command lines into the JSON' {
                Initialize-TestRun
                $null = Update-Tree
                $null = Write-Results
                $text = Get-Content -LiteralPath $OutFile -Raw
                $text | Should Not Match ([regex]::Escape($TestDrive))
                $text | Should Not Match '--lang=|main\.py|notes\.txt'
            }
        }

        Context 'marks the run complete only when WebView2, uv and python were all in the tree' {
            It 'marks the run complete only when WebView2, uv and python were all in the tree' {
                Initialize-TestRun
                $null = Update-Tree
                $report = Write-Results
                $report.summary.complete | Should Be $true
                $report.components['msedgewebview2.exe'] | Should Be $true
                $report.components['uv.exe'] | Should Be $true
                $report.components['python.exe'] | Should Be $true

                Mock Get-CimInstance { @(Get-AppProcs) | Where-Object { @(103, 104) -notcontains $_.ProcessId } }
                Initialize-TestRun
                $null = Update-Tree
                $out = @(Write-Results)
                $report = $out[-1]
                $report.summary.complete | Should Be $false
                $report.components['uv.exe'] | Should Be $false
                $report.components['python.exe'] | Should Be $false
                (Read-Json $OutFile).summary.complete | Should Be $false
            }
        }

    # ---- 'the process tree'
        Context 'filters images only below the root, and includes everything below other tree processes' {
            It 'filters images only below the root, and includes everything below other tree processes' {
                Mock Get-CimInstance {
                    @(Get-AppProcs) + @(
                        (New-Proc 106 101 'crashpad_handler.exe'),   # helper under WebView2: included
                        (New-Proc 107 104 'python.exe'),             # python child of python: included
                        (New-Proc 108 107 'cmd.exe'),                # anything under the engine: included
                        (New-Proc 109 105 'splwow64.exe'))           # under Notepad: not the app
                }
                Initialize-TestRun
                (Update-Tree) | Should Be 8
                foreach ($id in 100, 101, 102, 103, 104, 106, 107, 108) { $tree.ContainsKey([long]$id) | Should Be $true }
                $tree.ContainsKey([long]105) | Should Be $false
                $tree.ContainsKey([long]109) | Should Be $false
                $excluded.ContainsKey('notepad.exe') | Should Be $true
                $tree[[long]102].creationDate | Should Be $t0.AddSeconds(0.102).ToString('o')
            }
        }

        Context 'does not seed the root from a reused PID with another image or CreationDate' {
            It 'does not seed the root from a reused PID with another image or CreationDate' {
                Mock Get-CimInstance { @((New-Proc 100 50 'notepad.exe'), (New-Proc 101 100 'msedgewebview2.exe')) }
                Initialize-TestRun
                (Update-Tree) | Should Be 0
                $tree.Count | Should Be 0

                Mock Get-CimInstance { @((New-Proc 100 50 'file-browser-2.exe' '' $t0.AddHours(1)), (New-Proc 101 100 'msedgewebview2.exe' '' $t0.AddHours(2))) }
                Initialize-TestRun
                (Update-Tree) | Should Be 0
            }
        }

        Context 'keeps an orphaned tree process alive while it is the same process' {
            It 'keeps an orphaned tree process alive while it is the same process' {
                Initialize-TestRun
                $null = Update-Tree
                # The root and the WebView2 browser have exited; the network service is still running.
                Mock Get-CimInstance { @(Get-AppProcs) | Where-Object { @(100, 101) -notcontains $_.ProcessId } }
                (Update-Tree) | Should BeGreaterThan 0
                $aliveNow -contains [long]102 | Should Be $true
                $aliveNow -contains [long]100 | Should Be $false
            }
        }

        Context 'never counts a process whose parent was created after it (a reused parent PID)' {
            It 'never counts a process whose parent was created after it (a reused parent PID)' {
                Mock Get-CimInstance { @(Get-AppProcs) + @(New-Proc 110 100 'msedgewebview2.exe' '' $t0.AddHours(-1)) }
                Initialize-TestRun
                $null = Update-Tree
                $tree.ContainsKey([long]110) | Should Be $false
            }
        }

    # ---- 'WebView2 endpoint found'
        Context 'lists a tree msedgewebview2 connection under app with process, role, port, count and DNS host' {
            It 'lists a tree msedgewebview2 connection under app with process, role, port, count and DNS host' {
                Mock Get-DnsClientCache { [pscustomobject]@{ Entry = 'smartscreen.example.net'; Type = 1; Data = '20.1.2.3' } }
                Initialize-TestRun
                $null = Update-Tree
                Update-DnsNames
                Add-EventConnection (New-WfpEvent 102 $webViewPath '20.1.2.3')
                Add-EventConnection (New-WfpEvent 102 $webViewPath '20.1.2.3')
                Resolve-Pending
                $report = Write-Results

                $report.summary.appConnections | Should Be 1
                $report.summary.appEvents | Should Be 2
                $e = $report.app[0]
                $e.category | Should Be 'app'
                $e.process | Should Be 'msedgewebview2.exe'
                $e.role | Should Be 'utility:network.mojom.NetworkService'
                $e.remote | Should Be '20.1.2.3'
                $e.port | Should Be 443
                $e.protocol | Should Be 'TCP'
                $e.direction | Should Be 'outbound'
                $e.result | Should Be 'allowed'
                $e.count | Should Be 2
                @($e.hosts) -join ',' | Should Be 'smartscreen.example.net'
                (Read-Json $OutFile).app[0].hosts[0] | Should Be 'smartscreen.example.net'
            }
        }

        Context 'lists loopback from the tree as local, not app' {
            It 'lists loopback from the tree as local, not app' {
                Initialize-TestRun
                $null = Update-Tree
                Add-EventConnection (New-WfpEvent 104 'C:\engine\.venv\Scripts\python.exe' '127.0.0.1' 1420 6 5157)
                Add-EventConnection (New-WfpEvent 102 $webViewPath '::1' 9222)
                Resolve-Pending
                $report = Write-Results
                $report.summary.appConnections | Should Be 0
                $report.summary.localEndpoints | Should Be 2
                @($report.local | Where-Object { $_.process -eq 'python.exe' })[0].result | Should Be 'blocked'
            }
        }

        Context 'lists EdgeUpdate and the WebView2 it starts under windows, not app' {
            It 'lists EdgeUpdate and the WebView2 it starts under windows, not app' {
                Mock Get-CimInstance { @(Get-AppProcs) + @((New-Proc 300 4 'MicrosoftEdgeUpdate.exe'), (New-Proc 301 300 'msedgewebview2.exe' 'msedgewebview2.exe --type=utility')) }
                Initialize-TestRun
                $null = Update-Tree
                Add-EventConnection (New-WfpEvent 300 '\device\harddiskvolume3\program files (x86)\microsoft\edgeupdate\microsoftedgeupdate.exe' '13.107.4.50')
                Add-EventConnection (New-WfpEvent 301 $webViewPath '13.107.4.51' 443 17)
                Resolve-Pending
                $report = Write-Results
                $report.summary.appConnections | Should Be 0
                $report.summary.windowsEndpoints | Should Be 2
                @($report.windows | ForEach-Object { $_.process } | Sort-Object) -join ',' | Should Be 'microsoftedgeupdate.exe,msedgewebview2.exe'
                @($report.windows | Where-Object { $_.protocol -eq 'UDP' }).Count | Should Be 1
            }
        }

    # ---- "other app's WebView2"
        Context 'does not count an msedgewebview2 outside the tree; only the otherWebView total goes up' {
            It 'does not count an msedgewebview2 outside the tree; only the otherWebView total goes up' {
                Initialize-TestRun
                $null = Update-Tree
                Add-EventConnection (New-WfpEvent 700 $webViewPath '52.1.1.1')
                Resolve-Pending
                $pending.Count | Should Be 1        # waits in case it is a tree process the poll hasn't seen
                $otherWebView.events | Should Be 0
                Resolve-Pending; Resolve-Pending
                $pending.Count | Should Be 0
                $report = Write-Results
                $report.summary.appConnections | Should Be 0
                $report.summary.otherWebView2Events | Should Be 1
                $report.summary.otherWebView2Processes | Should Be 1
                @($report.app).Count + @($report.local).Count + @($report.windows).Count | Should Be 0
            }
        }

        Context 'attributes a tree process the poll sees one or two polls late' {
            It 'attributes a tree process the poll sees one or two polls late' {
                Initialize-TestRun
                $null = Update-Tree
                Add-EventConnection (New-WfpEvent 106 $webViewPath '20.9.9.9')
                Resolve-Pending
                $endpoints.Count | Should Be 0
                Mock Get-CimInstance { @(Get-AppProcs) + @(New-Proc 106 101 'msedgewebview2.exe' 'msedgewebview2.exe --type=renderer') }
                $null = Update-Tree
                Resolve-Pending
                $report = Write-Results
                $report.summary.appConnections | Should Be 1
                $report.app[0].role | Should Be 'renderer'
                $report.summary.otherWebView2Events | Should Be 0
            }
        }

        Context 'never counts a reused PID whose image differs from the tree process' {
            It 'never counts a reused PID whose image differs from the tree process' {
                Initialize-TestRun
                $null = Update-Tree
                # PID 104 is python.exe in the tree; this event comes from a WebView2 that reused it.
                Add-EventConnection (New-WfpEvent 104 $webViewPath '52.2.2.2')
                # PID 102 is the tree's network service; this one is some other program on that PID.
                Add-EventConnection (New-WfpEvent 102 '\device\harddiskvolume3\tools\other.exe' '52.3.3.3')
                Resolve-Pending -Final
                $report = Write-Results
                $report.summary.appConnections | Should Be 0
                $report.summary.localEndpoints | Should Be 0
                $report.summary.otherWebView2Events | Should Be 1
            }
        }

        Context 'never counts a same-name reused PID after the tree process was last seen' {
            It 'never counts a same-name reused PID after the tree process was last seen' {
                Initialize-TestRun
                $null = Update-Tree
                # The network service exited an hour ago; another app's WebView2 now has PID 102.
                $tree[[long]102].lastSeen = (Get-Date).AddHours(-1).ToString('o')
                $script:aliveNow = @($aliveNow | Where-Object { $_ -ne 102 })
                Add-EventConnection (New-WfpEvent 102 $webViewPath '52.4.4.4')
                Resolve-Pending -Final
                $report = Write-Results
                $report.summary.appConnections | Should Be 0
                $report.summary.otherWebView2Events | Should Be 1
            }
        }

    # ---- 'not elevated'
        Context 'returns 1 with a plain message and changes nothing' {
            It 'returns 1 with a plain message and changes nothing' {
                Mock Test-Elevated { $false }
                Mock Get-AuditSetting { 0 }
                Mock Save-State {}
                Initialize-TestRun
                $out = @(Invoke-NetworkCheck 6>&1)
                $out[-1] | Should Be 1
                ($out -join ' ') | Should Match 'needs administrator rights.*Nothing was changed'
                Assert-MockCalled Set-AuditSetting -Scope It -Times 0 -Exactly
                Assert-MockCalled Set-SecurityLogSize -Scope It -Times 0 -Exactly
                Assert-MockCalled Get-AuditSetting -Scope It -Times 0 -Exactly
                Assert-MockCalled Save-State -Scope It -Times 0 -Exactly
                Assert-MockCalled Start-Process -Scope It -Times 0 -Exactly
                Test-Path -LiteralPath $OutDir | Should Be $false
            }
        }

        Context 'exits 1 when the script itself is run without elevation' {
            It 'exits 1 when the script itself is run without elevation' -Skip:$isElevated {
                $outDir = Join-Path $TestDrive 'child-out'
                $out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $scriptPath -Minutes 1 -OutDir $outDir 2>&1
                $LASTEXITCODE | Should Be 1
                ($out -join ' ') | Should Match 'needs administrator rights'
                Test-Path -LiteralPath $outDir | Should Be $false
            }
        }

    # ---- 'interrupted: restoring the settings'
        $before = [pscustomobject]@{ auditBefore = 1; auditChanged = $true; logBytesBefore = 20MB; logChanged = $true }

        Context 'puts back the before values, reports ok and removes the state file' {
            It 'puts back the before values, reports ok and removes the state file' {
                Mock Get-AuditSetting { 1 }
                Mock Get-SecurityLogConfig { [pscustomobject]@{ MaximumSizeInBytes = 20MB } }
                Initialize-TestRun
                Save-State $before
                Test-Path -LiteralPath $StateFile | Should Be $true

                $r = Restore-Settings $before
                $r.ok | Should Be $true
                $r.auditAfter | Should Be 1
                $r.logBytesAfter | Should Be 20MB
                Assert-MockCalled Set-AuditSetting -Scope It -Times 1 -Exactly -ParameterFilter { $value -eq 1 }
                Assert-MockCalled Set-SecurityLogSize -Scope It -Times 1 -Exactly -ParameterFilter { $bytes -eq 20MB }
                Test-Path -LiteralPath $StateFile | Should Be $false
            }
        }

        Context 'reports a problem and keeps the state file when a value does not match' {
            It 'reports a problem and keeps the state file when a value does not match' {
                Mock Get-AuditSetting { 3 }
                Mock Get-SecurityLogConfig { [pscustomobject]@{ MaximumSizeInBytes = 1GB } }
                Initialize-TestRun
                Save-State $before
                $r = Restore-Settings $before
                $r.ok | Should Be $false
                ($r.problems -join '; ') | Should Match 'audit policy is 3, was 1'
                ($r.problems -join '; ') | Should Match 'Security log size is 1073741824, was 20971520'
                Test-Path -LiteralPath $StateFile | Should Be $true
            }
        }

        Context 'touches nothing that the run did not change' {
            It 'touches nothing that the run did not change' {
                Mock Get-AuditSetting { 3 }
                Mock Get-SecurityLogConfig { [pscustomobject]@{ MaximumSizeInBytes = 2GB } }
                Initialize-TestRun
                $r = Restore-Settings ([pscustomobject]@{ auditBefore = 3; auditChanged = $false; logBytesBefore = 2GB; logChanged = $false })
                $r.ok | Should Be $true
                Assert-MockCalled Set-AuditSetting -Scope It -Times 0 -Exactly
                Assert-MockCalled Set-SecurityLogSize -Scope It -Times 0 -Exactly
            }
        }

        Context 'restores the settings, keeps partial results and stops only matching live PIDs when the run fails midway' {
            It 'restores the settings, keeps partial results and stops only matching live PIDs when the run fails midway' {
                Initialize-TestRun
                . $runMocks
                # First poll: the tree is up and the network service connects. Second poll: failure.
                Mock Update-Tree {
                    $sim.tree++
                    if ($sim.tree -gt 1) { throw 'simulated failure' }
                    . $fillTree
                    3
                }

                $out = @(Invoke-NetworkCheck 6>&1)
                $out[-1] | Should Be 1
                ($out -join ' ') | Should Match 'The check stopped: simulated failure'
                ($out -join ' ') | Should Match 'Audit policy and Security-log size restored'
                Assert-MockCalled Set-AuditSetting -Scope It -Times 1 -Exactly -ParameterFilter { $value -eq 3 }
                Assert-MockCalled Set-AuditSetting -Scope It -Times 1 -Exactly -ParameterFilter { $value -eq 0 }
                Assert-MockCalled Set-SecurityLogSize -Scope It -Times 1 -Exactly -ParameterFilter { $bytes -eq 1GB }
                Assert-MockCalled Set-SecurityLogSize -Scope It -Times 1 -Exactly -ParameterFilter { $bytes -eq 20MB }
                $sim.audit | Should Be 0
                $sim.log | Should Be 20MB
                Test-Path -LiteralPath $StateFile | Should Be $false
                # The kill runs in finally: the root and the network service, never the reused PID 103.
                Assert-MockCalled Stop-Process -Scope It -Times 1 -Exactly -ParameterFilter { $Id -eq 100 }
                Assert-MockCalled Stop-Process -Scope It -Times 1 -Exactly -ParameterFilter { $Id -eq 102 }
                Assert-MockCalled Stop-Process -Scope It -Times 0 -Exactly -ParameterFilter { $Id -eq 103 }

                $json = Read-Json $OutFile
                $json.error | Should Be 'simulated failure'
                $json.interrupted | Should Be $false
                $json.summary.appConnections | Should Be 1
                $json.app[0].remote | Should Be '20.1.2.3'
                $json.auditSelfTest.ok | Should Be $true
                $json.auditAtEnd | Should Be 3
                @($json.warnings).Count | Should Be 0
                $json.restore.ok | Should Be $true
                $json.restore.auditBefore | Should Be 0
                $json.restore.logBytesBefore | Should Be 20MB
            }
        }

        Context 'stops before launching the app when the audit self-test fails, and restores' {
            It 'stops before launching the app when the audit self-test fails, and restores' {
                Initialize-TestRun
                . $runMocks
                Mock Test-AuditRecording { throw 'the audit is not recording connections (simulated)' }
                $out = @(Invoke-NetworkCheck 6>&1)
                $out[-1] | Should Be 1
                ($out -join ' ') | Should Match 'not recording connections'
                Assert-MockCalled Start-Process -Scope It -Times 0 -Exactly
                Assert-MockCalled Stop-Process -Scope It -Times 0 -Exactly
                $sim.audit | Should Be 0
                $sim.log | Should Be 20MB
                (Read-Json $OutFile).error | Should Match 'not recording connections'
            }
        }

        Context 'writes no user-profile path from the error or restore problems' {
            It 'writes no user-profile path from the error or restore problems' {
                Initialize-TestRun
                . $runMocks
                Mock Test-AuditRecording { throw "cannot read $env:USERPROFILE\AppData\x.etl" }
                Mock Set-SecurityLogSize { if ($bytes -eq 20MB) { throw "access denied: $env:USERPROFILE\y" }; $sim.log = $bytes }
                $null = @(Invoke-NetworkCheck 6>&1)
                $text = Get-Content -LiteralPath $OutFile -Raw
                $text | Should Not Match ([regex]::Escape(($env:USERPROFILE -replace '\\', '\\')))
                $text | Should Not Match ([regex]::Escape($env:USERPROFILE))
                $json = Read-Json $OutFile
                $json.error | Should Be 'cannot read %USERPROFILE%\AppData\x.etl'
                ($json.restore.problems -join ' ') | Should Match '%USERPROFILE%\\y'
                $json.restore.ok | Should Be $false
            }
        }

        Context 'restores leftovers from a run whose window was closed before anything else' {
            It 'restores leftovers from a run whose window was closed before anything else' {
                Mock Test-Elevated { $true }
                Mock Get-AuditSetting { 1 }
                Mock Get-SecurityLogConfig { [pscustomobject]@{ MaximumSizeInBytes = 20MB } }
                Mock Get-Prerequisites { @([pscustomobject]@{ Check = 'Debug build'; OK = $false; Detail = 'stop here' }) }
                Initialize-TestRun
                Save-State $before
                $out = @(Invoke-NetworkCheck 6>&1)
                $out[-1] | Should Be 1
                ($out -join ' ') | Should Match 'Restored the audit policy'
                Assert-MockCalled Set-AuditSetting -Scope It -Times 1 -Exactly -ParameterFilter { $value -eq 1 }
                Assert-MockCalled Start-Process -Scope It -Times 0 -Exactly
                Test-Path -LiteralPath $StateFile | Should Be $false
            }
        }

    # ---- 'normal end of a run'
        Context 'ends early with exit 0 when the app is closed, and stops nothing that is not the app' {
            It 'ends early with exit 0 when the app is closed, and stops nothing that is not the app' {
                Initialize-TestRun
                . $runMocks
                Mock Update-Tree { $sim.tree++; if ($sim.tree -eq 1) { . $fillTree }; $sim.closed = $true; 0 }
                $out = @(Invoke-NetworkCheck 6>&1)
                $out[-1] | Should Be 0
                ($out -join ' ') | Should Match 'The app was closed'
                $json = Read-Json $OutFile
                $json.interrupted | Should Be $false
                $json.endedEarly | Should Be $true
                $json.error | Should BeNullOrEmpty
                $json.summary.appConnections | Should Be 1
                $json.restore.ok | Should Be $true
                # Everything has exited; PID 103 is now another uv.exe and must be left alone.
                Assert-MockCalled Stop-Process -Scope It -Times 0 -Exactly
            }
        }

        Context 'runs to the deadline, closes the app, exits 0 and stops only matching live PIDs' {
            It 'runs to the deadline, closes the app, exits 0 and stops only matching live PIDs' {
                Initialize-TestRun
                . $runMocks
                $script:Minutes = 1
                # The clock jumps 20 s per call; the root must look started after the launch.
                $script:rootAt = (Get-Date).AddHours(1)
                $simRoot.CreationDate = $rootAt
                $sim.now = Get-Date
                Mock Get-Date { $sim.now = $sim.now.AddSeconds(20); $sim.now }
                Mock Update-Tree { $sim.tree++; if ($sim.tree -eq 1) { . $fillTree }; 3 }
                $out = @(Invoke-NetworkCheck 6>&1)
                $out[-1] | Should Be 0
                ($out -join ' ') | Should Match 'Time is up'
                $json = Read-Json $OutFile
                $json.interrupted | Should Be $false
                $json.endedEarly | Should Be $false
                $json.error | Should BeNullOrEmpty
                Assert-MockCalled Stop-Process -Scope It -Times 1 -Exactly -ParameterFilter { $Id -eq 100 }
                Assert-MockCalled Stop-Process -Scope It -Times 1 -Exactly -ParameterFilter { $Id -eq 102 }
                Assert-MockCalled Stop-Process -Scope It -Times 2 -Exactly
                $script:Minutes = 10
            }
        }

        Context 'warns when the audit was turned off during the run' {
            It 'warns when the audit was turned off during the run' {
                Initialize-TestRun
                . $runMocks
                # Something (Group Policy, another tool) switches the audit to success-only mid-run.
                Mock Update-Tree { $sim.tree++; if ($sim.tree -eq 1) { . $fillTree }; $sim.audit = 1; $sim.closed = $true; 0 }
                $out = @(Invoke-NetworkCheck 6>&1)
                $out[-1] | Should Be 0
                ($out -join ' ') | Should Match 'WARNING: the audit was 1 at the end of the run'
                $json = Read-Json $OutFile
                $json.auditAtEnd | Should Be 1
                @($json.warnings)[0] | Should Match 'not 3'
                $sim.audit | Should Be 0
                $json.restore.ok | Should Be $true
            }
        }

        Context 'warns when a part of the app never ran' {
            It 'warns when a part of the app never ran' {
                Initialize-TestRun
                . $runMocks
                Mock Update-Tree { $sim.tree++; if ($sim.tree -eq 1) { . $fillTree }; $sim.closed = $true; 0 }
                $out = @(Invoke-NetworkCheck 6>&1)
                ($out -join ' ') | Should Match 'WARNING: not every part of the app was measured; never in the tree: python.exe'
                (Read-Json $OutFile).summary.complete | Should Be $false
            }
        }

    # ---- 'event fields'
        Context 'reads 5156/5157 fields by name, maps direction and protocol' {
            It 'reads 5156/5157 fields by name, maps direction and protocol' {
                Initialize-TestRun
                $null = Update-Tree
                Add-EventConnection (New-WfpEvent 102 $webViewPath '2603:1030::1' 3478 17 5157 '%%14592')
                $c = $pending[0]
                $c.pid | Should Be 102
                $c.process | Should Be 'msedgewebview2.exe'
                $c.remote | Should Be '2603:1030::1'
                $c.port | Should Be 3478
                $c.protocol | Should Be 'UDP'
                $c.direction | Should Be 'inbound'
                $c.result | Should Be 'blocked'
                $capture.lastRecordId | Should Be $recordId
            }
        }
}

# Separate block: the audit-policy functions run for real here, against a stubbed auditpol.exe.
Describe 'audit policy and self-test' {
    $header = 'Machine Name,Policy Target,Subcategory,Subcategory GUID,Inclusion Setting,Exclusion Setting,Setting Value'
    $other = 'PC,System,Filtering Platform Packet Drop,{0CCE9225-69AE-11D9-BED3-505054503030},No Auditing,,0'
    function Get-BackupLines($value) { @($header, $other, "PC,System,Filtering Platform Connection,$AuditGuid,Some Setting,,$value") }

    It 'reads value <value> for our subcategory' -TestCases @(@{ value = 0 }, @{ value = 1 }, @{ value = 2 }, @{ value = 3 }) {
        param($value)
        ConvertFrom-AuditBackup (Get-BackupLines $value) | Should Be $value
    }

    It 'throws when the subcategory row is missing' {
        { ConvertFrom-AuditBackup @($header, $other) } | Should Throw 'no row'
    }

    It 'throws when the value is empty or unreadable' {
        { ConvertFrom-AuditBackup (Get-BackupLines '') } | Should Throw 'unreadable'
        { ConvertFrom-AuditBackup (Get-BackupLines '7') } | Should Throw 'unreadable'
    }

    It 'reads the value through auditpol /backup' {
        $lines = Get-BackupLines 2
        function auditpol.exe {
            $file = ([string]($args | Where-Object { $_ -like '/file:*' })).Substring(6)
            Set-Content -LiteralPath $file -Value $lines
            $global:LASTEXITCODE = 0
        }
        Get-AuditSetting | Should Be 2
    }

    It 'maps <value> to /success:<success> /failure:<failure>' -TestCases @(
        @{ value = 0; success = 'disable'; failure = 'disable' },
        @{ value = 1; success = 'enable'; failure = 'disable' },
        @{ value = 2; success = 'disable'; failure = 'enable' },
        @{ value = 3; success = 'enable'; failure = 'enable' }) {
        param($value, $success, $failure)
        $seen = New-Object System.Collections.ArrayList
        function auditpol.exe { $null = $seen.Add(($args -join ' ')); $global:LASTEXITCODE = 0 }
        Set-AuditSetting $value
        $seen.Count | Should Be 1
        $seen[0] | Should Be "/set /subcategory:$AuditGuid /success:$success /failure:$failure"
    }

    It 'throws when auditpol /set fails' {
        function auditpol.exe { $global:LASTEXITCODE = 87 }
        { Set-AuditSetting 3 } | Should Throw 'exit 87'
    }

    Context 'self-test' {
        Mock Start-Sleep {}

        It 'passes when the loopback connection shows up as a 5156 event' {
            Initialize-RunState
            $capture.firstRecordId = 10
            $script:polls = @{ n = 0 }
            Mock Find-OwnConnectionEvent { $polls.n++; $polls.n -ge 3 }
            $r = Test-AuditRecording
            $r.ok | Should Be $true
            $r.port | Should BeGreaterThan 0
            $r.waitedSeconds | Should Be 1
            Assert-MockCalled Find-OwnConnectionEvent -Scope It -Times 1 -ParameterFilter { $afterRecordId -eq 9 -and $port -eq $r.port }
        }

        It 'throws when no event arrives' {
            Initialize-RunState
            $capture.firstRecordId = 10
            Mock Find-OwnConnectionEvent { $false }
            { Test-AuditRecording 2 } | Should Throw 'the audit is not recording connections'
            $auditSelfTest.ok | Should Be $false
            Assert-MockCalled Find-OwnConnectionEvent -Scope It -Times 5 -Exactly
        }
    }
}
