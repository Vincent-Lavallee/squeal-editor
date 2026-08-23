/**
 * What the assistant can do, and what doing it costs.
 *
 * Every tool here runs **in the webview**, which is why the loop does too: six of
 * them answer from the tabs, the editor selection and the results, none of which
 * the extension has ever heard of. The rest reach the extension through the same
 * `db.*` bridge every other feature uses -- the assistant is not a second way
 * into a database, it is another caller of the one that exists.
 *
 * One property decides how the loop treats a tool, and it is on the tool
 * (`toolHelpers.ts`'s `Tool`) rather than in the loop, so adding a tool cannot
 * quietly add a hole:
 *
 * - `mutating` -- it runs SQL or rewrites a tab, so it stops for approval unless
 *   the approval mode says otherwise. `runRawSql` also carries real values back,
 *   capped at `maxRows` and reduced to their shape before they reach disk --
 *   approval is what stands in for `getTabResult`'s "ask a second tool" here.
 * - everything else reads, and reading is never gated. That includes
 *   `getTabResult`, which carries real values: a card in front of every lookup
 *   is a card nobody reads by the third one, which is worse than no card at all
 *   because it still looks like a guard. The rows are protected where it costs
 *   nothing instead -- the per-turn context never carries values, so the model
 *   has to *ask* rather than being handed them. See `docs/decisions.md`.
 *
 * Every result names the connection it came from. The model may target any open
 * connection, so an untagged answer would let turn 3's schema and turn 8's rows
 * describe two different servers with nothing saying so.
 *
 * The tools themselves are grouped by what they are about -- `schemaTools.ts`,
 * `connectionTools.ts`, `tabTools.ts`, `runTools.ts` -- each under its own line
 * cap; this file only assembles them.
 */

import { CONNECTION_TOOLS } from './connectionTools.ts';
import { RUN_TOOLS } from './runTools.ts';
import { SCHEMA_TOOLS, TABLE_LIMIT } from './schemaTools.ts';
import { TAB_TOOLS } from './tabTools.ts';
import type { Tool, ToolContext } from './toolHelpers.ts';

export { TABLE_LIMIT };
export type { ToolContext };

export const TOOLS: Tool[] = [...SCHEMA_TOOLS, ...CONNECTION_TOOLS, ...TAB_TOOLS, ...RUN_TOOLS];

export const toolByName = (name: string): Tool | undefined =>
    TOOLS.find((tool) => tool.def.name === name);

export const TOOL_DEFS = TOOLS.map((tool) => tool.def);
