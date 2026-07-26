import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { AppStateProvider } from './state/index.js';
import './app.css';

const container = document.getElementById('root');
if (!container) {
  throw new Error('missing #root element');
}

createRoot(container).render(
  <StrictMode>
    <AppStateProvider>
      <App />
    </AppStateProvider>
  </StrictMode>,
);
