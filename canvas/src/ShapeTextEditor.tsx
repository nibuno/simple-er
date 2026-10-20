import { useLayoutEffect, useRef, useState } from "react";
import type { CanvasDocument, CanvasNode } from "./types";
import { minimumHeight } from "./model";
import { boxTextArea, minimumBoxHeight } from "./shapes";

export type ShapeTextField = "title" | "description";

export function ShapeTextEditor({
  node,
  doc,
  target,
  isNew,
  zoom,
  onSize,
  onDirty,
  onFinish,
  onCancel,
}: {
  node: CanvasNode;
  doc: CanvasDocument;
  target: ShapeTextField;
  isNew: boolean;
  zoom: number;
  onSize: (height: number) => void;
  onDirty: () => void;
  onFinish: (patch: Partial<CanvasNode>) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(node.title),
    [description, setDescription] = useState(node.description);
  const titleInput = useRef<HTMLTextAreaElement>(null),
    descriptionInput = useRef<HTMLTextAreaElement>(null),
    done = useRef(false),
    composing = useRef(false);
  const area = boxTextArea(node);
  // Keep an empty optional field from shifting existing centered text.
  const floatingTitle = !isNew && !title && !!description,
    floatingDescription = !isNew && !description && !!title;

  useLayoutEffect(() => {
    const input =
      target === "description" ? descriptionInput.current : titleInput.current;
    input?.focus({ preventScroll: true });
    input?.setSelectionRange(input.value.length, input.value.length);
  }, []);

  useLayoutEffect(() => {
    const name = titleInput.current!,
      explanation = descriptionInput.current!;
    name.style.height = explanation.style.height = "0px";
    const titleHeight = Math.max(24, name.scrollHeight),
      descriptionHeight = Math.max(21, explanation.scrollHeight);
    name.style.height = Math.min(titleHeight, Math.max(24, area.h - 28)) + "px";
    explanation.style.height =
      Math.min(
        descriptionHeight,
        Math.max(21, area.h - Math.min(titleHeight, area.h - 28) - 7),
      ) + "px";
    onSize(
      Math.max(
        minimumBoxHeight(node.shape, titleHeight + descriptionHeight + 7),
        minimumHeight(
          {
            ...node,
            title: title || "名前",
            description: description || "説明",
          },
          doc,
        ),
      ),
    );
  }, [title, description, node.w, node.h]);

  function finish(form: HTMLFormElement) {
    if (done.current) return;
    done.current = true;
    // Read native values as well, including the last IME input before blur.
    const data = new FormData(form);
    onFinish({
      title: String(data.get("title") || ""),
      description: String(data.get("description") || ""),
    });
  }

  return (
    <form
      className="inline-editor shape-text-editor"
      aria-label="図の上で編集"
      onSubmit={(e) => {
        e.preventDefault();
        finish(e.currentTarget);
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) finish(e.currentTarget);
      }}
      onCompositionStart={() => {
        composing.current = true;
      }}
      onCompositionEnd={() => {
        composing.current = false;
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (composing.current || e.nativeEvent.isComposing) return;
        if (e.key === "Escape") {
          e.preventDefault();
          done.current = true;
          onCancel();
        } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          finish(e.currentTarget);
        } else if (e.key === "Enter" && e.target === titleInput.current) {
          e.preventDefault();
          descriptionInput.current?.focus();
        }
      }}
    >
      <div
        className={"box-text inline-text" + (area.centered ? " centered" : "")}
        style={{ left: area.x, top: area.y, width: area.w, height: area.h }}
      >
        <div className="inline-copy">
          <textarea
            ref={titleInput}
            className={"node-title" + (floatingTitle ? " empty-title" : "")}
            aria-label="名前を直接編集"
            name="title"
            placeholder="名前"
            defaultValue={node.title}
            maxLength={200}
            rows={1}
            onChange={(e) => {
              setTitle(e.target.value);
              onDirty();
            }}
          />
          <textarea
            ref={descriptionInput}
            className={
              "node-description" +
              (floatingDescription ? " empty-description" : "")
            }
            aria-label="説明を直接編集"
            name="description"
            placeholder="説明（任意）"
            defaultValue={node.description}
            maxLength={500}
            rows={1}
            onChange={(e) => {
              setDescription(e.target.value);
              onDirty();
            }}
          />
        </div>
      </div>
      <div
        className="inline-actions"
        style={{
          top: `calc(100% + ${10 / zoom}px)`,
          transform: `translateX(-50%) scale(${1 / zoom})`,
        }}
      >
        <button type="submit" aria-label="編集を完了">
          完了 <span>⌘ Enter</span>
        </button>
      </div>
    </form>
  );
}
