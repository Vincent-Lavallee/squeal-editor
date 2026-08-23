import { useShell } from './shell/hooks/useShell.ts';
import { ConnectionRail } from './features/rail/index.ts';
import { ResultsProvider } from './features/results/index.ts';
import { StatusBar } from './features/statusbar/index.ts';
import ShellBody from './shell/ShellBody.tsx';
import ShellDialogs from './shell/ShellDialogs.tsx';

interface Props {
    onAddConnection: () => void;
    /**
     * A counter the titlebar's *Relationship diagram* bumps, because the menu is
     * `App`'s child and the tab it opens is this one's — see `App.tsx`. A counter
     * and not a flag for `focusFilter`'s reason: opening is an *event*, there is
     * no "off" state for a boolean to come back to, and asking twice has to mean
     * two tabs, which is the answer clicking a table twice already gives.
     */
    openDiagramRequest: number;
    /**
     * A counter the titlebar's assistant button bumps, exactly as
     * `openDiagramRequest` is and for its reason: the button is `App`'s child and
     * the tab it opens is this one's. Asking twice means two tabs, since an
     * assistant tab is a conversation and two conversations are a real thing to
     * want.
     */
    openAssistantRequest: number;
}

export default function Shell({
    onAddConnection,
    openDiagramRequest,
    openAssistantRequest,
}: Props) {
    return (
        <ResultsProvider>
            <ShellLayout
                onAddConnection={onAddConnection}
                openDiagramRequest={openDiagramRequest}
                openAssistantRequest={openAssistantRequest}
            />
        </ResultsProvider>
    );
}

function ShellLayout({ onAddConnection, openDiagramRequest, openAssistantRequest }: Props) {
    const s = useShell({ openDiagramRequest, openAssistantRequest });

    return (
        <div
            style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                height: '100%',
                minHeight: 0,
            }}
        >
            <ConnectionRail onAdd={onAddConnection} />
            <ShellBody s={s} />
            <StatusBar />
            <ShellDialogs s={s} />
        </div>
    );
}
