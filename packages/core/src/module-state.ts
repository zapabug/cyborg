// feat-wazaa-port WZP-50: the state a module keeps by itself, per key (a chat, say): versioned and audited, never a core feature. The booking funnel's
// stage and fields live here. It holds the module's own working memory, never identity values (vault codes only) and never customer text.

export interface ModuleStateRecord<T = unknown> {
  value: T;
  /** Starts at 1 and goes up by one on every write. */
  version: number;
  updatedAt: string;
}

export interface ModuleStateStore {
  getModuleState<T = unknown>(module: string, key: string): ModuleStateRecord<T> | null;
  /** Every write is an audit row naming the actor and the new version. */
  setModuleState(module: string, key: string, value: unknown, actor: string, at: string): { version: number };
  listModuleState<T = unknown>(module: string): { key: string; record: ModuleStateRecord<T> }[];
}
