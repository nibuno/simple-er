import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { COLOR_FAMILIES, DEFAULT_COLORS, normalizeColor } from "./colors";

export function ColorPicker({
  label,
  kind,
  value,
  mixed = false,
  defaultColor,
  onChange,
}: {
  label: string;
  kind: "fill" | "stroke";
  value?: string;
  mixed?: boolean;
  defaultColor: string;
  onChange: (color: string | undefined) => void;
}) {
  const initialColor =
    value && value !== "transparent"
      ? value
      : defaultColor === "transparent"
        ? DEFAULT_COLORS.fill
        : defaultColor.slice(0, 7);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(initialColor);
  const [invalid, setInvalid] = useState(false);
  useEffect(() => {
    setDraft(initialColor);
    setInvalid(false);
  }, [initialColor, mixed]);
  const palette: { name: string; color?: string }[] = [
    { name: "標準" },
    { name: "透明", color: "transparent" },
    kind === "fill"
      ? { name: "白", color: DEFAULT_COLORS.white }
      : { name: "黒", color: DEFAULT_COLORS.black },
    ...COLOR_FAMILIES.map((family) => ({
      name: family.name,
      color: family[kind],
    })),
  ];
  const quickNames = ["標準", "赤", "黄", "緑", "青"];
  const choices = expanded
    ? palette
    : quickNames.map((name) => palette.find((p) => p.name === name)!);
  const currentName = mixed
    ? "複数の色"
    : (palette.find((p) => p.color === value)?.name ?? value);
  function apply() {
    const color = normalizeColor(draft);
    setInvalid(!color);
    if (color) onChange(color);
  }
  return (
    <div className="color-picker" role="group" aria-label={label + "の色"}>
      <div className="color-heading">
        <span>{label}</span>
        <span className="color-value">{currentName}</span>
        <button
          className="color-expand"
          aria-label={label + (expanded ? "の色を閉じる" : "の色を選ぶ")}
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "閉じる" : "他の色"}
        </button>
      </div>
      <div className={"color-swatches" + (expanded ? " expanded" : "")}>
        {choices.map(({ name, color }) => (
          <button
            key={name}
            className={
              "color-swatch" +
              ((color ?? defaultColor) === "transparent" ? " transparent" : "")
            }
            aria-label={label + "：" + name}
            aria-pressed={!mixed && value === color}
            title={name + (color && color !== "transparent" ? " " + color : "")}
            style={{ "--swatch-color": color ?? defaultColor } as CSSProperties}
            onClick={() => onChange(color)}
          >
            <span className="swatch-sample" />
            {name === "標準" && <span className="swatch-default">↶</span>}
          </button>
        ))}
      </div>
      {expanded && (
        <>
          <div className="custom-color">
            <input
              type="color"
              aria-label={label + "の任意の色"}
              value={normalizeColor(draft) ?? DEFAULT_COLORS.fill}
              onChange={(e) => {
                setDraft(e.target.value);
                setInvalid(false);
              }}
            />
            <input
              aria-label={label + "の色コード"}
              placeholder="#a5d8ff"
              value={draft}
              maxLength={7}
              spellCheck={false}
              aria-invalid={invalid}
              onChange={(e) => {
                setDraft(e.target.value);
                setInvalid(false);
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.isComposing) return;
                if (e.key === "Enter") {
                  e.preventDefault();
                  apply();
                }
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setExpanded(false);
                }
              }}
            />
            <button
              className="secondary"
              aria-label={label + "に適用"}
              onClick={apply}
            >
              適用
            </button>
          </div>
          {invalid && (
            <p className="color-error" role="alert">
              色コードは3桁か6桁の16進数で入力してください。
            </p>
          )}
        </>
      )}
    </div>
  );
}
