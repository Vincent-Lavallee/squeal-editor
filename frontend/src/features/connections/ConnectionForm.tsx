import { useState } from 'react';

import type { ConnectionConfig, EngineType } from '../../../../shared/protocol.ts';
import { ENGINES, engineByType } from '../../engines.ts';

interface FormState {
  type: EngineType;
  host: string;
  port: string;
  user: string;
  password: string;
  database: string;
}

const INITIAL: FormState = {
  type: 'postgres',
  host: 'localhost',
  port: '',
  user: '',
  password: '',
  database: '',
};

interface Props {
  onConnect: (config: ConnectionConfig) => void;
  connecting: boolean;
}

export default function ConnectionForm({ onConnect, connecting }: Props) {
  const [form, setForm] = useState<FormState>(INITIAL);
  const engine = engineByType(form.type);

  function set<K extends keyof FormState>(key: K, value: FormState[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault();
    onConnect({
      type: form.type,
      host: form.host,
      password: form.password,
      // Blank port/user fall back to the engine's convention rather than erroring.
      port: Number(form.port) || engine.defaultPort,
      user: form.user || engine.defaultUser,
      database: form.database || undefined,
    });
  }

  return (
    <form className="connect__form" onSubmit={handleSubmit}>
      <div className="field">
        <label className="label" htmlFor="type">
          Engine
        </label>
        <select
          id="type"
          className="select"
          value={form.type}
          onChange={(e) => set('type', e.target.value as EngineType)}
        >
          {ENGINES.map((e) => (
            <option key={e.value} value={e.value}>
              {e.label}
            </option>
          ))}
        </select>
      </div>

      <div className="connect__row">
        <div className="field">
          <label className="label" htmlFor="host">
            Host
          </label>
          <input id="host" className="input" value={form.host} onChange={(e) => set('host', e.target.value)} />
        </div>
        <div className="field connect__port">
          <label className="label" htmlFor="port">
            Port
          </label>
          <input
            id="port"
            className="input"
            value={form.port}
            placeholder={String(engine.defaultPort)}
            onChange={(e) => set('port', e.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <label className="label" htmlFor="user">
          User
        </label>
        <input
          id="user"
          className="input"
          value={form.user}
          placeholder={engine.defaultUser}
          onChange={(e) => set('user', e.target.value)}
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="password">
          Password
        </label>
        <input
          id="password"
          className="input"
          type="password"
          value={form.password}
          onChange={(e) => set('password', e.target.value)}
        />
      </div>

      <div className="field">
        <label className="label" htmlFor="database">
          Database{' '}
          <span className="field__hint">{form.type === 'postgres' ? '(default: postgres)' : '(optional)'}</span>
        </label>
        <input
          id="database"
          className="input"
          value={form.database}
          onChange={(e) => set('database', e.target.value)}
        />
      </div>

      <button type="submit" className="btn btn--primary connect__submit" disabled={connecting}>
        {connecting ? 'Connecting…' : 'Connect'}
      </button>
    </form>
  );
}
