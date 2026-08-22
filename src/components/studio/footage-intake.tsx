"use client";

import { useCallback, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { AsciiInline } from "@/components/ui/ascii-loader";

/**
 * The "bring your own footage" entry point.
 *
 * It accepts a file or a link and hands the result to whoever opened it. The
 * dropzone is the whole panel, not a button inside it — dragging a clip onto a
 * 40px target is the kind of detail that makes an upload feel cheap.
 */
export function FootageIntake({
  onAccept,
  recent,
}: {
  onAccept: (source: { kind: "file"; file: File } | { kind: "link"; url: string }) => void;
  recent?: Array<{ title: string; quality: string; duration: string }>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [link, setLink] = useState("");
  const [fetching, setFetching] = useState(false);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      setDragging(false);
      const file = event.dataTransfer.files?.[0];
      if (file) onAccept({ kind: "file", file });
    },
    [onAccept],
  );

  const submitLink = () => {
    const url = link.trim();
    if (!url) return;
    setFetching(true);
    // Handing off is the caller's job; this only reports the intent.
    onAccept({ kind: "link", url });
    setTimeout(() => setFetching(false), 600);
  };

  return (
    <div className="px-6 pb-7 pt-6 sm:px-8">
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="sr-only"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onAccept({ kind: "file", file });
        }}
      />

      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cn(
          "flex min-h-[280px] cursor-pointer flex-col items-center justify-center border border-line bg-[#0d0d0e] px-6 text-center transition-colors",
          dragging ? "border-line-strong bg-[#131316]" : "hover:bg-[#101012]",
        )}
      >
        <pre
          className="m-0 select-none whitespace-pre font-mono text-[13px] leading-[19px] tracking-[2px]"
          style={{ color: dragging ? "rgba(242,242,240,0.42)" : "rgba(242,242,240,0.22)" }}
          aria-hidden
        >{`┌──────────────────────┐
│          ↑           │
└──────────────────────┘`}</pre>

        <p className="pt-7 text-[22px] font-medium tracking-[-0.02em] text-ink">
          {dragging ? "Release to upload" : "Drop a video here"}
        </p>
        <p className="pt-3 text-[13.5px] text-muted">
          or <span className="border-b border-ink pb-0.5 text-ink">choose a file</span>
        </p>
        <p className="pt-6 text-[12px] text-faint">MP4, MOV, WebM · up to 2 GB · 4K supported</p>
      </div>

      <div className="flex items-center gap-4 pt-5">
        <span className="whitespace-nowrap text-[13px] text-muted">Or paste a link</span>
        <input
          value={link}
          onChange={(event) => setLink(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submitLink();
          }}
          placeholder="https://"
          className="flex-1 border-b border-line bg-transparent pb-2 text-[14px] text-ink outline-none transition-colors placeholder:text-faint focus:border-line-strong"
        />
        <button
          type="button"
          onClick={submitLink}
          disabled={!link.trim() || fetching}
          className="border border-line-strong px-4 py-2 text-[12.5px] text-[#c9c9c4] transition-colors hover:text-ink disabled:opacity-40"
        >
          {fetching ? <AsciiInline label="Fetching" /> : "Fetch"}
        </button>
      </div>

      {recent?.length ? (
        <div className="pt-8">
          <p className="pb-3 text-[13px] text-dim">Recent footage</p>
          {recent.map((item) => (
            <div
              key={item.title}
              className="flex items-center justify-between gap-4 border-t border-line py-3 text-[13.5px] last:border-b"
            >
              <span className="truncate text-ink">{item.title}</span>
              <span className="flex shrink-0 items-center gap-6 text-muted">
                <span>{item.quality}</span>
                <span className="font-mono text-[12px] tabular-nums">{item.duration}</span>
                <span className="text-[#c9c9c4]">Open</span>
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
