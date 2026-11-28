import { useRef, useState } from "react";
import type { Diagram } from "./types.ts";
import { Modal } from "./Dialogs.tsx";
import { importDDL } from "./ddl-import.ts";
import { messageOf } from "./utils.ts";

export function DdlImportDialog({
  state,
  onApply,
  onClose,
}: {
  state: Diagram;
  onApply: (
    diagram: Diagram,
    separate: boolean,
    title: string,
    count: number,
  ) => void;
  onClose: () => void;
}) {
  const [sql, setSql] = useState("");
  const [title, setTitle] = useState("");
  const [separate, setSeparate] = useState(false);
  const [preview, setPreview] = useState<ReturnType<typeof importDDL> | null>(
    null,
  );
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const version = useRef(0);
  function reset() {
    setPreview(null);
    setError("");
  }
  function apply() {
    try {
      if (sql.length > 2_000_000)
        throw new Error("DDL は2MBまで読み込めます。");
      const parsed = preview ?? importDDL(sql, separate ? undefined : state);
      if (!preview && parsed.issues.length) {
        setPreview(parsed);
        return;
      }
      if (!parsed.applied) throw new Error("読み込める定義がありません。");
      onApply(parsed.diagram, separate, title, parsed.tableCount);
      onClose();
    } catch (e) {
      setError(messageOf(e));
    }
  }
  return (
    <Modal id="ddl-import-dialog" onClose={onClose}>
      <div className="dialog-heading">
        <h2 id="ddl-import-heading">DDL を読み込む</h2>
        <button aria-label="閉じる" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="ddl-source">
        <label htmlFor="ddl-source">DDL を貼り付け</label>
        <button onClick={() => file.current?.click()}>
          SQL ファイルを開く
        </button>
        <input
          ref={file}
          type="file"
          accept=".sql,.ddl,text/plain,application/sql"
          hidden
          onChange={async (e) => {
            const selected = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (!selected) return;
            const request = ++version.current;
            setLoading(true);
            reset();
            try {
              if (selected.size > 2_000_000)
                throw new Error("ファイルの上限は2MBです。");
              const source = await selected.text();
              if (request !== version.current) return;
              setSql(source);
              setTitle(
                selected.name.replace(/\.(sql|ddl)$/i, "").slice(0, 200),
              );
            } catch (e) {
              if (request === version.current) setError(messageOf(e));
            } finally {
              if (request === version.current) setLoading(false);
            }
          }}
        />
      </div>
      <textarea
        id="ddl-source"
        spellCheck={false}
        placeholder="CREATE TABLE ..."
        value={sql}
        onChange={(e) => {
          version.current++;
          setLoading(false);
          setSql(e.target.value);
          setTitle("");
          reset();
        }}
      />
      <fieldset className="ddl-destination">
        <legend>読み込み先</legend>
        {[false, true].map((value) => (
          <label key={String(value)}>
            <input
              type="radio"
              name="ddl-destination"
              checked={separate === value}
              onChange={() => {
                setSeparate(value);
                reset();
              }}
            />
            {value ? "新しい図" : "今の図に追加"}
          </label>
        ))}
      </fieldset>
      {preview && (
        <div className="ddl-issues" role="status">
          <strong>
            {preview.applied
              ? preview.tableCount
                ? `${preview.tableCount}個のテーブルを読み込めます。`
                : "読み込める変更があります。"
              : "読み込める定義がありません。"}
          </strong>
          <ul>
            {preview.issues.map((issue, i) => (
              <li key={i}>
                {issue.line}行目：{issue.message}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <span />
        <button onClick={onClose}>キャンセル</button>
        <button
          className="primary"
          disabled={loading || !sql.trim() || preview?.applied === 0}
          onClick={apply}
        >
          {preview?.applied ? "読めた分を読み込む" : "読み込む"}
        </button>
      </div>
    </Modal>
  );
}
