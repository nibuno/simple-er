import { isImeKey } from "../../shared/ime.ts";
import { useLayoutEffect, useRef, useState } from "react";
import type { CanvasDocument, CanvasNode } from "./types";
import { minimumHeight } from "./model";
import { boxTextArea, minimumBoxHeight } from "./shapes";

export type ShapeTextField = "title" | "description";

export function ShapeTextEditor({
  node,
  doc,
  target,
  zoom,
  onSize,
  onFinish,
}: {
  node: CanvasNode;
  doc: CanvasDocument;
  target: ShapeTextField;
  zoom: number;
  onSize: (height: number) => void;
  onFinish: (patch: Partial<CanvasNode>) => void;
}) {
  const [title, setTitle] = useState(node.title),
    [description, setDescription] = useState(node.description);
  const titleInput = useRef<HTMLTextAreaElement>(null),
    descriptionInput = useRef<HTMLTextAreaElement>(null),
    done = useRef(false),
    composing = useRef(false);
  const area = boxTextArea(node);
  // An empty field is taken out of the flow, so the text sits where the
  // finished figure will show it instead of shifting when the editor closes.
  const floatingTitle = !title && !!description,
    floatingDescription = !description;

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
    // A field that is out of the flow asks for no room of its own.
    const writtenHeight =
      (floatingTitle ? 0 : titleHeight) +
      (floatingDescription ? 0 : descriptionHeight) +
      (floatingTitle || floatingDescription ? 0 : 7);
    onSize(
      Math.max(
        minimumBoxHeight(node.shape, writtenHeight),
        minimumHeight({ ...node, title, description }, doc),
      ),
    );
  }, [title, description, node.w, node.h]);

  // The name and the explanation are two fields, but they read as one text:
  // the caret crosses between them and Backspace joins them back together.
  function collapsedAt(input: HTMLTextAreaElement, at: number) {
    return input.selectionStart === at && input.selectionEnd === at;
  }
  function atVerticalBoundary(input: HTMLTextAreaElement, down: boolean) {
    if (input.selectionStart !== input.selectionEnd) return false;
    const at = input.selectionStart;
    if (at === (down ? input.value.length : 0)) return true;
    const lines = input.value.split("\n");
    const lineHeight = parseFloat(window.getComputedStyle(input).lineHeight);
    // Let the browser move inside soft-wrapped text until it reaches an end.
    if (input.scrollHeight > Math.ceil(lines.length * lineHeight)) return false;
    return !(down ? input.value.slice(at) : input.value.slice(0, at)).includes(
      "\n",
    );
  }
  function focusTitleEnd() {
    const name = titleInput.current!;
    name.focus();
    name.setSelectionRange(name.value.length, name.value.length);
  }
  function focusDescriptionStart() {
    const explanation = descriptionInput.current!;
    explanation.focus();
    explanation.setSelectionRange(0, 0);
  }
  function joinIntoTitle() {
    const name = titleInput.current!,
      explanation = descriptionInput.current!,
      [firstLine = "", ...rest] = explanation.value.split("\n"),
      junction = name.value.length,
      joined = name.value + firstLine;
    if (joined.length > name.maxLength) return;
    name.value = joined;
    explanation.value = rest.join("\n");
    setTitle(joined);
    setDescription(explanation.value);
    name.focus();
    name.setSelectionRange(junction, junction);
  }

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
        if (composing.current || isImeKey(e.nativeEvent)) return;
        // Esc confirms, as on other canvases: written words never vanish.
        // Undo takes them back.
        if (
          e.key === "Escape" ||
          (e.key === "Enter" && (e.metaKey || e.ctrlKey))
        ) {
          e.preventDefault();
          finish(e.currentTarget);
          return;
        }
        const input = e.target as HTMLTextAreaElement,
          inTitle = e.target === titleInput.current,
          inDescription = e.target === descriptionInput.current;
        if (
          (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) &&
          e.key.startsWith("Arrow")
        )
          return;
        if (inTitle && e.key === "Enter") {
          e.preventDefault();
          focusDescriptionStart();
        } else if (
          inDescription &&
          e.key === "Backspace" &&
          collapsedAt(input, 0)
        ) {
          e.preventDefault();
          joinIntoTitle();
        } else if (
          inDescription &&
          ((e.key === "ArrowLeft" && collapsedAt(input, 0)) ||
            (e.key === "ArrowUp" && atVerticalBoundary(input, false)))
        ) {
          e.preventDefault();
          focusTitleEnd();
        } else if (
          inTitle &&
          ((e.key === "ArrowRight" && collapsedAt(input, input.value.length)) ||
            (e.key === "ArrowDown" && atVerticalBoundary(input, true)))
        ) {
          e.preventDefault();
          focusDescriptionStart();
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
            defaultValue={node.title}
            maxLength={200}
            rows={1}
            onChange={(e) => {
              setTitle(e.target.value);
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
            defaultValue={node.description}
            maxLength={500}
            rows={1}
            onChange={(e) => {
              setDescription(e.target.value);
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
