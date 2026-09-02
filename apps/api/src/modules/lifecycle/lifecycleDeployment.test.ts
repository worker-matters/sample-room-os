import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../../../..");
const lifecycleRoot = path.join(root, "deployment/windows-factory/lifecycle");

describe("LCM-02 factory deployment boundary", () => {
  it("publishes runner control only on Windows loopback and leaves PostgreSQL unpublished", () => {
    const compose = readFileSync(path.join(root, "deployment/windows-factory/compose.yml"), "utf8");
    const deploy = readFileSync(path.join(root, "deployment/windows-factory/Factory-Deploy.ps1"), "utf8");
    expect(compose).toContain('"127.0.0.1:${SAMPLE_ROOM_RUNNER_PORT:-3002}:3002"');
    expect(compose).toContain('"${SAMPLE_ROOM_HTTP_BIND:-0.0.0.0}:${SAMPLE_ROOM_HTTP_PORT:-3001}:3001"');
    const postgres = compose.slice(compose.indexOf("  postgres:"), compose.indexOf("  migrate:"));
    expect(postgres).not.toMatch(/^\s+ports:/m);
    expect(compose).not.toContain("docker.sock");
    expect(compose).toContain("${FACTORY_UPDATE_ROOT}:/updates");
    expect(compose).toContain("${FACTORY_DATA_ROOT_HOST}/postgres:/var/lib/postgresql/data");
    const dockerfile = readFileSync(path.join(root, "Dockerfile"), "utf8").replaceAll("\r\n", "\n");
    const dockerignore = readFileSync(path.join(root, ".dockerignore"), "utf8");
    expect(dockerfile.match(/apt-get install -y --no-install-recommends openssl/g)).toHaveLength(2);
    expect(dockerfile).toContain("ARG VITE_AUTH_MODE\n");
    expect(dockerfile).toContain("ARG VITE_ENABLE_DEV_ENTRY\n");
    expect(dockerfile).not.toContain("ARG VITE_AUTH_MODE=formal");
    expect(dockerfile).toContain('test "$VITE_AUTH_MODE" = "formal"');
    expect(dockerfile).toContain('test "$VITE_ENABLE_DEV_ENTRY" = "false"');
    expect(dockerfile).toContain("rm -rf apps/web/dist");
    expect(dockerfile).not.toContain("printer-support");
    const security = readFileSync(path.join(root, "apps/api/src/shared/httpSecurity.ts"), "utf8");
    expect(security).toContain('connectSrc: ["\'self\'", "ws://127.0.0.1:37989"]');
    expect(dockerfile).toContain('com.sample-room.release.auth-mode="formal"');
    expect(dockerignore).toContain("deployment/windows-factory/offline/");
    for (const excludedLocalArtifact of [".gradle/", "local.properties", "*.apk", "*.jks", "*.keystore"]) {
      expect(dockerignore).toContain(excludedLocalArtifact);
    }
    expect(deploy).toContain('"FACTORY_UPDATE_ROOT"');
  });

  it("integrates a fail-closed, non-technical offline deployment flow", () => {
    const deploy = readFileSync(path.join(root, "deployment/windows-factory/Factory-Deploy.ps1"), "utf8");
    const lifecycleRoutes = readFileSync(path.join(root, "apps/api/src/modules/lifecycle/lifecycleRoutes.ts"), "utf8");
    const entry = readFileSync(path.join(root, "deployment/windows-factory/First-Deploy.cmd"), "utf8");
    expect(deploy).toContain("Invoke-Preflight");
    expect(deploy).toContain("New-ProductionEnvironment");
    expect(deploy).toContain("Import-PackageImages");
    expect(deploy).toContain("docker load -i $imageFile");
    expect(deploy).toContain("Assert-FormalReleaseImages");
    expect(deploy).toContain("Set-ProductionReleaseMetadata -Release $release");
    expect(deploy).toContain('docker inspect --format "{{.Config.Image}}" $apiId');
    expect(lifecycleRoutes).toContain('process.env.SAMPLE_ROOM_APP_VERSION ?? process.env.npm_package_version ?? "factory-release"');
    expect(deploy).toContain("Test-PackageChecksums");
    expect(deploy).toContain("RandomNumberGenerator");
    expect(deploy).not.toContain("Invoke-Compose build");
    expect(deploy).not.toContain("New-NetFirewallRule");
    expect(deploy.indexOf("Import-PackageImages")).toBeLessThan(deploy.indexOf("Invoke-Compose up --detach postgres"));
    expect(deploy).not.toMatch(/Write-(Host|Output).+machineCredential/i);
    expect(Buffer.from(entry, "utf8").every((byte) => byte < 128)).toBe(true);
    expect(entry).not.toContain("chcp");
    expect(entry).toContain("Start-Process -FilePath '%~f0' -Verb RunAs");
  });

  it("keeps task scheduler and runner scripts syntactically valid without destructive Docker commands", () => {
    const scripts = ["LifecycleRunner.Common.psm1", "Start-LifecycleRunner.ps1", "LifecycleRunner.Task.ps1", "Initialize-LifecycleRunnerCredential.ps1", "actions/Invoke-LifecycleDiagnostic.ps1", "actions/Invoke-CreateRecoveryPoint.ps1", "actions/Invoke-RestoreRecoveryPoint.ps1", "actions/StorageMigration.Files.psm1", "actions/Invoke-MigrateStorage.ps1", "actions/UpdatePackage.Common.psm1", "actions/Invoke-UpdatePackagePreflight.ps1", "actions/Invoke-ApplyUpdate.ps1"];
    const combined = scripts.map((file) => readFileSync(path.join(lifecycleRoot, file), "utf8")).join("\n").toLowerCase();
    expect(combined).not.toMatch(/docker\s+(compose\s+(up|down|rm)|rm|volume|system\s+prune)/);
    expect(combined).not.toMatch(/remove-item.+(docker|volume|factory_data_root|orders|storagekey)/);
    expect(combined).toContain("global\\sampleroomlifecyclerunner");
    expect(combined).toContain('system32\\conhost.exe');
    expect(combined).toContain('--headless');
    expect(combined).toContain('"create_recovery_point" { "create_recovery_point"');
    expect(combined).toContain('"diagnostic" { "diagnostic"');
    expect(combined).not.toContain('"restore_recovery_point" { "restore_recovery_point"');
    expect(combined).not.toContain('"migrate_storage" { "migrate_storage"');
    expect(combined).toContain("pre-storage-migration");
    expect(combined).not.toMatch(/\$job\.parameters\.(targetpath|path|command|script)/);
    expect(combined).not.toContain('"preflight_update" { "preflight_update"');
    expect(combined).not.toContain('"apply_update" { "apply_update"');
    expect(combined.indexOf('if ($journal.action -notin @("diagnostic", "create_recovery_point"))')).toBeLessThan(combined.indexOf('if ($journal.action -eq "restore_recovery_point"'));
    expect(combined).toContain('event "v1_action_not_available"');
    expect(combined).toContain("invoke-updatepackagepreflight.ps1");
    expect(combined).toContain("invoke-applyupdate.ps1");
    expect(combined).not.toMatch(/\$job\.parameters\.(command|script|path|container|image|environment)/);
    expect(combined).toContain("pending_complete");
    expect(combined).toContain("sync-pendingjournalresult");
    expect(combined).toContain("randomnumbergenerator");
    const temp = mkdtempSync(path.join(tmpdir(), "lcm-02-parse-"));
    try {
      for (const file of scripts) {
        const filePath = path.join(lifecycleRoot, file).replaceAll("'", "''");
        const script = `$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseFile('${filePath}',[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){$errors|ForEach-Object{$_.Message};exit 1}`;
        execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "pipe" });
      }
      expect(readFileSync(path.join(lifecycleRoot, "lifecycle-runner.example.json"), "utf8")).not.toContain("DATABASE_URL");
    } finally { rmSync(temp, { recursive: true, force: true }); }
  }, 45_000);

  it("keeps formal release build metadata and runtime acceptance fail-closed", () => {
    const prepare = readFileSync(path.join(root, "deployment/windows-factory/Prepare-Offline-Images.ps1"), "utf8");
    const candidate = readFileSync(path.join(root, "deployment/windows-factory/Build-FactoryDeploymentPackage.ps1"), "utf8");
    const acceptance = readFileSync(path.join(root, "deployment/windows-factory/Test-Formal-Release.ps1"), "utf8");
    expect(prepare).toContain("Release images require a clean Git working tree");
    expect(prepare).toContain("sample-room-factory-images.release.json");
    expect(prepare).toContain("tarSha256");
    expect(candidate).toContain("Factory packages require a clean Git working tree");
    expect(candidate).toContain("function Invoke-DockerImageExport");
    expect(candidate).toContain("& docker save -o $OutputPath @Images");
    expect(candidate).toContain("Invoke-DockerImageExport -OutputPath $appTar -Images @($appImage, $toolsImage)");
    expect(candidate).toContain("git -C $RepoRoot archive");
    expect(candidate).toContain("SHA256SUMS.txt");
    expect(candidate).not.toContain('Copy-Required $printerSupportRoot (Join-Path $packageRoot "printer-support")');
    expect(candidate).not.toContain("Get-AuthenticodeSignature -LiteralPath $printerInstallerPath");
    expect(candidate).toContain("ANDROID-APK-NOT-INCLUDED.txt");
    expect(acceptance).toContain('$health.service "sample-room-api-v2"');
    expect(acceptance).toContain('"x-dev-role" = "system_owner"');
    expect(acceptance).toContain('"x-dev-user-id" = "forged-release-user"');
    expect(acceptance).toContain('name="sample-room-dev-entry-enabled" content="false"');
  });

  it("validates a fixed-format update package and rejects injected instructions in isolated directories", () => {
    const testRoot = mkdtempSync(path.join(tmpdir(), "lcm-06-package-"));
    try {
      const modulePath = path.join(lifecycleRoot, "actions/UpdatePackage.Common.psm1").replaceAll("'", "''");
      const escapedRoot = testRoot.replaceAll("'", "''");
      const script = `
$ErrorActionPreference='Stop';Import-Module '${modulePath}' -Force;
$source=Join-Path '${escapedRoot}' 'source';$payload=Join-Path $source 'payload';New-Item -ItemType Directory -Force -Path $payload|Out-Null;
$payloadFile=Join-Path $payload 'factory-images.tar';[IO.File]::WriteAllText($payloadFile,'isolated image fixture');$hash=(Get-FileHash -Algorithm SHA256 $payloadFile).Hash.ToLowerInvariant();$size=(Get-Item $payloadFile).Length.ToString();
$manifest=[ordered]@{formatVersion='factory-update-v1';targetVersion='1.2.0';title='安全更新';changes=@('修复已知问题');databaseImpact='新增数据能力，不删除现有数据';attachmentImpact='无影响';configurationImpact='无影响';riskLevel='low';estimatedDowntimeMinutes=5;compatibleCurrentVersions=@('1.0.0');runnerMinimumVersion='1.0.0';payloadSha256=$hash;payloadSizeBytes=$size;apiImageId=('sha256:'+('a'*64));migrateImageId=('sha256:'+('b'*64));bootstrapImageId=('sha256:'+('c'*64))};
$manifest|ConvertTo-Json -Depth 5|Set-Content -Encoding utf8 (Join-Path $source 'update-manifest.json');$zip=Join-Path '${escapedRoot}' 'Deploy-V1.2.0.zip';Compress-Archive -Path (Join-Path $source '*') -DestinationPath $zip;
$config=[pscustomobject]@{updateRoot='${escapedRoot}';appVersion='1.0.0';runnerVersion='1.0.0'};$artifact=[pscustomobject]@{version='1.2.0';digest=('a'*64);manifestSummary=@{}};
$result=Test-ControlledUpdatePackage -Config $config -UpdateArtifact $artifact -PackagePath $zip -StagingRoot (Join-Path '${escapedRoot}' 'stage-good');if(-not $result.compatibility.compatible){exit 2};
$manifest.command='docker compose down';$bad=Join-Path '${escapedRoot}' 'bad';New-Item -ItemType Directory -Force -Path (Join-Path $bad 'payload')|Out-Null;Copy-Item $payloadFile (Join-Path $bad 'payload\\factory-images.tar');$manifest|ConvertTo-Json -Depth 5|Set-Content -Encoding utf8 (Join-Path $bad 'update-manifest.json');$badZip=Join-Path '${escapedRoot}' 'bad.zip';Compress-Archive -Path (Join-Path $bad '*') -DestinationPath $badZip;
$rejected=$false;try{Test-ControlledUpdatePackage -Config $config -UpdateArtifact $artifact -PackagePath $badZip -StagingRoot (Join-Path '${escapedRoot}' 'stage-bad')|Out-Null}catch{$rejected=$true};if(-not $rejected){exit 3}`;
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "pipe" });
    } finally { rmSync(testRoot, { recursive: true, force: true }); }
  }, 30_000);

  it("copies and verifies business files only inside isolated test directories", () => {
    const rootPath = mkdtempSync(path.join(tmpdir(), "lcm-05-storage-copy-"));
    try {
      const modulePath = path.join(lifecycleRoot, "actions/StorageMigration.Files.psm1").replaceAll("'", "''");
      const source = path.join(rootPath, "source");
      const target = path.join(rootPath, "target");
      const escapedSource = source.replaceAll("'", "''");
      const escapedTarget = target.replaceAll("'", "''");
      const script = `Import-Module '${modulePath}' -Force;New-Item -ItemType Directory -Force -Path '${escapedSource}\\storage\\Orders'|Out-Null;[IO.File]::WriteAllText('${escapedSource}\\storage\\Orders\\fixture.txt','safe fixture');Copy-StorageTreeVerified -Source '${escapedSource}' -Target '${escapedTarget}';if(-not (Test-StorageTreesEqual -Source '${escapedSource}' -Target '${escapedTarget}')){exit 2}`;
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "pipe" });
      expect(readFileSync(path.join(target, "storage", "Orders", "fixture.txt"), "utf8")).toBe("safe fixture");
    } finally { rmSync(rootPath, { recursive: true, force: true }); }
  }, 15_000);

  it("writes an atomic journal and append-only redacted JSONL in an isolated temporary state directory", () => {
    const state = mkdtempSync(path.join(tmpdir(), "lcm-02-journal-"));
    try {
      const statePath = state.replaceAll("'", "''");
      const modulePath = path.join(lifecycleRoot, "LifecycleRunner.Common.psm1").replaceAll("'", "''");
      const script = `Import-Module '${modulePath}' -Force;$c=[pscustomobject]@{stateDirectory='${statePath}';logRetentionDays=30};New-LifecycleRunnerDirectories -Config $c;Write-LifecycleJournal -Config $c -Journal ([ordered]@{jobId='job-1';status='running'});Write-LifecycleLog -Config $c -JobId 'job-1' -Event 'test' -Message 'token=must-not-appear'`;
      execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "pipe" });
      const journal = readFileSync(path.join(state, "current-job.json"), "utf8");
      const log = readFileSync(path.join(state, "logs", "job-1.jsonl"), "utf8");
      expect(journal).toContain('"jobId":"job-1"');
      expect(readdirSync(state).some((name) => name.endsWith(".tmp"))).toBe(false);
      expect(log).toContain("[REDACTED]");
      expect(log).not.toContain("must-not-appear");
    } finally { rmSync(state, { recursive: true, force: true }); }
  });
});
