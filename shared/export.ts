export const escapeXml = (value: string) =>
  value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, "")
    .replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&apos;",
        })[c]!,
    );

export function downloadFile(
  content: Blob | string,
  name: string,
  type = "application/json",
) {
  const url = URL.createObjectURL(
    typeof content === "string" ? new Blob([content], { type }) : content,
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}
export function filename(title: string, fallback = "canvas") {
  return (
    title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim() || fallback
  ).slice(0, 100);
}

export async function pngBlob(svg: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(
          new Error("画像の変換に失敗しました。SVGでの保存を試してください。"),
        );
      image.src = url;
    });
    const { naturalWidth: width, naturalHeight: height } = image;
    const scale = Math.min(
      2,
      8192 / width,
      8192 / height,
      Math.sqrt(24000000 / (width * height)),
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("このブラウザでは画像に変換できません。");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error("PNGの保存に失敗しました。")),
        "image/png",
      ),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function downloadPng(svg: string, name: string) {
  downloadFile(await pngBlob(svg), name);
}
