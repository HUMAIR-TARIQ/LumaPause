import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { createWebDemoBridge } from './web-demo-bridge';
import './styles/tokens.css';
import './styles/app.css';

const root = document.getElementById('root');
if (!root) throw new Error('The renderer root element is missing.');

// Electron injects this contract through the sandboxed preload. Vercel serves
// the same interface with a local-only, permanently labelled simulator.
if (!window.lumapause) {
  Object.defineProperty(window, 'lumapause', {
    value: createWebDemoBridge(),
    configurable: false,
    enumerable: false,
    writable: false,
  });
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
