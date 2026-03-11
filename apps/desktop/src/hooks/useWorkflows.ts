import { useCallback, useSyncExternalStore } from 'react';

export interface Workflow {
  id: string;
  name: string;
  command: string;
  category?: string;
  createdAt: number;
}

const STORAGE_KEY = 'termpod-workflows';

function generateId(): string {
  return `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function load(): Workflow[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (raw) {
      return JSON.parse(raw);
    }
  } catch {
    // ignore
  }

  return [];
}

function save(workflows: Workflow[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workflows));
}

const listeners = new Set<() => void>();
let current = load();

function subscribe(listener: () => void) {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): Workflow[] {
  return current;
}

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

function update(next: Workflow[]): void {
  current = next;
  save(current);
  emit();
}

export function addWorkflow(name: string, command: string, category?: string): Workflow {
  const workflow: Workflow = {
    id: generateId(),
    name,
    command,
    category,
    createdAt: Date.now(),
  };

  update([...current, workflow]);

  return workflow;
}

export function removeWorkflow(id: string): void {
  update(current.filter((w) => w.id !== id));
}

export function updateWorkflow(id: string, patch: Partial<Pick<Workflow, 'name' | 'command' | 'category'>>): void {
  update(current.map((w) => (w.id === id ? { ...w, ...patch } : w)));
}

export function getWorkflows(): Workflow[] {
  return current;
}

export function useWorkflows() {
  const workflows = useSyncExternalStore(subscribe, getSnapshot);

  const add = useCallback((name: string, command: string, category?: string) => {
    return addWorkflow(name, command, category);
  }, []);

  const remove = useCallback((id: string) => {
    removeWorkflow(id);
  }, []);

  const edit = useCallback((id: string, patch: Partial<Pick<Workflow, 'name' | 'command' | 'category'>>) => {
    updateWorkflow(id, patch);
  }, []);

  return { workflows, add, remove, edit };
}
