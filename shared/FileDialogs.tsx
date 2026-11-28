import { useRef, useState, type ReactNode } from "react";
import { Modal } from "./Modal.tsx";

export function fileShortcut(e: KeyboardEvent) {
  if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key === "o" || key === "e" || key === "s") return key;
}

export function FileActions({
  onImport,
  onExport,
  onSave,
}: {
  onImport: () => void;
  onExport: () => void;
  onSave: () => void;
}) {
  return (
    <>
      <button onClick={onImport}>
        読み込む… <kbd className="kbd">⌘O</kbd>
      </button>
      <button onClick={onExport}>
        書き出す… <kbd className="kbd">⌘E</kbd>
      </button>
      <button onClick={onSave}>
        ファイルに保存 <kbd className="kbd">⌘S</kbd>
      </button>
    </>
  );
}

type Target = "add" | "new" | "labels";
export interface ImportSource {
  text: string;
  filename: string;
  target: Target;
}
interface Preview {
  warnings?: string[];
  blocked?: boolean;
  apply: () => void;
}

export function ImportDialog({
  initialText = "",
  formats,
  accept,
  maxBytes,
  detect,
  defaultNew,
  canApplyLabels,
  options,
  prepare,
  onClose,
}: {
  initialText?: string;
  formats: string;
  accept: string;
  maxBytes: number;
  detect: (text: string, filename: string) => string;
  defaultNew: boolean;
  canApplyLabels?: (format: string) => boolean;
  options?: (format: string) => ReactNode;
  prepare: (source: ImportSource) => Preview;
  onClose: () => void;
}) {
  const [text, setText] = useState(initialText);
  const [filename, setFilename] = useState("");
  const [target, setTarget] = useState<Target>(defaultNew ? "new" : "add");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const file = useRef<HTMLInputElement>(null),
    version = useRef(0);
  const format = text.trim() ? detect(text, filename) : "";
  const labels = canApplyLabels?.(format);
  const destination = target === "labels" && !labels ? "add" : target;
  function reset() {
    setPreview(null);
    setError("");
  }
  function submit() {
    try {
      const result =
        preview ?? prepare({ text, filename, target: destination });
      if (!preview && result.warnings?.length) {
        setPreview(result);
        return;
      }
      result.apply();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  return (
    <Modal id="file-import-dialog" className="file-dialog" onClose={onClose}>
      <div className="dialog-heading">
        <h2 id="file-import-heading">読み込む</h2>
        <button aria-label="閉じる" onClick={onClose}>
          ×
        </button>
      </div>
      <div className="source-row">
        <label htmlFor="import-source">テキストを貼り付け</label>
        <button onClick={() => file.current?.click()}>ファイルを選ぶ…</button>
      </div>
      <input
        type="file"
        accept={accept}
        ref={file}
        hidden
        onChange={async (e) => {
          const selected = e.currentTarget.files?.[0];
          e.currentTarget.value = "";
          if (!selected) return;
          const request = ++version.current;
          reset();
          setText("");
          setFilename("");
          setLoading(true);
          try {
            if (selected.size > maxBytes)
              throw new Error(
                "ファイルの上限は" + maxBytes / 1_000_000 + "MBです。",
              );
            const value = await selected.text();
            if (request === version.current) {
              setText(value);
              setFilename(selected.name);
            }
          } catch (e) {
            if (request === version.current)
              setError(e instanceof Error ? e.message : String(e));
          } finally {
            if (request === version.current) setLoading(false);
          }
        }}
      />
      <textarea
        autoFocus
        id="import-source"
        value={text}
        rows={6}
        spellCheck={false}
        onChange={(e) => {
          version.current++;
          setLoading(false);
          reset();
          setText(e.target.value);
          setFilename("");
        }}
      />
      <p className="file-format" role="status">
        {loading
          ? "ファイルを読み取り中…"
          : [
              filename,
              format
                ? "形式：" + format
                : text.trim()
                  ? "形式を判定できません"
                  : formats,
            ]
              .filter(Boolean)
              .join("　")}
      </p>
      <div onChange={reset}>{options?.(format)}</div>
      <fieldset>
        <legend>読み込み先</legend>
        {(
          [
            ["add", "今の図に追加"],
            ["new", "新しい図"],
            ...(labels ? [["labels", "今の図の論理名と説明を反映"]] : []),
          ] as const
        ).map(([value, label]) => (
          <label key={value}>
            <input
              type="radio"
              name="import-target"
              value={value}
              checked={destination === value}
              onChange={() => {
                setTarget(value as Target);
                reset();
              }}
            />
            {label}
          </label>
        ))}
      </fieldset>
      {preview?.warnings && (
        <div role="status" className="import-issues">
          {preview.warnings.map((warning, i) => (
            <div key={i}>{warning}</div>
          ))}
        </div>
      )}
      {error && (
        <p role="alert" className="import-issues">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button onClick={onClose}>キャンセル</button>
        <button
          className="primary"
          onClick={submit}
          disabled={loading || !text.trim() || preview?.blocked}
        >
          {preview && !preview.blocked ? "読めた分を読み込む" : "読み込む"}
        </button>
      </div>
    </Modal>
  );
}

export interface ExportOption {
  value: string;
  label: string;
  disabled?: boolean;
  details?: ReactNode;
  save: () => void;
  copy?: () => void;
}
export function ExportDialog({
  formats,
  storageKey,
  onClose,
}: {
  formats: ExportOption[];
  storageKey: string;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState(() => {
    try {
      return localStorage.getItem(storageKey);
    } catch {
      return null;
    }
  });
  const format = formats.find((f) => f.value === selected) ?? formats[0];
  const run = (action: () => void) => {
    action();
    onClose();
  };
  return (
    <Modal id="file-export-dialog" className="file-dialog" onClose={onClose}>
      <div className="dialog-heading">
        <h2 id="file-export-heading">書き出す</h2>
        <button aria-label="閉じる" onClick={onClose}>
          ×
        </button>
      </div>
      <label className="export-format">
        形式
        <select
          autoFocus
          value={format.value}
          onChange={(e) => {
            setSelected(e.target.value);
            try {
              localStorage.setItem(storageKey, e.target.value);
            } catch {}
          }}
        >
          {formats.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </label>
      {format.details}
      {format.disabled && (
        <p className="file-format">この形式で書き出せる内容がありません。</p>
      )}
      <div className="dialog-actions">
        <button onClick={onClose}>閉じる</button>
        {format.copy && (
          <button disabled={format.disabled} onClick={() => run(format.copy!)}>
            コピー
          </button>
        )}
        <button
          className="primary"
          disabled={format.disabled}
          onClick={() => run(format.save)}
        >
          保存
        </button>
      </div>
    </Modal>
  );
}
