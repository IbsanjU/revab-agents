import { z } from "zod";

/**
 * Boolean that also accepts the string literals "true"/"false".
 *
 * Adapted from Claude Code's `src/utils/semanticBoolean.ts` (zod v4) to this
 * repo's zod v3. Tool inputs arrive as model-generated JSON, and models across
 * hosts occasionally quote booleans — `"dryRun":"false"` instead of
 * `"dryRun":false`. Plain `z.boolean()` rejects that with a type error (the tool
 * call fails and the model flails); `z.coerce.boolean()` is worse, since JS
 * truthiness turns the string "false" into `true` — which would silently defeat
 * a dryRun guard.
 *
 * `z.preprocess` emits `{"type":"boolean"}` to the advertised schema, so the
 * model is still told this is a boolean — the string tolerance is invisible,
 * client-side coercion, not a widened input shape.
 *
 * Put `.optional()`/`.default()` on the INNER schema, not chained after:
 *   semanticBoolean()                           → boolean
 *   semanticBoolean(z.boolean().optional())     → boolean | undefined
 *   semanticBoolean(z.boolean().default(false)) → boolean
 */
export function semanticBoolean<T extends z.ZodTypeAny>(
  inner: T = z.boolean() as unknown as T,
) {
  return z.preprocess(
    (v: unknown) => (v === "true" ? true : v === "false" ? false : v),
    inner,
  );
}
