const BASE = "";

/** 让后端返回与界面一致语言的提示与导出表头 */
function langHeaders(): Record<string, string> {
  let lang = "";
  try {
    lang = localStorage.getItem("checkup.lang") || "";
  } catch {
    lang = "";
  }
  if (!lang) lang = (navigator.languages && navigator.languages[0]) || navigator.language || "zh-CN";
  return { "Accept-Language": lang };
}

async function parse<T>(resp: Response): Promise<T> {
  const ct = resp.headers.get("content-type") || "";
  let body: any = null;
  if (ct.includes("application/json")) {
    body = await resp.json();
  } else {
    body = await resp.text();
  }
  if (!resp.ok) {
    const msg = body?.detail || (typeof body === "string" ? body : "请求失败");
    throw new Error(Array.isArray(msg) ? msg.map((m: any) => m.msg).join("; ") : msg);
  }
  return body as T;
}

export const api = {
  async get<T>(path: string): Promise<T> {
    const resp = await fetch(BASE + path, { headers: langHeaders() });
    return parse<T>(resp);
  },
  async post<T>(path: string, data?: any): Promise<T> {
    const resp = await fetch(BASE + path, {
      method: "POST",
      headers: { ...langHeaders(), ...(data === undefined ? {} : { "Content-Type": "application/json" }) },
      body: data === undefined ? undefined : JSON.stringify(data),
    });
    return parse<T>(resp);
  },
  async put<T>(path: string, data: any): Promise<T> {
    const resp = await fetch(BASE + path, {
      method: "PUT",
      headers: { ...langHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
    return parse<T>(resp);
  },
  async del<T>(path: string): Promise<T> {
    const resp = await fetch(BASE + path, { method: "DELETE", headers: langHeaders() });
    return parse<T>(resp);
  },
  async upload<T>(path: string, files: File[]): Promise<T> {
    const fd = new FormData();
    files.forEach((f) => fd.append("files", f));
    const resp = await fetch(BASE + path, { method: "POST", body: fd, headers: langHeaders() });
    return parse<T>(resp);
  },
};

// ---- 轻量全局提示 ----
export function notify(message: string, type: "success" | "error" | "info" = "info") {
  window.dispatchEvent(new CustomEvent("app:toast", { detail: { message, type } }));
}

export function toastError(err: unknown) {
  notify(err instanceof Error ? err.message : String(err), "error");
}
