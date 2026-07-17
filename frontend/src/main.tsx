import React from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';

import { UPDATE_PROGRESS_EVENT, type UpdateProgress } from '../../shared/protocol.ts';
import App from './App.tsx';
import { store } from './store/index.ts';
import { progressReceived } from './store/updaterSlice.ts';
import { initBridge } from './bridge.ts';
import './styles/index.css';

initBridge();

// Download progress is broadcast, not a reply to any request, so it is heard
// here rather than through `bridge.call`. The store is the composition root's,
// so this is where the extension's out-of-band event meets it.
void Neutralino.events.on(UPDATE_PROGRESS_EVENT, (evt: CustomEvent) => {
  store.dispatch(progressReceived(evt.detail as UpdateProgress));
});

const root = document.getElementById('root');
if (!root) throw new Error('#root missing from index.html');

createRoot(root).render(
  <React.StrictMode>
    <Provider store={store}>
      <App />
    </Provider>
  </React.StrictMode>
);
