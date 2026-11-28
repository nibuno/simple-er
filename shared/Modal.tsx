import { useEffect, useRef, type ReactNode } from "react";
export function Modal({
  id,
  onClose,
  children,
  className,
}: {
  id: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const backdropPress = useRef(false);
  const keyboard = useRef(false);
  useEffect(() => {
    const dialog = ref.current!,
      previous = document.activeElement;
    keyboard.current = previous?.matches(":focus-visible") ?? false;
    dialog.showModal();
    return () => {
      dialog.close();
      if (
        (previous instanceof HTMLElement || previous instanceof SVGElement) &&
        previous.isConnected
      ) {
        if (!keyboard.current) {
          previous.classList.add("pointer-restored-focus");
          const clear = () => {
            previous.classList.remove("pointer-restored-focus");
            previous.removeEventListener("blur", clear);
            previous.removeEventListener("keydown", clear);
          };
          previous.addEventListener("blur", clear);
          previous.addEventListener("keydown", clear);
        }
        previous.focus({ preventScroll: true });
      } else {
        (
          (document.querySelector(
            ".migration-notice summary",
          ) as HTMLElement | null) ?? document.getElementById("fit")
        )?.focus();
      }
    };
  }, []);
  function outside(event: React.PointerEvent<HTMLDialogElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    return (
      event.target === event.currentTarget &&
      (event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom)
    );
  }
  return (
    <dialog
      ref={ref}
      id={id}
      className={className}
      onKeyDownCapture={() => {
        keyboard.current = true;
      }}
      onPointerDownCapture={() => {
        keyboard.current = false;
      }}
      onPointerDown={(e) => {
        backdropPress.current = e.button === 0 && outside(e);
      }}
      onPointerUp={(e) => {
        const close = backdropPress.current && outside(e);
        backdropPress.current = false;
        if (close) onClose();
      }}
      onPointerCancel={() => {
        backdropPress.current = false;
      }}
      aria-labelledby={
        id === "table-editor"
          ? "editor-heading"
          : id.replace("dialog", "heading")
      }
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}
