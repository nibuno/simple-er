import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";
import { isDiagramKey, listDiagrams } from "./library";
import type { DiagramEntry } from "./library";

const dateFormat = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "short",
  timeStyle: "short",
});
interface Props {
  activeKey: string;
  onClose: () => void;
  onCreate: () => void;
  onOpen: (entry: DiagramEntry) => void;
  onDuplicate: (entry: DiagramEntry) => void;
  onRename: (entry: DiagramEntry, title: string) => void;
  onDelete: (entry: DiagramEntry) => void;
}

export function DiagramList(props: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [entries, setEntries] = useState<DiagramEntry[]>([]);
  const [action, setAction] = useState<{
    entry: DiagramEntry;
    kind: "menu" | "rename" | "delete";
  } | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  function refresh() {
    try {
      setEntries(listDiagrams());
    } catch {
      setError("ブラウザの保存データを読み込めませんでした。");
    }
  }
  useEffect(() => {
    dialog.current?.showModal();
    refresh();
    const changed = (e: StorageEvent) => {
      if (e.key === null || isDiagramKey(e.key)) refresh();
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  function run(operation: () => void) {
    try {
      operation();
      setAction(null);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    refresh();
  }
  return (
    <dialog
      className="help-dialog diagram-list"
      ref={dialog}
      aria-labelledby="diagram-list-title"
      onClose={props.onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="dialog-heading">
        <h2 id="diagram-list-title">図の一覧</h2>
        <button className="secondary" onClick={() => run(props.onCreate)}>
          <Icon name="plus" />
          新しく作る
        </button>
        <button
          className="icon-button"
          aria-label="図の一覧を閉じる"
          onClick={props.onClose}
        >
          <Icon name="close" />
        </button>
      </div>
      {error && (
        <p className="list-error" role="alert">
          {error}
        </p>
      )}
      <ul>
        {entries.map((entry) => {
          const selected = action?.entry.key === entry.key ? action : null;
          return (
            <li key={entry.key}>
              <div className="diagram-row">
                <button
                  className="diagram-link"
                  aria-label={entry.title + "を開く"}
                  aria-describedby={"updated-" + entry.key}
                  aria-current={
                    entry.key === props.activeKey ? "true" : undefined
                  }
                  onClick={() => run(() => props.onOpen(entry))}
                >
                  <strong>{entry.title}</strong>
                  <span id={"updated-" + entry.key}>
                    {entry.updatedAt === null ? (
                      "更新日時不明"
                    ) : (
                      <time dateTime={new Date(entry.updatedAt).toISOString()}>
                        更新 {dateFormat.format(entry.updatedAt)}
                      </time>
                    )}
                    {entry.key === props.activeKey && (
                      <span className="current-diagram"> · 表示中</span>
                    )}
                  </span>
                </button>
                <button
                  className="row-toggle"
                  aria-label={entry.title + "の操作"}
                  aria-expanded={!!selected}
                  onClick={() => {
                    setAction(selected ? null : { entry, kind: "menu" });
                    setError("");
                  }}
                >
                  操作 <span aria-hidden="true">{selected ? "▴" : "▾"}</span>
                </button>
              </div>
              {selected?.kind === "menu" && (
                <div className="row-actions">
                  <button onClick={() => run(() => props.onDuplicate(entry))}>
                    複製
                  </button>
                  <button
                    onClick={() => {
                      setName(entry.title);
                      setAction({ entry, kind: "rename" });
                    }}
                  >
                    名前を変更
                  </button>
                  <button
                    className="delete-diagram"
                    onClick={() => setAction({ entry, kind: "delete" })}
                  >
                    削除
                  </button>
                </div>
              )}
              {selected?.kind === "rename" && (
                <form
                  className="row-actions"
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (name.trim())
                      run(() => props.onRename(selected.entry, name.trim()));
                  }}
                >
                  <label className="field">
                    <span>図の名前</span>
                    <input
                      autoFocus
                      maxLength={200}
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </label>
                  <button type="button" onClick={() => setAction(null)}>
                    キャンセル
                  </button>
                  <button className="secondary" disabled={!name.trim()}>
                    変更する
                  </button>
                </form>
              )}
              {selected?.kind === "delete" && (
                <div className="row-actions">
                  <p>
                    「{selected.entry.title}」を削除しますか？
                    {entries.length === 1 &&
                      " 削除すると空のキャンバスが開きます。"}
                  </p>
                  <button autoFocus onClick={() => setAction(null)}>
                    キャンセル
                  </button>
                  <button
                    className="secondary delete-diagram"
                    onClick={() => run(() => props.onDelete(selected.entry))}
                  >
                    削除する
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {!entries.length && !error && <p>保存した図はありません。</p>}
    </dialog>
  );
}
