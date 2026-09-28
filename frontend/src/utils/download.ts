/** 下载相关的公共小工具（导出文件命名、POST 下载、批量导出）。 */

/** 从响应头里取文件名（后端已带导出时间）；取不到时本地兜底生成。 */
export function filenameFromDisposition(disposition: string | null, tag = "export"): string {
  const m = /filename\*=UTF-8''([^;]+)/i.exec(disposition || "");
  if (m) {
    try {
      return decodeURIComponent(m[1]);
    } catch {
      /* 解析失败则走兜底 */
    }
  }
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`
    + `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `checkup-${tag}-${ts}.xlsx`;
}

/** 触发浏览器下载一个 Blob。 */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** POST 请求导出并直接下载（项目较多时避免 URL 过长）。 */
export async function postExport(url: string, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error((await res.text()).slice(0, 120) || "导出失败");
  const blob = await res.blob();
  saveBlob(blob, filenameFromDisposition(res.headers.get("content-disposition"), "items"));
}
