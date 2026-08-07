/**
 * The contract between the React UI and the database extension.
 *
 * Imported by both sides as types only, so there is no runtime coupling across
 * the bridge -- but a command whose payload changes on one side stops compiling
 * on the other.
 *
 * Split by domain -- `config` (reaching a server and filing it), `results` (what
 * comes back and what is written back), `queries` (statements the user kept),
 * `updater`, `commands` (the verbs) and `events` (the channel) -- but imported as
 * one contract. Both sides import from
 * here rather than from a domain file, so which domain a type lives in is a fact
 * about reading this directory and never about the fifty places that use it: a
 * type moving between the files below is not a change anywhere else.
 */

export type {
  AwsCredentialStatus,
  AwsIamAuth,
  ConnectionColorId,
  ConnectionConfig,
  ConnectionExportSummary,
  ConnectionImportSummary,
  EngineType,
  Environment,
  EnvironmentDef,
  PasswordUpdate,
  SavedConnection,
  ServerConfig,
  SqlDialect,
  TestPassword,
  Workspace,
  WorkspaceIconId,
} from './config.ts';

// The one value `config` exports. Both sides act on it and must not disagree --
// see its own comment for what disagreeing costs.
export { isFileEngine } from './config.ts';

export type {
  CellValue,
  ColumnInfo,
  DiagramColumn,
  DiagramTable,
  FilterCondition,
  FilterOperator,
  ForeignKeyLink,
  ForeignKeyRef,
  FunctionInfo,
  QueryResult,
  RowDelete,
  RowEdit,
  SortOrder,
  StarredTable,
  TableFilter,
  TableInfo,
  TablePage,
  TriggerInfo,
} from './results.ts';

export type {
  AiApprovalMode,
  AiConversation,
  AiConversationSummary,
  AiMessage,
  AiModel,
  AiProvider,
  AiProviderInfo,
  AiStatus,
  AiToolCall,
  AiToolDef,
} from './ai.ts';
export { AI_PROVIDERS, providerLabel } from './ai.ts';

export type { SavedQuery } from './queries.ts';

export type { UpdateProgress, UpdateStatus } from './updater.ts';

export type { CommandName, CommandReq, CommandRes, Commands } from './commands.ts';

export type { AiDelta, AwsSsoPrompt, ConnectionState, ConnectProgress, DbResponse } from './events.ts';
export {
  AI_DELTA_EVENT,
  AWS_SSO_PROMPT_EVENT,
  CONNECT_PROGRESS_EVENT,
  CONNECTION_STATE_EVENT,
  DB_RESPONSE_EVENT,
  UPDATE_PROGRESS_EVENT,
} from './events.ts';
