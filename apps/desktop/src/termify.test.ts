import { describe, it, expect } from 'vitest';
import { getTermifyPayload } from './termify';

describe('getTermifyPayload', () => {
  it('returns a string starting with a space (to avoid history)', () => {
    const payload = getTermifyPayload();
    expect(payload[0]).toBe(' ');
  });

  it('ends with a newline', () => {
    const payload = getTermifyPayload();
    expect(payload.endsWith('\n')).toBe(true);
  });

  it('ends with clear before the newline', () => {
    const payload = getTermifyPayload();
    expect(payload.trimEnd().endsWith('clear')).toBe(true);
  });

  it('contains zsh detection', () => {
    const payload = getTermifyPayload();
    expect(payload).toContain('$ZSH_VERSION');
  });

  it('contains bash detection', () => {
    const payload = getTermifyPayload();
    expect(payload).toContain('$BASH_VERSION');
  });

  it('contains OSC 133 markers for both shells', () => {
    const payload = getTermifyPayload();
    expect(payload).toContain('133;A');
    expect(payload).toContain('133;B');
    expect(payload).toContain('133;C');
    expect(payload).toContain('133;D');
  });

  it('contains OSC 134 autocomplete markers for zsh', () => {
    const payload = getTermifyPayload();
    expect(payload).toContain('134;input');
    expect(payload).toContain('134;execute');
  });

  it('contains bash readline capture hooks for OSC 134', () => {
    const payload = getTermifyPayload();
    expect(payload).toContain('READLINE_LINE');
    expect(payload).toContain('__termpod_capture_input');
    expect(payload).toContain('bind -x');
  });

  it('does not have semicolons after then keywords', () => {
    const payload = getTermifyPayload();
    expect(payload).not.toMatch(/then\s*;/);
  });

  it('sets TERMPOD_SHELL_INTEGRATION guard variable', () => {
    const payload = getTermifyPayload();
    expect(payload).toContain('TERMPOD_SHELL_INTEGRATION=1');
  });
});
