// PowerShell 7 exposes its own PSModulePath to child processes. When Node then
// launches Windows PowerShell 5.1, that inherited path can hide the built-in
// WindowsPowerShell module locations (for example Microsoft.PowerShell.Utility,
// which provides Get-FileHash). Remove only the test-process copy so Windows
// PowerShell can rebuild its native module path on startup.
if (process.platform === "win32") {
  delete process.env.PSModulePath;
}
