import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Disable right-click context menu and devtools shortcuts in production
if (!import.meta.env.DEV) {
  document.addEventListener('contextmenu', (e) => e.preventDefault());
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

createRoot(document.getElementById('root')!).render(<App />);
