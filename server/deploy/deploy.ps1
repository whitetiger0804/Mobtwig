[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^ghcr\.io/[a-z0-9][a-z0-9._/-]*@sha256:[0-9a-f]{64}$')]
    [string]$ImageReference,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-f]{40}$')]
    [string]$CommitSha,

    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$RegistryUser,

    [string]$DeploymentRoot = 'C:\Mobtwig',

    [ValidatePattern('^[a-z0-9][a-z0-9_-]*$')]
    [string]$ProjectName = 'mobtwig-shared',

    [string]$DockerHost = 'npipe:////./pipe/dockerDesktopLinuxEngine'
)

chcp 65001 > $null
$ErrorActionPreference = 'Stop'
$registryToken = [Console]::In.ReadLine()
if ([string]::IsNullOrWhiteSpace($registryToken)) {
    throw '이미지 다운로드 토큰을 표준 입력으로 전달해야 합니다.'
}
$utf8 = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = $utf8
[Console]::OutputEncoding = $utf8
$OutputEncoding = $utf8

function Invoke-Docker {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [string]$InputText
    )

    if ($PSBoundParameters.ContainsKey('InputText')) {
        $InputText | & docker @Arguments
    }
    else {
        & docker @Arguments
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Docker 명령에 실패했습니다. 종료 코드는 $LASTEXITCODE 입니다."
    }
}

if (-not [System.IO.Path]::IsPathRooted($DeploymentRoot)) {
    throw 'DeploymentRoot에는 절대 경로를 지정해야 합니다.'
}
$DeploymentRoot = [System.IO.Path]::GetFullPath($DeploymentRoot)
$composePath = Join-Path $PSScriptRoot 'compose.yaml'
$envPath = Join-Path $DeploymentRoot 'config\.env'
if (-not (Test-Path -LiteralPath $envPath -PathType Leaf)) {
    throw "서버 환경 파일이 없습니다. $envPath 파일을 먼저 설정해야 합니다."
}

$stateDirectory = Join-Path $DeploymentRoot 'state'
$backupDirectory = Join-Path $DeploymentRoot 'backups'
New-Item -ItemType Directory -Path $stateDirectory, $backupDirectory -Force | Out-Null
$lockPath = Join-Path $stateDirectory 'deployment.lock'
# GitHub 배포와 수동 배포가 겹치면 파일 잠금 획득에 실패하여 실행을 중단합니다.
$deploymentLock = [System.IO.File]::Open(
    $lockPath,
    [System.IO.FileMode]::OpenOrCreate,
    [System.IO.FileAccess]::ReadWrite,
    [System.IO.FileShare]::None
)
$previousImageEnvironment = $env:API_IMAGE
$previousDockerConfig = $env:DOCKER_CONFIG
$previousDockerHost = $env:DOCKER_HOST
$configDirectory = Join-Path $DeploymentRoot 'config'
$registryDirectory = [System.IO.Path]::GetFullPath((Join-Path $configDirectory ('registry-' + [Guid]::NewGuid().ToString('N'))))
if (-not $registryDirectory.StartsWith(([System.IO.Path]::GetFullPath($configDirectory) + [System.IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase)) {
    throw '임시 인증 경로가 서버 설정 디렉터리를 벗어났습니다.'
}
$registryConfigPath = Join-Path $registryDirectory 'config.json'
$env:API_IMAGE = $ImageReference
$env:DOCKER_CONFIG = $registryDirectory
$env:DOCKER_HOST = $DockerHost
$composeArguments = @(
    'compose', '--project-name', $ProjectName,
    '--env-file', $envPath, '--file', $composePath
)

try {
    New-Item -ItemType Directory -Path $registryDirectory | Out-Null
    # 레지스트리 항목이 없으면 Docker CLI가 Windows 자격 증명 저장소를 자동 선택합니다.
    [System.IO.File]::WriteAllText($registryConfigPath, '{"auths":{"ghcr.io":{}}}', $utf8)
    # 배포 결과와 SQL 백업도 비밀번호 설정 폴더와 같은 접근 권한으로 보관합니다.
    $privateAcl = Get-Acl -LiteralPath $configDirectory
    Set-Acl -LiteralPath $backupDirectory -AclObject $privateAcl
    Set-Acl -LiteralPath $stateDirectory -AclObject $privateAcl

    Write-Output '배포 설정을 검사하고 API 이미지를 내려받습니다.'
    Invoke-Docker -Arguments ($composeArguments + @('config', '--quiet'))
    # Compose가 해석한 bind source만 메모리에서 검사합니다. 환경 비밀번호가 든 JSON은 출력하지 않습니다.
    $resolvedJson = @(Invoke-Docker -Arguments ($composeArguments + @('config', '--format', 'json')))
    try { $resolvedCompose = ($resolvedJson -join "`n") | ConvertFrom-Json }
    catch { throw '배포 구성의 본문 폴더를 확인하지 못했습니다.' }
    finally { $resolvedJson = $null }
    $contentMounts = @($resolvedCompose.services.api.volumes | Where-Object { $_.target -eq '/app/content' })
    if ($contentMounts.Count -ne 1 -or $contentMounts[0].type -ne 'bind' -or $contentMounts[0].read_only -ne $true) {
        throw '본문 폴더는 읽기 전용 bind 하나로 설정해야 합니다.'
    }
    $contentHostPath = [string]$contentMounts[0].source
    $resolvedCompose = $null
    if (-not [IO.Path]::IsPathRooted($contentHostPath) -or -not (Test-Path -LiteralPath $contentHostPath -PathType Container)) {
        throw '본문 호스트 폴더가 없습니다. CONTENT_HOST_PATH의 비공개 폴더를 먼저 준비하십시오.'
    }
    $releasePrefix = [IO.Path]::GetFullPath((Join-Path $DeploymentRoot 'releases')).TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar
    if ([IO.Path]::GetFullPath($contentHostPath).StartsWith($releasePrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw '본문 호스트 폴더는 릴리즈 폴더 밖에 보관해야 합니다.'
    }
    # Actions의 단기 토큰만 전달하며 Docker Desktop의 대화형 자격 증명 저장소를 사용하지 않습니다.
    Invoke-Docker -Arguments @('login', 'ghcr.io', '--username', $RegistryUser, '--password-stdin') -InputText $registryToken
    $registryToken = $null
    Invoke-Docker -Arguments ($composeArguments + @('pull', 'api'))

    $mysqlContainerIds = @(Invoke-Docker -Arguments ($composeArguments + @('ps', '--all', '--quiet', 'mysql')))
    if ($mysqlContainerIds.Count -ne 1) {
        throw '공용 MySQL 컨테이너가 한 개 있어야 합니다. 서버 DB 초기 구축을 먼저 완료해야 합니다.'
    }
    $mysqlContainerId = $mysqlContainerIds[0].Trim()
    $mysqlHealth = Invoke-Docker -Arguments @('inspect', '--format', '{{.State.Health.Status}}', $mysqlContainerId)
    if ($mysqlHealth.Trim() -ne 'healthy') {
        throw '공용 MySQL의 상태가 healthy가 아니므로 배포를 중단합니다.'
    }

    $apiContainerIds = @(Invoke-Docker -Arguments ($composeArguments + @('ps', '--all', '--quiet', 'api')))
    if ($apiContainerIds.Count -gt 1) {
        throw 'API 컨테이너가 여러 개이므로 단일 서버 배포를 진행할 수 없습니다.'
    }
    $previousImageReference = $null
    if ($apiContainerIds.Count -eq 1) {
        $previousImageReference = Invoke-Docker -Arguments @(
            'inspect', '--format', '{{.Config.Image}}', $apiContainerIds[0].Trim()
        )
    }

    Write-Output 'API를 정지한 뒤 변경 전 DB를 백업합니다.'
    Invoke-Docker -Arguments ($composeArguments + @('stop', 'api'))
    $backupName = '{0}-{1}.sql' -f [DateTime]::UtcNow.ToString('yyyyMMddTHHmmssfffZ'), $CommitSha.Substring(0, 12)
    $containerDumpPath = '/tmp/mobtwig-' + $backupName
    $backupPath = Join-Path $backupDirectory $backupName
    # 비밀번호는 MySQL 컨테이너 안의 환경변수에서만 읽습니다.
    $dumpCommand = 'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump --user=root --single-transaction --quick --routines --triggers --events --set-gtid-purged=OFF --no-tablespaces --databases "$MYSQL_DATABASE" --result-file=' + $containerDumpPath + ' #'
    # 표준 입력으로 따옴표를 보존하며 끝의 주석으로 Windows의 CR 문자를 경로에서 제외합니다.
    Invoke-Docker -Arguments @('exec', '-i', $mysqlContainerId, 'sh') -InputText $dumpCommand
    Invoke-Docker -Arguments @('cp', ($mysqlContainerId + ':' + $containerDumpPath), $backupPath)
    if ((Get-Item -LiteralPath $backupPath).Length -eq 0) {
        throw 'DB 백업 파일이 비어 있으므로 배포를 중단합니다.'
    }
    Invoke-Docker -Arguments @('exec', $mysqlContainerId, 'rm', '--', $containerDumpPath)
    Write-Output "DB 백업을 저장했습니다. $backupPath"

    Write-Output 'API 서비스만 교체하고 정상 기동을 기다립니다.'
    Invoke-Docker -Arguments ($composeArguments + @('up', '-d', '--no-deps', '--wait', '--wait-timeout', '180', 'api'))
    $readinessJson = Invoke-Docker -Arguments ($composeArguments + @(
        'exec', '-T', 'api', 'curl', '--fail', '--silent', '--show-error', '--max-time', '10',
        'http://127.0.0.1:8080/actuator/health/readiness'
    ))
    $readiness = ($readinessJson -join "`n") | ConvertFrom-Json
    if ($readiness.status -ne 'UP') {
        throw 'API 또는 DB 연결 상태가 UP이 아니므로 배포를 실패로 처리합니다.'
    }

    $record = [ordered]@{
        CommitSha = $CommitSha
        ImageReference = $ImageReference
        DeployedAt = [DateTime]::UtcNow.ToString('o')
        BackupPath = $backupPath
    }
    if ($previousImageReference) {
        $record.PreviousImageReference = $previousImageReference.Trim()
    }
    $statePath = Join-Path $stateDirectory 'last-success.json'
    $pendingStatePath = Join-Path $stateDirectory 'last-success.json.pending'
    [System.IO.File]::WriteAllText($pendingStatePath, ($record | ConvertTo-Json), $utf8)
    Move-Item -LiteralPath $pendingStatePath -Destination $statePath -Force
    Write-Output "배포와 DB 연결 검증을 완료했습니다. 커밋: $CommitSha"
    Write-Output "배포 기록을 저장했습니다. $statePath"
}
catch {
    $deploymentError = $_
    Write-Warning '배포에 실패했습니다. 자동 복구를 실행하지 않았으며 API가 정지되어 있을 수 있습니다.'
    # 실패 원인을 덮어쓰지 않도록 상태 출력의 종료 코드는 배포 오류와 분리합니다.
    & docker @composeArguments ps
    throw $deploymentError
}
finally {
    if (Test-Path -LiteralPath $registryConfigPath -PathType Leaf) {
        Remove-Item -LiteralPath $registryConfigPath -Force
    }
    if (Test-Path -LiteralPath $registryDirectory -PathType Container) {
        Remove-Item -LiteralPath $registryDirectory -Force
    }
    $env:DOCKER_CONFIG = $previousDockerConfig
    $env:DOCKER_HOST = $previousDockerHost
    $env:API_IMAGE = $previousImageEnvironment
    $deploymentLock.Dispose()
}
