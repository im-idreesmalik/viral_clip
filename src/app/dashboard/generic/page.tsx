"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client";
import { useToast } from "@/components/ui/Toast";

interface GenericItem {
  name: string;
  sizeBytes: number;
  url: string;
}

function formatMB(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export default function GenericPage() {
  const [items, setItems] = useState<GenericItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    try {
      setItems(await api<GenericItem[]>("/api/generic"));
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function uploadOne(file: File): Promise<void> {
    return new Promise((resolve, reject) => {
      const form = new FormData();
      form.append("file", file);
      const xhr = new XMLHttpRequest();
      xhr.open("POST", "/api/generic");
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) setProgress(Math.round((ev.loaded / ev.total) * 100));
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else {
          try {
            reject(new Error(JSON.parse(xhr.responseText).error || "Upload failed"));
          } catch {
            reject(new Error("Upload failed"));
          }
        }
      };
      xhr.onerror = () => reject(new Error("Network error during upload"));
      xhr.send(form);
    });
  }

  async function onFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    setUploading(true);
    try {
      for (const f of files) {
        setProgress(0);
        await uploadOne(f);
      }
      toast.success(`Uploaded ${files.length} video${files.length === 1 ? "" : "s"}`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      setProgress(0);
    }
  }

  return (
    <div className="max-w-4xl">
      <h1 className="mb-1 text-2xl font-semibold">Generic footage</h1>
      <p className="mb-6 text-sm text-ink-400">
        Stock clips for <strong>Generic</strong> mode — they replace the visuals while your original
        audio is kept. Uploads are automatically converted to vertical (9:16). This library is shared
        with everyone.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept="video/*"
        multiple
        className="hidden"
        onChange={onFiles}
      />
      <div className="mb-6">
        <button onClick={() => fileRef.current?.click()} disabled={uploading} className="btn-primary">
          {uploading
            ? progress < 100
              ? `Uploading… ${progress}%`
              : "Converting to 9:16…"
            : "⬆ Upload generic videos"}
        </button>
        {uploading && (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-ink-700">
            <div className="h-full bg-brand-gradient transition-all" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton aspect-[9/16]" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="card flex flex-col items-center justify-center p-12 text-center">
          <div className="mb-3 text-4xl">🎞️</div>
          <p className="font-medium">No generic footage yet</p>
          <p className="mt-1 text-sm text-ink-400">
            Upload stock clips to use as background footage.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {items.map((it) => (
            <div key={it.name} className="card card-hover overflow-hidden">
              {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
              <video
                src={it.url}
                controls
                preload="metadata"
                className="aspect-[9/16] w-full bg-neutral-950 object-cover"
              />
              <div className="p-3">
                <div className="truncate text-sm font-medium" title={it.name}>
                  {it.name}
                </div>
                <div className="text-xs text-ink-400">{formatMB(it.sizeBytes)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
