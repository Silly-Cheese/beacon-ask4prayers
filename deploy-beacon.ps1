param([switch]$CheckCli)

$ErrorActionPreference = 'Stop'
$project = 'beacon-ask4prayers'

Push-Location -LiteralPath $PSScriptRoot
try {
    if ($CheckCli) {
        npx.cmd --yes --package=firebase-tools@latest -- firebase.cmd --version
        if ($LASTEXITCODE -ne 0) { throw "Firebase CLI version check failed (exit $LASTEXITCODE)." }
        return
    }

    Write-Host 'Installing Beacon Functions dependencies...'
    npm.cmd --prefix functions install
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. See the npm output above.' }

    Write-Host 'Deploying Beacon Functions and Firestore rules...'
    npx.cmd --yes --package=firebase-tools@latest -- firebase.cmd deploy --project $project --only 'functions,firestore:rules'
    if ($LASTEXITCODE -ne 0) { throw "Firebase CLI exited with code $LASTEXITCODE. See the Firebase output above." }

    $response = Invoke-RestMethod -Method Post -ErrorAction Stop `
        -Uri "https://us-central1-$project.cloudfunctions.net/getProgramSettings" `
        -ContentType 'application/json' -Body '{"data":{}}'
    $status = $response.result
    if ($null -eq $status -or $status.intakeOpen -isnot [bool]) {
        throw 'The deployed status endpoint did not return Beacon intake settings.'
    }
    $intake = if ($status.intakeOpen) { 'OPEN' } else { 'CLOSED' }
    Write-Host "Beacon Class of $($status.cycle) intake is $intake."
    Write-Host 'Sign in as a Beacon admin at https://beacon.ask4prayers.com/#committee to manage applications and nominations.'
} finally {
    Pop-Location
}
