import { z } from "zod";

/**
 * Number that also accepts a numeric string ("5" → 5).
 *
 * Adapted from Claude Code's `src/utils/semanticNumber.ts` (zod v4) to this
 * repo's zod v3. Models sometimes send a quoted number — `"maxResults":"25"` —
 * which plain `z.number()` rejects. `z.preprocess` coerces a numeric string to a
 * number while leaving everything else untouched (so a genuinely non-numeric
 * value still fails validation rather than silently becoming `NaN`), and still
 * advertises `{"type":"number"}` to the model.
 *
 * Put `.optional()`/`.default()` on the INNER schema, not chained after.
 */
export function semanticNumber<T extends z.ZodTypeAny>(
  inner: T = z.number() as unknown as T,
) {
  return z.preprocess((v: unknown) => {
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
      return Number(v);
    }
    return v;
  }, inner);
}
