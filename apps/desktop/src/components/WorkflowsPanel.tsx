import { useCallback, useEffect, useRef, useState } from 'react';
import type { Workflow } from '../hooks/useWorkflows';

interface WorkflowsPanelProps {
  workflows: Workflow[];
  onAdd: (name: string, command: string, category?: string) => void;
  onRemove: (id: string) => void;
  onEdit: (id: string, patch: Partial<Pick<Workflow, 'name' | 'command' | 'category'>>) => void;
  onRun: (command: string) => void;
  onClose: () => void;
}

export function WorkflowsPanel({
  workflows,
  onAdd,
  onRemove,
  onEdit,
  onRun,
  onClose,
}: WorkflowsPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editingId) {
          setEditingId(null);
        } else if (showAdd) {
          setShowAdd(false);
        } else {
          onClose();
        }
      }
    },
    [editingId, showAdd, onClose],
  );

  const categories = [...new Set(workflows.map((w) => w.category).filter(Boolean))] as string[];

  const filtered = search
    ? workflows.filter((w) => {
        const q = search.toLowerCase();
        return (
          w.name.toLowerCase().includes(q) ||
          w.command.toLowerCase().includes(q) ||
          (w.category?.toLowerCase().includes(q) ?? false)
        );
      })
    : workflows;

  // Group by category
  const uncategorized = filtered.filter((w) => !w.category);
  const grouped = categories
    .map((cat) => ({ category: cat, items: filtered.filter((w) => w.category === cat) }))
    .filter((g) => g.items.length > 0);

  return (
    <div className="modal-overlay" onClick={onClose} onKeyDown={handleKeyDown}>
      <div className="wf-modal" onClick={(e) => e.stopPropagation()}>
        <div className="wf-header">
          <h2 className="wf-title">Workflows</h2>
          <div className="wf-header-actions">
            <button className="wf-add-btn" onClick={() => setShowAdd(true)} type="button">
              + New
            </button>
            <button className="sp-close-btn" onClick={onClose} type="button">
              <svg width="10" height="10" viewBox="0 0 10 10">
                <path
                  d="M1 1l8 8M9 1l-8 8"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>

        <div className="wf-search-wrap">
          <input
            ref={searchRef}
            className="wf-search"
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search workflows..."
            spellCheck={false}
          />
        </div>

        <div className="wf-body">
          {showAdd && (
            <WorkflowForm
              categories={categories}
              onSave={(name, command, category) => {
                onAdd(name, command, category);
                setShowAdd(false);
              }}
              onCancel={() => setShowAdd(false)}
            />
          )}

          {filtered.length === 0 && !showAdd && (
            <div className="wf-empty">
              {workflows.length === 0
                ? 'No workflows yet. Click "+ New" to create one.'
                : 'No matching workflows.'}
            </div>
          )}

          {uncategorized.length > 0 && (
            <div className="wf-group">
              {uncategorized.map((w) => (
                <WorkflowItem
                  key={w.id}
                  workflow={w}
                  editing={editingId === w.id}
                  categories={categories}
                  onStartEdit={() => setEditingId(w.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onEdit={onEdit}
                  onRemove={onRemove}
                  onRun={onRun}
                />
              ))}
            </div>
          )}

          {grouped.map((g) => (
            <div key={g.category} className="wf-group">
              <div className="wf-group-label">{g.category}</div>
              {g.items.map((w) => (
                <WorkflowItem
                  key={w.id}
                  workflow={w}
                  editing={editingId === w.id}
                  categories={categories}
                  onStartEdit={() => setEditingId(w.id)}
                  onCancelEdit={() => setEditingId(null)}
                  onEdit={onEdit}
                  onRemove={onRemove}
                  onRun={onRun}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WorkflowItem({
  workflow,
  editing,
  categories,
  onStartEdit,
  onCancelEdit,
  onEdit,
  onRemove,
  onRun,
}: {
  workflow: Workflow;
  editing: boolean;
  categories: string[];
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onEdit: (id: string, patch: Partial<Pick<Workflow, 'name' | 'command' | 'category'>>) => void;
  onRemove: (id: string) => void;
  onRun: (command: string) => void;
}) {
  if (editing) {
    return (
      <WorkflowForm
        initial={workflow}
        categories={categories}
        onSave={(name, command, category) => {
          onEdit(workflow.id, { name, command, category });
          onCancelEdit();
        }}
        onCancel={onCancelEdit}
      />
    );
  }

  return (
    <div className="wf-item">
      <div className="wf-item-info" onClick={() => onRun(workflow.command)}>
        <div className="wf-item-name">{workflow.name}</div>
        <code className="wf-item-command">{workflow.command}</code>
      </div>
      <div className="wf-item-actions">
        <button
          className="wf-icon-btn"
          onClick={() => onRun(workflow.command)}
          title="Run"
          type="button"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path d="M3 1.5l7 4.5-7 4.5V1.5z" fill="currentColor" />
          </svg>
        </button>
        <button className="wf-icon-btn" onClick={onStartEdit} title="Edit" type="button">
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path
              d="M8.5 1.5l2 2L4 10H2V8l6.5-6.5z"
              stroke="currentColor"
              strokeWidth="1.2"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        <button
          className="wf-icon-btn wf-icon-btn-danger"
          onClick={() => onRemove(workflow.id)}
          title="Delete"
          type="button"
        >
          <svg width="12" height="12" viewBox="0 0 12 12">
            <path
              d="M2 3h8M4.5 3V2h3v1M3 3v7a1 1 0 001 1h4a1 1 0 001-1V3"
              stroke="currentColor"
              strokeWidth="1.1"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

function WorkflowForm({
  initial,
  categories,
  onSave,
  onCancel,
}: {
  initial?: Workflow;
  categories: string[];
  onSave: (name: string, command: string, category?: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [command, setCommand] = useState(initial?.command ?? '');
  const [category, setCategory] = useState(initial?.category ?? '');
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim() || !command.trim()) {
      return;
    }

    onSave(name.trim(), command.trim(), category.trim() || undefined);
  };

  return (
    <form className="wf-form" onSubmit={handleSubmit}>
      <input
        ref={nameRef}
        className="wf-form-input"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Workflow name"
        spellCheck={false}
      />
      <textarea
        className="wf-form-textarea"
        value={command}
        onChange={(e) => setCommand(e.target.value)}
        placeholder="Command(s) to run..."
        spellCheck={false}
        rows={3}
      />
      <div className="wf-form-row">
        <input
          className="wf-form-input wf-form-input-small"
          type="text"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          placeholder="Category (optional)"
          list="wf-categories"
          spellCheck={false}
        />
        {categories.length > 0 && (
          <datalist id="wf-categories">
            {categories.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        )}
        <div className="wf-form-buttons">
          <button className="wf-btn wf-btn-secondary" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="wf-btn wf-btn-primary"
            type="submit"
            disabled={!name.trim() || !command.trim()}
          >
            {initial ? 'Save' : 'Add'}
          </button>
        </div>
      </div>
    </form>
  );
}
