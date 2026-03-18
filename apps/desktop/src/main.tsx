import * as Sentry from '@sentry/react';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.DEV ? 'development' : 'production',
    enabled: !import.meta.env.DEV,
    tracesSampleRate: 0.1,
  });
}

// Disable devtools shortcuts in production
if (!import.meta.env.DEV) {
  document.addEventListener('keydown', (e) => {
    // Block Cmd+Option+I (Inspector), Cmd+Option+J (Console), Cmd+Option+C (Elements)
    if (e.metaKey && e.altKey && ['i', 'j', 'c'].includes(e.key.toLowerCase())) {
      e.preventDefault();
    }
    // Block Cmd+Shift+C (Inspect element)
    if (e.metaKey && e.shiftKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
    }
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Dismiss splash screen after React mounts
const splash = document.getElementById('splash');
if (splash) {
  splash.classList.add('hidden');
  splash.addEventListener('transitionend', () => splash.remove());
}
