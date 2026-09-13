import type { TableInfo } from '../../../../../shared/protocol/index.ts';

/**
 * Which table an export is for, and where it lives -- both fixed at the
 * moment "Export table" was chosen, so a dialog minimized to the status bar
 * reopens against the same table even if the tree has since navigated
 * elsewhere.
 */
export interface ExportTarget {
    table: TableInfo;
    database: string;
}
