import { useCallback, useState } from 'react';
import { Terminal, QuickActions } from '@termpod/ui';
import type { ConnectionStatus } from '@termpod/shared';

export function App() {
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');

  const handleData = useCallback((data: string) => {
    // TODO: Send data to relay via WebSocket
    console.log('mobile input:', data);
  }, []);

  const handleQuickAction = useCallback((value: string) => {
    // TODO: Send quick action to relay via WebSocket
    console.log('quick action:', value);
  }, []);

  return (
    <div className="app">
      <div className="status-bar">
        <span className={`status-indicator ${status}`} />
        <span>{status}</span>
      </div>
      <div className="terminal-container">
        <Terminal onData={handleData} />
      </div>
      <QuickActions onAction={handleQuickAction} />
    </div>
  );
}
