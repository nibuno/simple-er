import { isImeKey } from "./ime.ts";
import { useEffect, useRef, useState } from "react";

export function TextField({
  label,
  value,
  onCommit,
  multiline = false,
  maxLength = 200,
  placeholder = "",
  onDirty,
  emptyValue,
  cancelOnEscape = false,
  autoFocus = false,
  className = "",
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
  multiline?: boolean;
  maxLength?: number;
  placeholder?: string;
  onDirty?: () => void;
  emptyValue?: string;
  cancelOnEscape?: boolean;
  autoFocus?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState(value),
    composing = useRef(false),
    cancelled = useRef(false);
  useEffect(() => setDraft(value), [value]);
  const shared = {
    value: draft,
    "aria-label": label,
    maxLength,
    placeholder,
    autoFocus,
    onCompositionStart: () => {
      composing.current = true;
    },
    onCompositionEnd: () => {
      composing.current = false;
    },
    onChange: (
      e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      setDraft(e.target.value);
      onDirty?.();
    },
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      if (cancelled.current) {
        cancelled.current = false;
        setDraft(value);
        return;
      }
      const text = e.currentTarget.value;
      const next = emptyValue ? text.trim() || emptyValue : text;
      setDraft(next);
      onCommit(next);
    },
    onKeyDown: (
      e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    ) => {
      if (composing.current || isImeKey(e.nativeEvent)) {
        e.stopPropagation();
        return;
      }
      if (
        e.key === "Escape" ||
        (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey))
      ) {
        e.preventDefault();
        cancelled.current = cancelOnEscape && e.key === "Escape";
        e.currentTarget.blur();
      }
    },
  };
  return (
    <label className={"field " + className}>
      <span>{label}</span>
      {multiline ? <textarea {...shared} rows={6} /> : <input {...shared} />}
    </label>
  );
}
