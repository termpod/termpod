import { useCallback } from 'react';
import { Terminal } from '@termpod/ui';
import type { PtySize } from '@termpod/protocol';

export function App() {
  const handleData = useCallback((data: string) => {
    // TODO: Write data to PTY via Tauri command
    console.log('terminal input:', data);
  }, []);

  const handleResize = useCallback((size: PtySize) => {
    // TODO: Resize PTY via Tauri command
    console.log('terminal resize:', size);
  }, []);

  return (
    <div className="app">
      <Terminal onData={handleData} onResize={handleResize} />
    </div>
  );
}
