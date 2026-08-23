import { TAB_EDIT_TOOLS } from './tabEditTools.ts';
import { TAB_INSPECTION_TOOLS } from './tabInspectionTools.ts';
import type { Tool } from './toolHelpers.ts';

export const TAB_TOOLS: Tool[] = [...TAB_INSPECTION_TOOLS, ...TAB_EDIT_TOOLS];
