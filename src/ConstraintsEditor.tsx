import type { Diagram, ForeignKey, KeyDefinition, Table } from "./types.ts";
import { childMaximum } from "./relationships.ts";
import { title } from "./model.ts";
export const keyLabel = (kind: KeyDefinition["kind"]) =>
  kind === "primary"
    ? "主キー"
    : kind === "unique"
      ? "一意制約"
      : "インデックス";
const columnName = (table: Table, id: string) =>
  table.columns.find((c) => c.id === id)?.name ?? "未選択";
export type DefinitionSelection =
  | { kind: "key"; id: string; before?: KeyDefinition }
  | { kind: "foreign"; id: string; before?: ForeignKey };

export function KeyList({
  table,
  onEdit,
  onAdd,
  disabled,
}: {
  table: Table;
  onEdit: (id: string) => void;
  onAdd: () => void;
  disabled: boolean;
}) {
  return (
    <section className="key-list" aria-label="キー・インデックス">
      <div className="definition-heading">
        <h3>キー・インデックス</h3>
        <button type="button" disabled={disabled} onClick={onAdd}>
          ＋ 追加
        </button>
      </div>
      {(table.keys?.length ?? 0) > 0 ? (
        <table>
          <thead>
            <tr>
              <th>種類</th>
              <th>カラム（順序）</th>
              <th>
                <span className="sr-only">操作</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {table.keys!.map((k) => (
              <tr key={k.id}>
                <td>{keyLabel(k.kind)}</td>
                <td>
                  {k.columnIds.map((id) => columnName(table, id)).join(", ") ||
                    "未選択"}
                </td>
                <td>
                  <button
                    type="button"
                    className="reference-link"
                    disabled={disabled}
                    aria-label={`${keyLabel(k.kind)} ${k.columnIds.map((id) => columnName(table, id)).join(", ")}を編集`}
                    onClick={() => onEdit(k.id)}
                  >
                    編集
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="empty-definitions">未設定</p>
      )}
    </section>
  );
}

function ColumnPicker({
  table,
  ids,
  onChange,
}: {
  table: Table;
  ids: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <>
      <div className="column-picker" role="group" aria-label="対象カラム">
        {table.columns.map((c) => (
          <label key={c.id}>
            <input
              type="checkbox"
              aria-label={`${c.name}を対象カラムに含める`}
              checked={ids.includes(c.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...ids, c.id]
                    : ids.filter((id) => id !== c.id),
                )
              }
            />
            {c.name}
          </label>
        ))}
      </div>
      <ol className="selected-columns" aria-label="カラムの順序">
        {ids.map((id, i) => (
          <li key={id}>
            <span className="column-order">{i + 1}</span>
            <span>{columnName(table, id)}</span>
            <button
              type="button"
              disabled={!i}
              aria-label={`${columnName(table, id)}を前へ`}
              onClick={() => {
                const next = [...ids];
                [next[i - 1], next[i]] = [next[i], next[i - 1]];
                onChange(next);
              }}
            >
              ←
            </button>
            <button
              type="button"
              disabled={i === ids.length - 1}
              aria-label={`${columnName(table, id)}を後へ`}
              onClick={() => {
                const next = [...ids];
                [next[i + 1], next[i]] = [next[i], next[i + 1]];
                onChange(next);
              }}
            >
              →
            </button>
          </li>
        ))}
      </ol>
    </>
  );
}

export function DefinitionEditor({
  draft,
  state,
  selection,
  onChange,
  onDone,
  onCancel,
  onDelete,
}: {
  draft: Table;
  state: Diagram;
  selection: DefinitionSelection;
  onChange: (t: Table) => void;
  onDone: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const key =
    selection.kind === "key"
      ? draft.keys?.find((k) => k.id === selection.id)
      : undefined;
  const fk =
    selection.kind === "foreign"
      ? draft.foreignKeys?.find((f) => f.id === selection.id)
      : undefined;
  const patchKey = (patch: Partial<KeyDefinition>) =>
    onChange({
      ...draft,
      keys: draft.keys?.map((k) =>
        k.id === selection.id ? { ...k, ...patch } : k,
      ),
    });
  const patchFk = (patch: Partial<ForeignKey>) =>
    onChange({
      ...draft,
      foreignKeys: draft.foreignKeys?.map((f) =>
        f.id === selection.id ? { ...f, ...patch } : f,
      ),
    });
  const tables = [...state.tables.filter((t) => t.id !== draft.id), draft];
  const target = tables.find((t) => t.id === fk?.target?.tableId);
  const candidates = (t: Table) =>
    t.keys?.filter(
      (k) =>
        k.kind !== "index" &&
        k.columnIds.length &&
        new Set(k.columnIds).size === k.columnIds.length &&
        k.columnIds.every((id) => t.columns.some((c) => c.id === id)),
    ) ?? [];
  const targetKeys = target ? candidates(target) : [];
  const selectedKey = targetKeys.find(
    (k) =>
      JSON.stringify(k.columnIds) === JSON.stringify(fk?.target?.columnIds),
  );
  const fkIndex =
    (draft.foreignKeys?.findIndex((f) => f.id === fk?.id) ?? -1) + 1;
  function chooseTarget(tableId: string) {
    const t = tables.find((t) => t.id === tableId),
      keys = t ? candidates(t) : [];
    const ids = keys.length === 1 ? keys[0].columnIds : [];
    patchFk({
      target: t ? { tableId, columnIds: [...ids] } : undefined,
      columnIds: ids.length
        ? ids.map((_, i) => fk!.columnIds[i] ?? "")
        : fk!.columnIds,
    });
  }
  const complete = key
    ? key.columnIds.length > 0
    : !!fk &&
      fk.columnIds.length > 0 &&
      fk.columnIds.every(Boolean) &&
      (!fk.target || !!selectedKey);
  const targetSelect =
    fk && target ? (
      <select
        aria-label={`外部キー${fkIndex}の参照先キー`}
        value={selectedKey?.id ?? ""}
        onChange={(e) => {
          const k = targetKeys.find((k) => k.id === e.target.value);
          patchFk({
            target: {
              tableId: target.id,
              columnIds: k ? [...k.columnIds] : [],
            },
            columnIds: k
              ? k.columnIds.map((_, i) => fk.columnIds[i] ?? "")
              : fk.columnIds,
          });
        }}
      >
        <option value="">
          {targetKeys.length ? "カラムを選択" : "参照できるキーがありません"}
        </option>
        {targetKeys.map((k) => (
          <option key={k.id} value={k.id}>
            {k.columnIds.map((id) => columnName(target, id)).join(", ")}（
            {keyLabel(k.kind)}）
          </option>
        ))}
      </select>
    ) : (
      <span>未設定</span>
    );
  if (!key && !fk) return null;
  return (
    <section
      className="definition-editor"
      aria-label={key ? "キー・インデックスを編集" : "外部キーを編集"}
    >
      <div className="definition-heading">
        <h3>{key ? "キー・インデックスを編集" : "外部キー"}</h3>
        <button
          type="button"
          aria-label="定義の編集をキャンセル"
          onClick={onCancel}
        >
          ×
        </button>
      </div>
      {key && (
        <>
          <label className="definition-field">
            種類
            <select
              aria-label="キーの種類"
              value={key.kind}
              onChange={(e) =>
                patchKey({ kind: e.target.value as KeyDefinition["kind"] })
              }
            >
              <option
                value="primary"
                disabled={draft.keys?.some(
                  (k) => k.kind === "primary" && k.id !== key.id,
                )}
              >
                主キー
              </option>
              <option value="unique">一意制約</option>
              <option value="index">インデックス</option>
            </select>
          </label>
          <ColumnPicker
            table={draft}
            ids={key.columnIds}
            onChange={(columnIds) => patchKey({ columnIds })}
          />
          <details className="definition-name">
            <summary>
              {key.kind === "index" ? "インデックス名" : "制約名"}（任意）
              {key.name ? `：${key.name}` : ""}
            </summary>
            <input
              aria-label="キーの名前"
              maxLength={80}
              value={key.name}
              onChange={(e) => patchKey({ name: e.target.value })}
            />
          </details>
        </>
      )}
      {fk && (
        <>
          <div className="reference-tables">
            <strong>{title(draft)}</strong>
            <span aria-hidden="true">→</span>
            <label className="definition-field">
              <span>参照先テーブル</span>
              <select
                aria-label={`外部キー${fkIndex}の参照先テーブル`}
                value={fk.target?.tableId ?? ""}
                onChange={(e) => chooseTarget(e.target.value)}
              >
                <option value="">未設定</option>
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>
                    {title(t)}
                    {t.id === draft.id ? "（このテーブル）" : ""}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {target && fk.columnIds.length > 1 && (
            <label className="definition-field target-key-picker">
              参照先カラム
              {targetSelect}
            </label>
          )}
          <div
            className="mapping-grid"
            role="group"
            aria-label={`外部キー${fkIndex}のカラム対応`}
          >
            {fk.columnIds.map((id, i) => (
              <div className="mapping-row" key={i}>
                <select
                  aria-label={`外部キー${fkIndex}の参照元 ${i + 1}`}
                  value={id}
                  onChange={(e) =>
                    patchFk({
                      columnIds: fk.columnIds.map((c, j) =>
                        j === i ? e.target.value : c,
                      ),
                    })
                  }
                >
                  <option value="">カラムを選択</option>
                  {draft.columns.map((c) => (
                    <option
                      key={c.id}
                      value={c.id}
                      disabled={c.id !== id && fk.columnIds.includes(c.id)}
                    >
                      {c.name}
                    </option>
                  ))}
                </select>
                <span aria-hidden="true">→</span>
                <span className="mapping-target">
                  {fk.columnIds.length === 1
                    ? targetSelect
                    : target && fk.target?.columnIds[i]
                      ? columnName(target, fk.target.columnIds[i])
                      : "未設定"}
                </span>
                {!selectedKey && (
                  <button
                    type="button"
                    aria-label={`外部キー${fkIndex}の対応${i + 1}を外す`}
                    disabled={fk.columnIds.length === 1}
                    onClick={() =>
                      patchFk({
                        columnIds: fk.columnIds.filter((_, j) => j !== i),
                      })
                    }
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
          </div>
          {!fk.target && (
            <div className="pending-reference">
              <button
                type="button"
                className="reference-link"
                onClick={() => patchFk({ columnIds: [...fk.columnIds, ""] })}
              >
                ＋ カラム
              </button>
              <span>参照先未設定</span>
            </div>
          )}
          {target && !targetKeys.length && (
            <p role="status" className="definition-error">
              参照先に主キーまたは一意制約が必要です。
            </p>
          )}
          {target && (
            <div className="relationship-fields">
              <label className="definition-field">
                <span>
                  {title(target)} → {title(draft)}
                </span>
                <input
                  aria-label="関係ラベル"
                  placeholder="関係ラベル（任意）"
                  maxLength={80}
                  value={fk.label ?? ""}
                  onChange={(e) => patchFk({ label: e.target.value })}
                />
              </label>
              <div className="cardinality-fields">
                {(["parentMinimum", "childMinimum"] as const).map((key) => {
                  const parent = key === "parentMinimum";
                  const many = !parent && childMaximum(draft, fk) === "many";
                  return (
                    <label className="definition-field" key={key}>
                      <span>{title(parent ? draft : target)} 1件に対して</span>
                      <span className="cardinality-value">
                        <span>{title(parent ? target : draft)}</span>
                        <select
                          aria-label={`${parent ? "参照先" : "参照元"}の件数`}
                          value={fk.cardinality?.[key] ?? ""}
                          onChange={(e) =>
                            patchFk({
                              cardinality: {
                                ...fk.cardinality,
                                [key]:
                                  e.target.value === ""
                                    ? undefined
                                    : (Number(e.target.value) as 0 | 1),
                              },
                            })
                          }
                        >
                          <option value="">
                            {many ? "多" : "1"}（下限未指定）
                          </option>
                          <option value="0">
                            {many ? "0件以上" : "0または1件"}
                          </option>
                          <option value="1">
                            {many ? "1件以上" : "必ず1件"}
                          </option>
                        </select>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          <details className="definition-name">
            <summary>制約名（任意）{fk.name ? `：${fk.name}` : ""}</summary>
            <input
              aria-label={`外部キー${fkIndex}の名前`}
              maxLength={80}
              value={fk.name}
              onChange={(e) => patchFk({ name: e.target.value })}
            />
          </details>
        </>
      )}
      <div className="definition-actions">
        <button type="button" className="danger" onClick={onDelete}>
          {key ? "この定義を削除" : "外部キーを削除"}
        </button>
        <span />
        <button type="button" onClick={onCancel}>
          編集を取り消す
        </button>
        <button type="button" disabled={!complete} onClick={onDone}>
          完了
        </button>
      </div>
    </section>
  );
}
