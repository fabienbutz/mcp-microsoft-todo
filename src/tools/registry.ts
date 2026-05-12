import { authTools } from "./auth-tools";
import { checklistTools } from "./checklist-tools";
import { listTools } from "./list-tools";
import { taskTools } from "./task-tools";
import type { ToolDef } from "./_shared";

/** Single source of truth for the tool surface. `server.ts` filters this by risk class. */
export const allTools: ToolDef[] = [...authTools, ...listTools, ...taskTools, ...checklistTools];
