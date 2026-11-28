import { useEffect, useRef, useState } from "react";
import type { ComponentType } from "react";
import type { DiagramEntry } from "./diagram-library.ts";

const dateFormat = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "short",
  timeStyle: "short",
});
interface Props {
  library: {
    listDiagrams: () => DiagramEntry[];
    isDiagramKey: (key: string | null) => boolean;
  };
  Icon: ComponentType<{ name: "plus" | "close" }>;
  variants?: {
    group: (entries: DiagramEntry[]) => DiagramEntry[][];
    isChoiceKey: (key: string | null) => boolean;
    create: (entry: DiagramEntry) => void;
    compare: (group: DiagramEntry[], entry: DiagramEntry) => void;
  };
  emptyName: string;
  activeKey: string;
  paused?: {
    title: string;
    saveCopy: () => void;
    resume?: () => void;
  };
  onClose: () => void;
  onCreate: () => void;
  onOpen: (entry: DiagramEntry) => void;
  onDuplicate: (entry: DiagramEntry) => void;
  onRename: (entry: DiagramEntry, title: string) => void;
  onDelete: (entry: DiagramEntry) => void;
}

export function DiagramList(props: Props) {
  const { library, Icon, paused } = props;
  const dialog = useRef<HTMLDialogElement>(null);
  const [groups, setGroups] = useState<DiagramEntry[][]>([]);
  const [action, setAction] = useState<{
    entry: DiagramEntry;
    kind: "menu" | "rename" | "delete";
  } | null>(null);
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  function refresh() {
    try {
      const entries = library.listDiagrams();
      setGroups(
        props.variants?.group(entries) ?? entries.map((entry) => [entry]),
      );
    } catch {
      setError("ブラウザの保存データを読み込めませんでした。");
    }
  }
  useEffect(() => {
    dialog.current?.showModal();
    refresh();
    const changed = (e: StorageEvent) => {
      if (
        e.key === null ||
        library.isDiagramKey(e.key) ||
        props.variants?.isChoiceKey(e.key)
      )
        refresh();
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [library]);
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
  const rows = groups.flatMap((group) =>
    group.map((entry, index) => ({ entry, group, index })),
  );
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
      <p className="list-hint">
        図を切り替えると「元に戻す」の履歴が消えます。
      </p>
      {paused && (
        <div className="list-recovery">
          <p>表示中の「{paused.title}」は自動保存を停止しています。</p>
          <button className="secondary" onClick={() => run(paused.saveCopy)}>
            別の図として保存
          </button>
          {paused.resume && (
            <button onClick={() => run(() => paused.resume?.())}>
              この画面の内容で保存を再開
            </button>
          )}
        </div>
      )}
      {error && (
        <p className="list-error" role="alert">
          {error}
        </p>
      )}
      <ul>
        {rows.map(({ group, entry, index }) => {
          const active = entry.key === props.activeKey;
          const pausedEntry = active && !!paused;
          const selected =
            !pausedEntry && action?.entry.key === entry.key ? action : null;
          return (
            <li
              key={entry.key}
              className={index > 0 ? "variant-row" : undefined}
            >
              <div className="diagram-row">
                <button
                  className="diagram-link"
                  aria-label={entry.title + "を開く"}
                  aria-describedby={"updated-" + entry.key}
                  aria-current={active && !pausedEntry ? "true" : undefined}
                  disabled={pausedEntry}
                  onClick={() => run(() => props.onOpen(entry))}
                >
                  <strong>{entry.title}</strong>
                  <span id={"updated-" + entry.key}>
                    {group.length > 1 && (index === 0 ? "元の図 · " : "案 · ")}
                    {entry.updatedAt === null ? (
                      "更新日時不明"
                    ) : (
                      <time dateTime={new Date(entry.updatedAt).toISOString()}>
                        更新 {dateFormat.format(entry.updatedAt)}
                      </time>
                    )}
                    {active && !pausedEntry && (
                      <span className="current-diagram"> · 表示中</span>
                    )}
                  </span>
                </button>
                {props.variants && group.length > 1 && index === 0 && (
                  <button
                    className="secondary"
                    onClick={() =>
                      run(() => props.variants!.compare(group, entry))
                    }
                  >
                    案を比べる
                  </button>
                )}
                <button
                  className="row-toggle"
                  disabled={pausedEntry}
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
                  {props.variants && (
                    <button
                      onClick={() => run(() => props.variants!.create(entry))}
                    >
                      案を作る
                    </button>
                  )}
                  {props.variants && index > 0 && (
                    <button
                      onClick={() =>
                        run(() => props.variants!.compare(group, entry))
                      }
                    >
                      案を比べる
                    </button>
                  )}
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
                    {rows.length === 1 &&
                      ` 削除すると${props.emptyName}が開きます。`}
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
      {!groups.length && !error && <p>保存した図はありません。</p>}
    </dialog>
  );
}
