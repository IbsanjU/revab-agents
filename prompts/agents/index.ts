/** Registry of all agent specs, in pipeline order. */
import type { AgentSpec } from "../types.js";
import { planner } from "./planner.js";
import { orchestrator } from "./orchestrator.js";
import { researcher } from "./researcher.js";
import { testPlanner } from "./test-planner.js";
import { automation } from "./automation.js";
import { reporter } from "./reporter.js";
import { documenter } from "./documenter.js";
import { bsa } from "./bsa.js";
import { importer } from "./importer.js";
import { selfImprove } from "./self-improve.js";

export const AGENTS: AgentSpec[] = [
  planner,
  orchestrator,
  researcher,
  testPlanner,
  automation,
  reporter,
  documenter,
  bsa,
  importer,
  selfImprove,
];
