import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';

import {
    AI_DELTA_EVENT,
    AWS_SSO_PROMPT_EVENT,
    CONNECT_PROGRESS_EVENT,
    CONNECTION_STATE_EVENT,
    UPDATE_PROGRESS_EVENT,
    type AiDelta,
    type AwsSsoPrompt,
    type ConnectionState,
    type ConnectProgress,
    type UpdateProgress,
} from '../../shared/protocol/index.ts';
import App from './App.tsx';
import { store } from './store/index.ts';
import { deltaReceived, loadAiStatus } from './store/assistantSlice.ts';
import { promptReceived } from './store/awsSignInSlice.ts';
import { connectionProgressReceived, connectionStateReceived } from './store/sessionSlice.ts';
import { loadSettings } from './store/settingsSlice.ts';
import { progressReceived } from './store/updaterSlice.ts';
import { initBridge } from './common/bridge/bridge.ts';
import './styles/residual.css';

initBridge();

// The preferences, read once before anything that draws one. A call made before
// the extension is up simply waits, so this needs no ordering against the bridge
// coming alive -- and every reader falls back to its own default until it lands.
void store.dispatch(loadSettings());

// Whether an API key is stored is an app-level fact now that the status bar
// states it, so it is read once here rather than by whichever component happens
// to draw first -- the assistant tab may never be opened, and the segment that
// names the provider must not depend on it having been.
void store.dispatch(loadAiStatus());

// Download progress is broadcast, not a reply to any request, so it is heard
// here rather than through `bridge.call`. The store is the composition root's,
// so this is where the extension's out-of-band event meets it.
void Neutralino.events.on(UPDATE_PROGRESS_EVENT, (evt: CustomEvent) => {
    store.dispatch(progressReceived(evt.detail as UpdateProgress));
});

// Connection progress is the same fire-and-forget pattern as update progress.
void Neutralino.events.on(CONNECT_PROGRESS_EVENT, (evt: CustomEvent) => {
    store.dispatch(connectionProgressReceived(evt.detail as ConnectProgress));
});

// A connection dropping is the one of these three that nobody asked for: it is
// the server hanging up on a session already open, so it can only ever arrive
// this way rather than as the reply to a command.
void Neutralino.events.on(CONNECTION_STATE_EVENT, (evt: CustomEvent) => {
    store.dispatch(connectionStateReceived(evt.detail as ConnectionState));
});

// What `aws sso login` is waiting for. Not progress: the URL and the code *are*
// the interaction, and they arrive while the command is still running, so they
// cannot ride back on its reply.
void Neutralino.events.on(AWS_SSO_PROMPT_EVENT, (evt: CustomEvent) => {
    store.dispatch(promptReceived(evt.detail as AwsSsoPrompt));
});

// A model's answer filling in. `ai.send` resolves with the finished message; this
// is only what is on screen in between, the same split update progress draws.
void Neutralino.events.on(AI_DELTA_EVENT, (evt: CustomEvent) => {
    store.dispatch(deltaReceived(evt.detail as AiDelta));
});

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');

createRoot(root).render(
    <React.StrictMode>
        <Provider store={store}>
            <App />
        </Provider>
    </React.StrictMode>,
);
