# Windows PowerShell 5.1에서 .\deploy.test.ps1로 실행합니다. 실제 Docker와 DB는 호출하지 않습니다.
$ErrorActionPreference = 'Stop'
$testDirectory = [IO.Path]::GetFullPath((Join-Path ([IO.Path]::GetTempPath()) ('mobtwig-deploy-test-' + [Guid]::NewGuid().ToString('N'))))
$deploymentScript = Join-Path $PSScriptRoot 'deploy.ps1'
$composeFile = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'compose.yaml'))
$utf8 = New-Object Text.UTF8Encoding($false)
$originalInput = [Console]::In
$originalInputEncoding = [Console]::InputEncoding
$originalOutputEncoding = [Console]::OutputEncoding
$originalPipelineEncoding = $OutputEncoding
$originalDocker = Get-Item -LiteralPath Function:\docker -ErrorAction SilentlyContinue
$originalDockerBody = if ($null -ne $originalDocker) { $originalDocker.ScriptBlock } else { $null }
$originalDockerCommand = Get-Command docker -ErrorAction SilentlyContinue
$originalDockerCommandType = if ($null -ne $originalDockerCommand) { $originalDockerCommand.CommandType } else { $null }
$originalDockerDefinition = if ($null -ne $originalDockerCommand) { $originalDockerCommand.Definition } else { $null }
$originalDockerAlias = Get-Alias -Name docker -ErrorAction SilentlyContinue
$originalLastExitCode = Get-Variable -Name LASTEXITCODE -Scope Global -ErrorAction SilentlyContinue
$originalEnvironment = @{}
foreach ($name in @('DOCKER_CONFIG', 'DOCKER_HOST', 'API_IMAGE')) {
    $originalEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}
$assertionCount = 0
function Assert-DeploymentTest([bool]$Condition, [string]$Message) {
    $script:assertionCount++
    if (-not $Condition) { throw ('배포 자체 테스트 실패: ' + $Message) }
}
function Get-DeploymentTestCalls([string]$Kind) {
    $global:MobtwigDeploymentTest.Calls | Where-Object { $_.Kind -eq $Kind }
}

# 외부 docker 실행 파일로 넘기는 경로는 없습니다. 알 수 없는 명령도 즉시 거부합니다.
function global:docker {
    $arguments = [string[]]$args
    $pipedInput = @($input | ForEach-Object { [string]$_ })
    $s = $global:MobtwigDeploymentTest
    $command = $arguments -join ' '
    if ($arguments[0] -eq 'compose') {
        Assert-DeploymentTest ($arguments[2] -eq 'mobtwig-deploy-test') '테스트 전용 Compose 프로젝트를 사용해야 합니다.'
        Assert-DeploymentTest ($arguments[4] -eq (Join-Path $s.Root 'config\.env')) '테스트 환경 파일만 읽어야 합니다.'
        Assert-DeploymentTest ($arguments[6] -eq $s.ComposeFile) '실제 배포 Compose 파일을 사용해야 합니다.'
        $command = 'compose ' + ($arguments[7..($arguments.Count - 1)] -join ' ')
    }
    $kind = switch -Regex ($command) {
        '^login ghcr\.io --username deploy-test-actor --password-stdin$' { 'login'; break }
        '^compose config --quiet$' { 'config'; break }
        '^compose pull api$' { 'pull'; break }
        '^compose ps --all --quiet mysql$' { 'mysql-ps'; break }
        '^compose ps --all --quiet api$' { 'api-ps'; break }
        '^inspect --format \{\{\.State\.Health\.Status\}\} mock-mysql$' { 'health'; break }
        '^inspect --format \{\{\.Config\.Image\}\} mock-api$' { 'image'; break }
        '^compose stop api$' { 'stop'; break }
        '^exec -i mock-mysql sh$' { 'dump'; break }
        '^cp mock-mysql:/tmp/mobtwig-.+\.sql .+$' { 'copy'; break }
        '^exec mock-mysql rm -- /tmp/mobtwig-.+\.sql$' { 'remove-dump'; break }
        '^compose up .+ api$' { 'up'; break }
        '^compose exec -T api curl .+/actuator/health/readiness$' { 'readiness'; break }
        '^compose ps$' { 'diagnostics'; break }
        default { throw ('예상하지 않은 Docker 명령을 거부했습니다: ' + $command) }
    }
    $call = [pscustomobject]@{ Kind = $kind; Arguments = $arguments; Input = $pipedInput; Order = $s.Calls.Count }
    $s.Calls.Add($call)
    Assert-DeploymentTest ($env:DOCKER_HOST -eq $s.DockerHost) '배포 중 지정한 Docker 엔진을 사용해야 합니다.'
    Assert-DeploymentTest ($env:API_IMAGE -eq $s.Image) '배포 중 검증할 이미지가 설정되어야 합니다.'
    $registry = [IO.Path]::GetFullPath($env:DOCKER_CONFIG)
    $registryParent = [IO.Path]::GetFullPath((Join-Path $s.Root 'config'))
    Assert-DeploymentTest ((Split-Path $registry -Parent) -eq $registryParent) '인증 경로는 테스트 설정 폴더 안이어야 합니다.'
    Assert-DeploymentTest ((Split-Path $registry -Leaf) -match '^registry-[0-9a-f]{32}$') '인증 경로는 배포별 임시 폴더여야 합니다.'
    Assert-DeploymentTest ($command.IndexOf($s.Token, [StringComparison]::Ordinal) -lt 0) '인증 토큰을 CLI 인수로 전달하면 안 됩니다.'
    $global:LASTEXITCODE = 0
    switch ($kind) {
        'login' {
            Assert-DeploymentTest ($pipedInput.Count -eq 1 -and $pipedInput[0] -eq $s.Token) '로그인 토큰은 표준 입력 한 줄로만 전달해야 합니다.'
            $configPath = Join-Path $registry 'config.json'
            $config = [IO.File]::ReadAllText($configPath) | ConvertFrom-Json
            Assert-DeploymentTest (-not ($config.PSObject.Properties.Name -contains 'credsStore')) '대화형 자격 증명 저장소를 사용하면 안 됩니다.'
            $registryAuth = $config.auths.PSObject.Properties['ghcr.io']
            Assert-DeploymentTest ($null -ne $registryAuth -and @($registryAuth.Value.PSObject.Properties).Count -eq 0) '자동 자격 증명 도우미 감지를 막는 빈 ghcr.io 인증 항목이 있어야 합니다.'
            Assert-DeploymentTest (@(Get-ChildItem -LiteralPath $registry -Force).Count -eq 1) '임시 인증 폴더에는 config.json만 있어야 합니다.'
            [IO.File]::WriteAllText($configPath, '{"auths":{"ghcr.io":{"auth":"dGVzdA=="}}}', $s.Encoding)
            if ($s.Scenario -eq 'login-failure') { $global:LASTEXITCODE = 1 }
        }
        'pull' { if ($s.Scenario -eq 'pull-failure') { $global:LASTEXITCODE = 1 } }
        'mysql-ps' { 'mock-mysql' }
        'api-ps' { if ($s.Scenario -ne 'first-deploy') { 'mock-api' } }
        'health' { 'healthy' }
        'image' { $s.PreviousImage }
        'dump' {
            Assert-DeploymentTest (($pipedInput -join "`n") -match 'MYSQL_PWD=.*mysqldump.*--single-transaction') 'DB 백업 명령을 표준 입력으로 전달해야 합니다.'
            if ($s.Scenario -eq 'backup-failure') { $global:LASTEXITCODE = 1 }
        }
        'copy' {
            $backupPath = [IO.Path]::GetFullPath($arguments[-1])
            $backupPrefix = [IO.Path]::GetFullPath((Join-Path $s.Root 'backups')) + [IO.Path]::DirectorySeparatorChar
            Assert-DeploymentTest ($backupPath.StartsWith($backupPrefix, [StringComparison]::OrdinalIgnoreCase)) '모의 백업도 테스트 백업 폴더 안에만 써야 합니다.'
            $sql = '-- 테스트 SQL 백업입니다.' + "`nCREATE DATABASE deployment_test;"
            if ($s.Scenario -eq 'empty-backup') { $sql = '' }
            [IO.File]::WriteAllText($backupPath, $sql, $s.Encoding)
        }
        'up' {
            Assert-DeploymentTest ($arguments -contains '--no-deps') '기존 MySQL의 재생성을 막아야 합니다.'
            Assert-DeploymentTest ($arguments[-1] -eq 'api' -and -not ($arguments -contains 'mysql')) 'API 서비스만 기동해야 합니다.'
        }
        'readiness' {
            if ($s.Scenario -eq 'readiness-failure') { '{"status":"DOWN"}' } else { '{"status":"UP"}' }
        }
    }
}

$labels = @{
    'success' = '기존 API 배포'; 'first-deploy' = '신규 API 배포'; 'login-failure' = '로그인 실패'
    'pull-failure' = '이미지 다운로드 실패'; 'backup-failure' = '백업 명령 실패'; 'empty-backup' = '빈 백업 거부'
    'readiness-failure' = '준비 상태 실패'; 'empty-token' = '빈 인증 토큰 거부'
}
try {
    New-Item -ItemType Directory -Path $testDirectory | Out-Null
    if ($null -ne $originalDockerAlias) { Remove-Item -LiteralPath Alias:\docker -Force }
    foreach ($scenario in @('success', 'first-deploy', 'login-failure', 'pull-failure', 'backup-failure', 'empty-backup', 'readiness-failure', 'empty-token')) {
        $caseRoot = Join-Path $testDirectory $scenario
        $configDirectory = Join-Path $caseRoot 'config'
        $stateDirectory = Join-Path $caseRoot 'state'
        New-Item -ItemType Directory -Path $configDirectory, $stateDirectory | Out-Null
        [IO.File]::WriteAllText((Join-Path $configDirectory '.env'), "DB_NAME=deployment_test`nDB_USERNAME=test_user`nDB_PASSWORD=test_only_password`nDB_ROOT_PASSWORD=test_only_root_password`n", $utf8)
        $statePath = Join-Path $stateDirectory 'last-success.json'
        $priorState = '{"CommitSha":"previous","Marker":"직전 성공 기록입니다."}'
        [IO.File]::WriteAllText($statePath, $priorState, $utf8)
        $env:DOCKER_CONFIG = Join-Path $caseRoot 'previous-docker-config'
        $env:DOCKER_HOST = 'npipe:////./pipe/previous-test-engine'
        $env:API_IMAGE = 'previous-test-image'
        if ($scenario -eq 'first-deploy') {
            foreach ($name in $originalEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $null, 'Process') }
        }
        $expectedConfig = $env:DOCKER_CONFIG
        $expectedHost = $env:DOCKER_HOST
        $expectedImage = $env:API_IMAGE
        $global:MobtwigDeploymentTest = @{
            Scenario = $scenario; Root = $caseRoot; ComposeFile = $composeFile; Encoding = $utf8
            Calls = New-Object 'System.Collections.Generic.List[object]'
            Image = 'ghcr.io/example/mobtwig-server@sha256:' + ('1' * 64)
            PreviousImage = 'ghcr.io/example/mobtwig-server@sha256:' + ('2' * 64)
            Token = 'deployment-test-token-only'; DockerHost = 'npipe:////./pipe/deployment-test-engine'
        }
        $s = $global:MobtwigDeploymentTest
        $parameters = @{ ImageReference = $s.Image; CommitSha = 'a' * 40; RegistryUser = 'deploy-test-actor'; DeploymentRoot = $caseRoot; ProjectName = 'mobtwig-deploy-test' }
        if ($scenario -eq 'first-deploy') { $s.DockerHost = 'npipe:////./pipe/dockerDesktopLinuxEngine' }
        else { $parameters.DockerHost = $s.DockerHost }
        $tokenInput = $s.Token
        if ($scenario -eq 'empty-token') { $tokenInput = '   ' }
        $reader = New-Object IO.StringReader -ArgumentList ($tokenInput + "`n")
        $caughtError = $null
        [Console]::SetIn($reader)
        try { & $deploymentScript @parameters *> $null }
        catch { $caughtError = $_ }
        finally { [Console]::SetIn($originalInput); $reader.Dispose() }

        Assert-DeploymentTest ($env:DOCKER_CONFIG -eq $expectedConfig) '종료 후 DOCKER_CONFIG를 복원해야 합니다.'
        Assert-DeploymentTest ($env:DOCKER_HOST -eq $expectedHost) '종료 후 DOCKER_HOST를 복원해야 합니다.'
        Assert-DeploymentTest ($env:API_IMAGE -eq $expectedImage) '종료 후 API_IMAGE를 복원해야 합니다.'
        Assert-DeploymentTest (@(Get-ChildItem -LiteralPath $configDirectory -Directory -Filter 'registry-*').Count -eq 0) '성공과 실패 모두 임시 인증 파일과 폴더를 정리해야 합니다.'
        $stops = @(Get-DeploymentTestCalls 'stop')
        $copies = @(Get-DeploymentTestCalls 'copy')
        $starts = @(Get-DeploymentTestCalls 'up')
        $successful = $scenario -in @('success', 'first-deploy')
        if ($successful) {
            Assert-DeploymentTest ($null -eq $caughtError) ('정상 배포에 실패했습니다: ' + $caughtError)
            Assert-DeploymentTest ($stops.Count -eq 1 -and $copies.Count -eq 1 -and $starts.Count -eq 1) 'API 정지·백업·기동은 각각 한 번이어야 합니다.'
            $dump = @(Get-DeploymentTestCalls 'dump')[0]
            $cleanup = @(Get-DeploymentTestCalls 'remove-dump')[0]
            $ready = @(Get-DeploymentTestCalls 'readiness')[0]
            Assert-DeploymentTest ($stops[0].Order -lt $dump.Order -and $dump.Order -lt $copies[0].Order -and $copies[0].Order -lt $cleanup.Order -and $cleanup.Order -lt $starts[0].Order -and $starts[0].Order -lt $ready.Order) '백업 완료 후 새 API를 기동하고 준비 상태를 검사해야 합니다.'
            $record = [IO.File]::ReadAllText($statePath) | ConvertFrom-Json
            Assert-DeploymentTest ($record.CommitSha -eq $parameters.CommitSha -and $record.ImageReference -eq $s.Image) '검증한 커밋과 이미지를 성공 기록에 저장해야 합니다.'
            Assert-DeploymentTest ($record.BackupPath -eq $copies[0].Arguments[-1]) '실제 백업 파일의 경로를 저장해야 합니다.'
            Assert-DeploymentTest ((Get-Item -LiteralPath $record.BackupPath).Length -gt 0) '실제 백업 파일이 비어 있으면 안 됩니다.'
            Assert-DeploymentTest ([IO.File]::ReadAllText($record.BackupPath).Contains('CREATE DATABASE deployment_test;')) '모의 SQL 파일이 실제로 보관되어야 합니다.'
            if ($scenario -eq 'success') {
                Assert-DeploymentTest ($record.PreviousImageReference -eq $s.PreviousImage) '기존 API의 이미지도 기록해야 합니다.'
            } else {
                Assert-DeploymentTest (-not ($record.PSObject.Properties.Name -contains 'PreviousImageReference')) '신규 API 배포에 존재하지 않는 이전 이미지를 기록하면 안 됩니다.'
                Assert-DeploymentTest (@(Get-DeploymentTestCalls 'image').Count -eq 0) '신규 API 배포에서 기존 컨테이너를 inspect하면 안 됩니다.'
            }
        } else {
            Assert-DeploymentTest ($null -ne $caughtError) '의도한 실패를 성공으로 처리하면 안 됩니다.'
            Assert-DeploymentTest ([IO.File]::ReadAllText($statePath) -eq $priorState) '실패 시 직전 성공 기록을 덮어쓰면 안 됩니다.'
            $expectedError = switch ($scenario) {
                'readiness-failure' { '*UP*' }; 'empty-backup' { '*비어*' }; 'empty-token' { '*표준 입력*' }; default { '*Docker*종료 코드*' }
            }
            Assert-DeploymentTest ($caughtError.Exception.Message -like $expectedError) '예정한 단계의 실패인지 확인해야 합니다.'
            if ($scenario -in @('login-failure', 'pull-failure', 'empty-token')) {
                Assert-DeploymentTest ($stops.Count -eq 0 -and $starts.Count -eq 0) '사전 검증 실패 시 기존 API를 정지하거나 교체하면 안 됩니다.'
            }
            if ($scenario -in @('backup-failure', 'empty-backup')) {
                Assert-DeploymentTest ($stops.Count -eq 1 -and $starts.Count -eq 0) '백업 실패 후 새 API를 기동하면 안 됩니다.'
            }
            if ($scenario -eq 'readiness-failure') {
                Assert-DeploymentTest ($starts.Count -eq 1) '기동 이후 준비 상태 실패를 검증해야 합니다.'
            }
            if ($scenario -eq 'empty-token') {
                Assert-DeploymentTest ($s.Calls.Count -eq 0) '빈 토큰은 Docker 변경 명령 전에 거부해야 합니다.'
            } else {
                Assert-DeploymentTest (@(Get-DeploymentTestCalls 'diagnostics').Count -eq 1) '배포 실패 후 Compose 상태를 출력해야 합니다.'
            }
        }
        Write-Output ($labels[$scenario] + ' 검증을 통과했습니다.')
    }
}
finally {
    foreach ($name in $originalEnvironment.Keys) { [Environment]::SetEnvironmentVariable($name, $originalEnvironment[$name], 'Process') }
    [Console]::InputEncoding = $originalInputEncoding
    [Console]::OutputEncoding = $originalOutputEncoding
    [Console]::SetIn($originalInput)
    $OutputEncoding = $originalPipelineEncoding
    Remove-Item -LiteralPath Function:\docker -Force
    if ($null -ne $originalDockerBody) { Set-Item -LiteralPath Function:\global:docker -Value $originalDockerBody }
    if ($null -ne $originalDockerAlias) { Set-Alias -Name docker -Value $originalDockerAlias.Definition -Option $originalDockerAlias.Options -Scope Global -Force }
    Remove-Variable -Name MobtwigDeploymentTest -Scope Global -ErrorAction SilentlyContinue
    if ($null -ne $originalLastExitCode) { $global:LASTEXITCODE = $originalLastExitCode.Value }
    else { Remove-Variable -Name LASTEXITCODE -Scope Global -ErrorAction SilentlyContinue }
    $resolvedTestDirectory = [IO.Path]::GetFullPath($testDirectory)
    $temporaryPrefix = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    Assert-DeploymentTest ($resolvedTestDirectory.StartsWith($temporaryPrefix, [StringComparison]::OrdinalIgnoreCase) -and (Split-Path $resolvedTestDirectory -Leaf) -match '^mobtwig-deploy-test-[0-9a-f]{32}$') '정리 대상은 생성한 테스트 전용 임시 폴더여야 합니다.'
    if (Test-Path -LiteralPath $resolvedTestDirectory) { Remove-Item -LiteralPath $resolvedTestDirectory -Recurse -Force }
    $restoredDocker = Get-Item -LiteralPath Function:\docker -ErrorAction SilentlyContinue
    if ($null -eq $originalDockerBody) {
        Assert-DeploymentTest ($null -eq $restoredDocker) '테스트 전에 없던 Docker 모의 함수를 남기면 안 됩니다.'
    } else {
        Assert-DeploymentTest ($null -ne $restoredDocker -and $restoredDocker.ScriptBlock.ToString() -eq $originalDockerBody.ToString()) '테스트 전의 Docker 함수 내용을 복원해야 합니다.'
    }
    $restoredCommand = Get-Command docker -ErrorAction SilentlyContinue
    Assert-DeploymentTest ($restoredCommand.CommandType -eq $originalDockerCommandType -and $restoredCommand.Definition -eq $originalDockerDefinition) '테스트 전의 Docker 명령 종류와 실행 대상을 복원해야 합니다.'
}
Write-Output ('배포 자체 테스트 8개와 조건 검사 {0}개를 통과했습니다.' -f $assertionCount)
