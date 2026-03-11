import { describe, it, expect, beforeEach, vi } from 'vitest';
import { addWorkflow, removeWorkflow, updateWorkflow, getWorkflows } from './useWorkflows';

// Mock localStorage
const store: Record<string, string> = {};

vi.stubGlobal('localStorage', {
  getItem: (key: string) => store[key] ?? null,
  setItem: (key: string, value: string) => { store[key] = value; },
  removeItem: (key: string) => { delete store[key]; },
});

describe('useWorkflows store', () => {
  beforeEach(() => {
    // Clear stored workflows
    delete store['termpod-workflows'];
    // Reset internal state by re-importing — instead, remove all workflows
    for (const w of getWorkflows()) {
      removeWorkflow(w.id);
    }
  });

  it('starts with empty workflows', () => {
    expect(getWorkflows()).toHaveLength(0);
  });

  it('adds a workflow', () => {
    const wf = addWorkflow('Deploy', 'git push origin main');

    expect(wf.name).toBe('Deploy');
    expect(wf.command).toBe('git push origin main');
    expect(wf.id).toMatch(/^wf-/);
    expect(getWorkflows()).toHaveLength(1);
  });

  it('adds a workflow with category', () => {
    const wf = addWorkflow('Build', 'npm run build', 'dev');

    expect(wf.category).toBe('dev');
  });

  it('removes a workflow', () => {
    const wf = addWorkflow('Test', 'npm test');
    expect(getWorkflows()).toHaveLength(1);

    removeWorkflow(wf.id);
    expect(getWorkflows()).toHaveLength(0);
  });

  it('updates a workflow', () => {
    const wf = addWorkflow('Lint', 'eslint .');
    updateWorkflow(wf.id, { name: 'Lint All', command: 'eslint . --fix' });

    const updated = getWorkflows().find((w) => w.id === wf.id);
    expect(updated!.name).toBe('Lint All');
    expect(updated!.command).toBe('eslint . --fix');
  });

  it('persists to localStorage', () => {
    addWorkflow('Save test', 'echo hello');

    const raw = store['termpod-workflows'];
    expect(raw).toBeDefined();

    const parsed = JSON.parse(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('Save test');
  });

  it('generates unique ids', () => {
    const wf1 = addWorkflow('First', 'cmd1');
    const wf2 = addWorkflow('Second', 'cmd2');

    expect(wf1.id).not.toBe(wf2.id);
  });

  it('removing non-existent id is a no-op', () => {
    addWorkflow('Keep', 'cmd');
    removeWorkflow('non-existent');

    expect(getWorkflows()).toHaveLength(1);
  });

  it('update preserves fields not in patch', () => {
    const wf = addWorkflow('Original', 'cmd', 'cat');
    updateWorkflow(wf.id, { name: 'Renamed' });

    const updated = getWorkflows().find((w) => w.id === wf.id);
    expect(updated!.command).toBe('cmd');
    expect(updated!.category).toBe('cat');
  });
});
