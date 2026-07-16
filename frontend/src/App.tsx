import { useSession } from './store/sessionSlice.ts';
import Shell from './Shell.tsx';
import { ConnectScreen } from './features/connections/index.ts';
import { Titlebar } from './features/titlebar/index.ts';

/**
 * The titlebar is outside the routing: the window is borderless, so it carries
 * the only way to move, maximise or close the app, and that has to exist before
 * there is a connection. `connected` is still the whole routing logic below it.
 */
export default function App() {
  const { connected } = useSession();
  return (
    <>
      <Titlebar />
      <div className="app-body">{connected ? <Shell /> : <ConnectScreen />}</div>
    </>
  );
}
