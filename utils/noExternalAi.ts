/**
 * Convention: this framework has ZERO dependency on an external AI provider. The models are whatever
 * the user's own editor runs (VS Code Copilot Chat, Claude Code); nothing in this repo calls a model API,
 * ships a provider SDK, or asks for a provider key. Local speech-to-text (faster-whisper) is not an
 * external provider: it runs on the machine.
 *
 * Mentions in documentation are fine. This checks code, config and dependency lists.
 */

/** npm packages that are AI provider SDKs or model-calling frameworks. */
const PROVIDER_PACKAGES = [
  /^@anthropic-ai\//, /^openai$/, /^@azure\/openai$/, /^@google\/(generative-ai|genai)$/, /^@ai-sdk\//, /^ai$/,
  /^cohere-ai$/, /^@mistralai\//, /^groq-sdk$/, /^replicate$/, /^@huggingface\/inference$/, /^langchain$/, /^@langchain\//, /^llamaindex$/,
];

/** Hosts and environment variables that mean "call a hosted model". */
const PROVIDER_REFERENCES = [
  /api\.anthropic\.com/, /api\.openai\.com/, /generativelanguage\.googleapis\.com/, /api\.mistral\.ai/, /api\.cohere\.(com|ai)/, /api\.groq\.com/,
  /\bANTHROPIC_API_KEY\b/, /\bOPENAI_API_KEY\b/, /\bAZURE_OPENAI_/, /\bGOOGLE_GENERATIVE_AI_API_KEY\b/, /\bMISTRAL_API_KEY\b/, /\bGROQ_API_KEY\b/,
];

export interface ScannedFile { path: string; text: string }

export function findExternalAiUsage(files: ScannedFile[]): string[] {
  const problems: string[] = [];
  for (const f of files) {
    if (f.path.endsWith("package.json")) {
      try {
        const pkg = JSON.parse(f.text) as Record<string, Record<string, string> | undefined>;
        for (const section of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
          for (const name of Object.keys(pkg[section] ?? {})) {
            if (PROVIDER_PACKAGES.some((re) => re.test(name))) problems.push(`${f.path}: depends on AI provider package \`${name}\``);
          }
        }
      } catch { /* an unparsable package.json is some other check's problem */ }
    }
    for (const re of PROVIDER_REFERENCES) {
      const m = re.exec(f.text);
      if (m) problems.push(`${f.path}: references an external AI provider (\`${m[0]}\`)`);
    }
  }
  return problems;
}
