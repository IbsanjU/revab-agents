/**
 * Turn the gateway's tool schemas into a small TypeScript API the model writes code against.
 *
 * Code Mode works because models are better at writing code against a typed API than at
 * emitting one tool call at a time, and because the declarations can be fetched on demand
 * (`codemode_search`) instead of loading every tool definition up front. This is the same
 * idea as Cloudflare's `generateTypes`, built from the zod shapes the servers already declare.
 */
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";

type Json = Record<string, unknown>;

const pascal = (name: string): string =>
  name
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");

const comment = (text: unknown, indent: string): string => {
  if (typeof text !== "string" || !text.trim()) return "";
  const body = text.trim().replace(/\*\//g, "* /").split(/\r?\n/).join(`\n${indent} * `);
  return `${indent}/** ${body} */\n`;
};

/** JSON Schema → TypeScript type expression. Unknown shapes degrade to `unknown`, never throw. */
export function jsonSchemaToTs(schema: unknown, indent = ""): string {
  if (!schema || typeof schema !== "object") return "unknown";
  const s = schema as Json;
  if (Array.isArray(s.enum)) return s.enum.map((v) => JSON.stringify(v)).join(" | ") || "never";
  if ("const" in s) return JSON.stringify(s.const);
  const union = (s.anyOf ?? s.oneOf) as unknown[] | undefined;
  if (Array.isArray(union)) return union.map((u) => jsonSchemaToTs(u, indent)).join(" | ") || "unknown";
  const type = Array.isArray(s.type) ? s.type : [s.type];
  const parts = type.map((t) => {
    switch (t) {
      case "string":
        return "string";
      case "number":
      case "integer":
        return "number";
      case "boolean":
        return "boolean";
      case "null":
        return "null";
      case "array":
        return `Array<${jsonSchemaToTs(s.items, indent)}>`;
      case "object":
        return objectToTs(s, indent);
      default:
        return "unknown";
    }
  });
  return [...new Set(parts)].join(" | ");
}

function objectToTs(s: Json, indent: string): string {
  const props = (s.properties ?? {}) as Record<string, unknown>;
  const required = new Set((s.required as string[] | undefined) ?? []);
  const keys = Object.keys(props);
  if (keys.length === 0) return s.additionalProperties === false ? "Record<string, never>" : "Record<string, unknown>";
  const inner = `${indent}  `;
  const lines = keys.map((key) => {
    const prop = props[key] as Json;
    const name = /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
    return `${comment(prop?.description, inner)}${inner}${name}${required.has(key) ? "" : "?"}: ${jsonSchemaToTs(prop, inner)};`;
  });
  return `{\n${lines.join("\n")}\n${indent}}`;
}

export interface ToolLike {
  name: string;
  description: string;
  inputSchema: Record<string, z.ZodTypeAny>;
}

/** Declarations for one tool: its input type and its method on `codemode`. */
export function declareTool(tool: ToolLike): { typeName: string; input: string; method: string } {
  const typeName = `${pascal(tool.name)}Input`;
  const json = zodToJsonSchema(z.object(tool.inputSchema), { $refStrategy: "none" });
  const input = `${comment(tool.description, "")}type ${typeName} = ${jsonSchemaToTs(json)};`;
  const method = `${comment(tool.description, "  ")}  ${tool.name}: (input: ${typeName}) => Promise<unknown>;`;
  return { typeName, input, method };
}

/** The full declaration block the model sees: input types plus `declare const codemode`. */
export function generateTypes(tools: ToolLike[]): string {
  const declared = tools.map(declareTool);
  return [
    ...declared.map((d) => d.input),
    `declare const codemode: {\n${declared.map((d) => d.method).join("\n")}\n};`,
  ].join("\n\n");
}

/** Rank tools against a free-text query (name hits outweigh description hits). */
export function searchTools<T extends ToolLike & { server?: string }>(tools: T[], query: string, limit = 8): T[] {
  const words = query.toLowerCase().split(/[^a-z0-9_]+/).filter((w) => w.length > 1);
  if (words.length === 0) return [];
  return tools
    .map((tool) => {
      const name = tool.name.toLowerCase();
      const text = `${tool.description} ${tool.server ?? ""}`.toLowerCase();
      const score = words.reduce((sum, w) => sum + (name.includes(w) ? 3 : 0) + (text.includes(w) ? 1 : 0), 0);
      return { tool, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.tool.name.localeCompare(b.tool.name))
    .slice(0, limit)
    .map((entry) => entry.tool);
}
