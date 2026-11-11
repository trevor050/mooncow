import { execFileSync } from 'node:child_process';

// Optional machine-wide guard for shared Windows test hosts. Run immediately
// before every launch, including a worker restart after a failing test.
export function guardWindowsLaunch() {
  const gate = process.env.MOONCOW_BROWSER_GATE;
  if (process.platform !== 'win32' || !gate) return;
  const output = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', gate], { encoding: 'utf8' }).trim();
  console.log(`Windows browser launch gate: ${output}`);
  if (!/^\d+$/.test(output)) throw new Error('Cannot verify the Windows browser launch gate');
  if (Number(output) >= 8) throw new Error(`STOP ALL Windows browser launches: ${output} recent failed sign-ins; notify the host owner`);
  if (Number(output) >= 4) throw new Error(`Windows browser launch deferred: ${output} recent failed sign-ins`);
}
