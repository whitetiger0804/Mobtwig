[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidatePattern('^ghcr\.io/[a-z0-9][a-z0-9._/-]*@sha256:[0-9a-f]{64}$')]
    [string]$ImageReference,

    [Parameter(Mandatory = $true)]
    [ValidatePattern('^[0-9a-f]{40}$')]
    [string]$CommitSha,

    [string]$DeploymentRoot = 'C:\Mobtwig',

    [ValidatePattern('^[a-z0-9][a-z0-9_-]*$')]
    [string]$ProjectName = 'mobtwig-shared'
)

chcp 65001 > $null
$ErrorActionPreference = 'Stop'
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
$env:API_IMAGE = $ImageReference
$composeArguments = @(
    'compose', '--project-name', $ProjectName,
    '--env-file', $envPath, '--file', $composePath
)

try {
    Write-Host '배포 설정을 검사하고 API 이미지를 내려받습니다.'
    Invoke-Docker -Arguments ($composeArguments + @('config', '--quiet'))
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

    Write-Host 'API를 정지한 뒤 변경 전 DB를 백업합니다.'
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
    Write-Host "DB 백업을 저장했습니다. $backupPath"

    Write-Host 'API 서비스만 교체하고 정상 기동을 기다립니다.'
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
    Write-Host "배포와 DB 연결 검증을 완료했습니다. 커밋: $CommitSha"
    Write-Host "배포 기록을 저장했습니다. $statePath"
}
catch {
    $deploymentError = $_
    Write-Warning '배포에 실패했습니다. 자동 복구를 실행하지 않았으며 API가 정지되어 있을 수 있습니다.'
    # 실패 원인을 덮어쓰지 않도록 상태 출력의 종료 코드는 배포 오류와 분리합니다.
    & docker @composeArguments ps
    throw $deploymentError
}
finally {
    $env:API_IMAGE = $previousImageEnvironment
    $deploymentLock.Dispose()
}
