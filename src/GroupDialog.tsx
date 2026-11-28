import { useState } from "react";
import { Modal } from "./Dialogs.tsx";
import type { Diagram, Table, TableGroup } from "./types.ts";

export function GroupDialog({
  state,
  initial,
  displayTable,
  onClose,
  onApply,
}: {
  state: Diagram;
  initial: TableGroup;
  displayTable: (table: Table) => string;
  onClose: () => void;
  onApply: (groups: TableGroup[]) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [members, setMembers] = useState(new Set(initial.tableIds));
  const groups = state.groups ?? [];
  const editing = groups.some((g) => g.id === initial.id);
  return (
    <Modal id="group-dialog" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim() || !members.size) return;
          const updated = {
            id: initial.id,
            name: name.trim(),
            tableIds: [...members],
          };
          const next = groups
            .map((g) =>
              g.id === initial.id
                ? updated
                : {
                    ...g,
                    tableIds: g.tableIds.filter((id) => !members.has(id)),
                  },
            )
            .filter((g) => g.tableIds.length);
          onApply(editing ? next : [...next, updated]);
        }}
      >
        <div className="dialog-heading">
          <h2 id="group-heading">
            {editing ? "囲みを編集" : "テーブルを囲む"}
          </h2>
        </div>
        <div className="group-fields">
          <label className="field">
            囲みの名前
            <input
              autoFocus
              maxLength={80}
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <fieldset>
            <legend>テーブル</legend>
            {state.tables.map((t) => {
              const previous = groups.find(
                (g) => g.id !== initial.id && g.tableIds.includes(t.id),
              );
              return (
                <label key={t.id}>
                  <input
                    type="checkbox"
                    checked={members.has(t.id)}
                    onChange={(e) => {
                      const next = new Set(members);
                      if (e.target.checked) next.add(t.id);
                      else next.delete(t.id);
                      setMembers(next);
                    }}
                  />
                  {displayTable(t)}
                  {previous && <small>（{previous.name}）</small>}
                </label>
              );
            })}
          </fieldset>
        </div>
        <div className="dialog-actions">
          {editing && (
            <button
              type="button"
              onClick={() => onApply(groups.filter((g) => g.id !== initial.id))}
            >
              囲みを解除
            </button>
          )}
          <span />
          <button type="button" onClick={onClose}>
            キャンセル
          </button>
          <button className="primary" disabled={!name.trim() || !members.size}>
            {editing ? "保存" : "囲む"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
