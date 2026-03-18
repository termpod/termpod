import { useCallback, useSyncExternalStore } from 'react';
import { ConfigStore } from '../lib/configStore';

export interface Workflow {
  id: string;
  name: string;
  command: string;
  category?: string;
  createdAt: number;
}

interface WorkflowsConfig {
  workflows: Workflow[];
}

function generateId(): string {
  return `wf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const workflowsStore = new ConfigStore<WorkflowsConfig>(
  'workflows.json',
  { workflows: [] },
  'termpod-workflows',
  {
    migrateLegacy: (raw) => JSON.stringify({ workflows: JSON.parse(raw) }),
  },
);

export function addWorkflow(name: string, command: string, category?: string): Workflow {
  const workflow: Workflow = {
    id: generateId(),
    name,
    command,
    category,
    createdAt: Date.now(),
  };

  const current = workflowsStore.getSnapshot();
  workflowsStore.update({ workflows: [...current.workflows, workflow] });

  return workflow;
}

export function removeWorkflow(id: string): void {
  const current = workflowsStore.getSnapshot();
  workflowsStore.update({ workflows: current.workflows.filter((w) => w.id !== id) });
}

export function updateWorkflow(
  id: string,
  patch: Partial<Pick<Workflow, 'name' | 'command' | 'category'>>,
): void {
  const current = workflowsStore.getSnapshot();
  workflowsStore.update({
    workflows: current.workflows.map((w) => (w.id === id ? { ...w, ...patch } : w)),
  });
}

export function getWorkflows(): Workflow[] {
  return workflowsStore.getSnapshot().workflows;
}

export function useWorkflows() {
  const { workflows } = useSyncExternalStore(workflowsStore.subscribe, workflowsStore.getSnapshot);

  const add = useCallback((name: string, command: string, category?: string) => {
    return addWorkflow(name, command, category);
  }, []);

  const remove = useCallback((id: string) => {
    removeWorkflow(id);
  }, []);

  const edit = useCallback(
    (id: string, patch: Partial<Pick<Workflow, 'name' | 'command' | 'category'>>) => {
      updateWorkflow(id, patch);
    },
    [],
  );

  return { workflows, add, remove, edit };
}
