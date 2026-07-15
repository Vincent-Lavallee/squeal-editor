import { useSession } from './store/sessionSlice.ts';
import Shell from './Shell.tsx';
import { ConnectScreen } from './features/connections/index.ts';

/** `connected` is the whole routing logic: no connection, no shell. */
export default function App() {
  const { connected } = useSession();
  return connected ? <Shell /> : <ConnectScreen />;
}
