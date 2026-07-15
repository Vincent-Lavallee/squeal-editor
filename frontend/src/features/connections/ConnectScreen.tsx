import { useSession } from '../../store/sessionSlice.ts';
import ConnectionForm from './ConnectionForm.tsx';

export default function ConnectScreen() {
  const { connect, connecting, error } = useSession();

  return (
    <div className="connect">
      <div className="card connect__card">
        <h1 className="connect__brand">
          <span className="connect__mark">◆</span> Squeal
        </h1>
        <p className="connect__sub">A stupid simple SQL editor.</p>
        <ConnectionForm onConnect={connect} connecting={connecting} />
        {error && <div className="callout--error connect__error">{error}</div>}
      </div>
    </div>
  );
}
