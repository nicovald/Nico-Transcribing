async function call(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  get: (url) => call('GET', url),
  post: (url, body) => call('POST', url, body ?? {}),
  put: (url, body) => call('PUT', url, body),
  patch: (url, body) => call('PATCH', url, body),
  del: (url) => call('DELETE', url),
};

// XHR instead of fetch so we get upload progress for multi-GB videos (browser mode only).
export function uploadFile(projectId, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/projects/${projectId}/upload`);
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.error || `Upload failed (${xhr.status})`));
    };
    xhr.onerror = () => reject(new Error('Upload failed. Is the app still running?'));
    const form = new FormData();
    form.append('file', file, file.name);
    xhr.send(form);
  });
}

export function formatTime(sec, withMs = false) {
  if (sec == null || !Number.isFinite(sec)) return '--:--';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const pad = (n) => String(n).padStart(2, '0');
  const base = h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  return withMs ? `${base}.${String(Math.floor((sec % 1) * 10))}` : base;
}
