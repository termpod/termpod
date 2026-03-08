import { describe, expect, it, vi } from 'vitest';
import { PromptDetector } from './promptDetector.js';

describe('PromptDetector', () => {
  describe('basic prompt detection', () => {
    it('detects "Do you want to allow" pattern', () => {
      const detector = new PromptDetector();
      const listener = vi.fn();
      detector.setListener(listener);

      detector.feed('Do you want to allow Read file.ts?');

      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0]).toMatchObject({
        type: 'permission',
        tool: 'Read',
        detail: 'file.ts',
      });
    });

    it('detects "Allow Tool: detail?" pattern', () => {
      const detector = new PromptDetector();
      const listener = vi.fn();
      detector.setListener(listener);

      detector.feed('Allow Bash: ls -la?');

      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0]).toMatchObject({
        tool: 'Bash',
        detail: 'ls -la',
      });
    });

    it('detects tool use prompt with dash separator', () => {
      const detector = new PromptDetector();
      const listener = vi.fn();
      detector.setListener(listener);

      detector.feed('  Read ─ /path/to/file.ts');

      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0]).toMatchObject({
        tool: 'Read',
        detail: '/path/to/file.ts',
      });
    });

    it('detects all supported tools in dash pattern', () => {
      const tools = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebFetch', 'WebSearch', 'NotebookEdit'];

      for (const tool of tools) {
        const detector = new PromptDetector();
        const listener = vi.fn();
        detector.setListener(listener);

        detector.feed(`  ${tool} ─ some detail here`);

        expect(listener).toHaveBeenCalledOnce();
        expect(listener.mock.calls[0][0].tool).toBe(tool);
      }
    });
  });

  describe('ANSI stripping', () => {
    it('strips ANSI escape sequences before matching', () => {
      const detector = new PromptDetector();
      const listener = vi.fn();
      detector.setListener(listener);

      detector.feed('\x1b[1m\x1b[33mAllow Edit: config.json?\x1b[0m');

      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0]).toMatchObject({
        tool: 'Edit',
        detail: 'config.json',
      });
    });

    it('strips OSC sequences', () => {
      const detector = new PromptDetector();
      const listener = vi.fn();
      detector.setListener(listener);

      detector.feed('\x1b]0;title\x07Allow Write: out.txt?');

      expect(listener).toHaveBeenCalledOnce();
      expect(listener.mock.calls[0][0].tool).toBe('Write');
    });
  });

  describe('prompt resolution', () => {
    it('clears prompt when "Allowed" is detected', () => {
      const detector = new PromptDetector();
      const listener = vi.fn();
      detector.setListener(listener);

      detector.feed('Allow Bash: rm -rf /tmp/test?');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).not.toBeNull();

      detector.feed('Allowed');
      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener.mock.calls[1][0]).toBeNull();
    });

    it('clears prompt when "Denied" is detected', () => {
      const detector = new PromptDetector();
      const listener = vi.fn();
      detector.setListener(listener);

      detector.feed('Allow Read: secret.key?');
      detector.feed('Denied');

      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener.mock.calls[1][0]).toBeNull();
    });

    it('clears prompt when "Skipped" is detected', () => {
      const detector = new PromptDetector();
      const listener = vi.fn();
      detector.setListener(listener);

      detector.feed('Allow Write: file.txt?');
      detector.feed('Skipped');

      expect(listener).toHaveBeenCalledTimes(2);
      expect(listener.mock.calls[1][0]).toBeNull();
    });
  });

  describe('deduplication', () => {
    it('does not fire listener for same prompt repeatedly', () => {
      const detector = new PromptDetector();
      const listener = vi.fn();
      detector.setListener(listener);

      detector.feed('Allow Read: file.ts?');
      detector.feed('more data but same prompt in buffer');

      // Should only fire once since the buffer still contains the same prompt
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('fires listener for different prompts', () => {
      const detector = new PromptDetector();
      const listener = vi.fn();
      detector.setListener(listener);

      detector.feed('Allow Read: file1.ts?');

      // Resolve first prompt, then detect new one
      detector.feed('Allowed');
      detector.feed('Allow Read: file2.ts?');

      expect(listener).toHaveBeenCalledTimes(3); // prompt, null, prompt
      expect(listener.mock.calls[0][0].detail).toBe('file1.ts');
      expect(listener.mock.calls[2][0].detail).toBe('file2.ts');
    });
  });

  describe('buffer management', () => {
    it('truncates buffer when exceeding 4096 chars', () => {
      const detector = new PromptDetector();
      const listener = vi.fn();
      detector.setListener(listener);

      // Fill with garbage, then add prompt near the end
      detector.feed('x'.repeat(5000));
      detector.feed('Allow Bash: echo hello?');

      expect(listener).toHaveBeenCalledOnce();
    });
  });

  describe('clear', () => {
    it('resets buffer and current prompt', () => {
      const detector = new PromptDetector();
      const listener = vi.fn();
      detector.setListener(listener);

      detector.feed('Allow Read: file.ts?');
      expect(listener).toHaveBeenCalledTimes(1);

      detector.clear();

      // After clear, same prompt should fire again since state is reset
      detector.feed('Allow Read: file.ts?');
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  describe('no listener', () => {
    it('does not throw when no listener is set', () => {
      const detector = new PromptDetector();

      expect(() => {
        detector.feed('Allow Read: file.ts?');
        detector.feed('Allowed');
      }).not.toThrow();
    });
  });
});
