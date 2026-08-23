import PasswordPrompt from './PasswordPrompt.tsx';
import type { useConnectScreen } from './hooks/useConnectScreen.ts';
import type { Screen } from './connectScreenTypes.ts';

interface Props {
    c: ReturnType<typeof useConnectScreen>;
    resolved: Extract<Screen, { view: 'password' }>;
}

export default function ConnectScreenPasswordView({ c, resolved }: Props) {
    return (
        <PasswordPrompt
            connection={resolved.connection}
            connecting={c.session.connecting}
            onSubmit={(password) => void c.session.connectSaved(resolved.connection.id, password)}
            onCancel={() => c.go({ view: 'list', workspaceId: resolved.connection.workspaceId })}
        />
    );
}
