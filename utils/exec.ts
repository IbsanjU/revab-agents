import { spawn } from "child_process";

export interface ExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run a command with args (no shell string interpolation of untrusted input).
 * shell:true is required on Windows for npm/npx shims.
 */
export function execCommand(command: string, args: string[] = [], cwd?: string): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, shell: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}
