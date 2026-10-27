import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/600.css';
import './styles/global.css';
import { App } from './app/App';
import { STATIC } from './api/mode';

// The read-only viewer opens on the results; the local dashboard opens on a new run.
if (STATIC && !location.hash) history.replaceState(null, '', '#/results');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
