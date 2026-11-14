$ErrorActionPreference = 'Stop'
$project = 'beacon-ask4prayers'

Push-Location -LiteralPath $PSScriptRoot
try {
    Write-Host 'Installing Beacon Functions dependencies...'
    npm.cmd --prefix functions install
    if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. See the npm output above.' }

    Write-Host 'Deploying Beacon Functions and Firestore rules...'
    npx.cmd --yes firebase-tools@latest deploy --project $project --only 'functions,firestore:rules'
    if ($LASTEXITCODE -ne 0) { throw 'Firebase deployment failed. See the Firebase output above.' }

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
