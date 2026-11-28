import { useState } from "react";
import type { CheckConstraint, EnumType } from "./types.ts";
import { readEnum } from "./schema-constraints.ts";
import { messageOf } from "./utils.ts";

export function ChecksEditor({
  checks,
  onChange,
}: {
  checks: CheckConstraint[];
  onChange: (checks: CheckConstraint[]) => void;
}) {
  function patch(index: number, change: Partial<CheckConstraint>) {
    onChange(checks.map((c, i) => (i === index ? { ...c, ...change } : c)));
  }
  return (
    <section className="key-list value-constraints" aria-label="CHECK 制約">
      <div className="definition-heading">
        <h3>CHECK 制約</h3>
        <button
          type="button"
          aria-label="CHECK 制約を追加"
          onClick={() => onChange([...checks, { name: "", expression: "" }])}
        >
          ＋ 追加
        </button>
      </div>
      {checks.map((c, i) => (
        <div className="check-fields" key={i}>
          <label className="definition-field">
            制約名（任意）
            <input
              aria-label={`CHECK ${i + 1}の制約名`}
              maxLength={80}
              value={c.name}
              onChange={(e) => patch(i, { name: e.target.value })}
            />
          </label>
          <label className="definition-field">
            条件式（SQL）
            <textarea
              required
              rows={2}
              aria-label={`CHECK ${i + 1}の条件式`}
              placeholder="例: total >= 0"
              value={c.expression}
              onChange={(e) => patch(i, { expression: e.target.value })}
            />
          </label>
          <button
            type="button"
            aria-label={`CHECK ${i + 1}を削除`}
            onClick={() => onChange(checks.filter((_, j) => j !== i))}
          >
            削除
          </button>
        </div>
      ))}
    </section>
  );
}

export function EnumEditor({
  enums,
  used,
  onChange,
  onEditing,
}: {
  enums: EnumType[];
  used: (name: string) => boolean;
  onChange: (old: string | undefined, entry?: EnumType) => void;
  onEditing: (editing: boolean) => void;
}) {
  const [draft, setDraft] = useState<EnumType>();
  const [original, setOriginal] = useState<string>();
  const [error, setError] = useState("");
  function edit(entry?: EnumType) {
    setDraft(entry ?? { name: "", values: [""] });
    setOriginal(entry?.name);
    setError("");
    onEditing(true);
  }
  function close() {
    setDraft(undefined);
    onEditing(false);
  }
  function save() {
    try {
      const e = readEnum(draft!);
      if (e.name !== original && enums.some((other) => other.name === e.name))
        throw new Error("同じ名前の ENUM があります。");
      onChange(original, e);
      close();
    } catch (err) {
      setError(messageOf(err));
    }
  }
  return (
    <section className="key-list value-constraints" aria-label="ENUM 型">
      <div className="definition-heading">
        <h3>ENUM 型</h3>
        <button
          type="button"
          aria-label="ENUM 型を追加"
          disabled={!!draft}
          onClick={() => edit()}
        >
          ＋ 追加
        </button>
      </div>
      {enums.length > 0 && (
        <table>
          <tbody>
            {enums.map((e) => (
              <tr key={e.name}>
                <td>{e.name}</td>
                <td>{e.values.join("、")}</td>
                <td>
                  <button
                    type="button"
                    className="reference-link"
                    aria-label={e.name + "を編集"}
                    disabled={!!draft}
                    onClick={() => edit(e)}
                  >
                    編集
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {draft && (
        <div className="definition-editor enum-editor">
          <label className="definition-field">
            型名
            <input
              autoFocus
              maxLength={40}
              placeholder="例: order_status"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <div className="definition-field">
            <span>値（順序）</span>
            {draft.values.map((v, i) => (
              <div key={i} className="enum-value">
                <textarea
                  rows={1}
                  aria-label={`ENUM の値${i + 1}`}
                  value={v}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      values: draft.values.map((old, j) =>
                        i === j ? e.target.value : old,
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  aria-label={`値${i + 1}を外す`}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      values: draft.values.filter((_, j) => i !== j),
                    })
                  }
                >
                  ×
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setDraft({ ...draft, values: [...draft.values, ""] })
              }
            >
              ＋ 値
            </button>
          </div>
          {original && used(original) && (
            <p className="empty-definitions">
              使用中の型です。削除するには、カラムの型を変更してください。
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <div className="enum-actions">
            {original && (
              <button
                type="button"
                disabled={used(original)}
                onClick={() => {
                  onChange(original);
                  close();
                }}
              >
                型を削除
              </button>
            )}
            <button type="button" onClick={close}>
              キャンセル
            </button>
            <button type="button" onClick={save}>
              完了
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
