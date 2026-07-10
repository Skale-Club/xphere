"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { AnimatePresence, motion } from "framer-motion";
import {
  PaperPlaneTilt,
  Pencil,
  ShieldCheck,
  ArrowCounterClockwise,
  ClockCounterClockwise,
  X,
  Microphone,
  ImageSquare,
  CircleNotch,
  ChatCircle,
  Square,
  Users,
  Pulse,
  ListChecks,
  GitMerge,
} from "@phosphor-icons/react";
import Link from "next/link";
import { Plug2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCopilotStore } from "@/stores/copilot-store";
import { MessageBubble } from "./message-bubble";
import {
  createConversation,
  getConversation,
} from "@/app/(dashboard)/copilot/_actions/conversations";
import type { MessagePart } from "@/lib/copilot/run-turn";
import type { CopilotTurnOutput } from "@/lib/copilot/execute-turn";

const VOICE_BAR_COUNT = 11;
const DESKTOP_STORAGE_KEY = "copilot-panel-height";
const MOBILE_STORAGE_KEY = "copilot-panel-height-mobile";

// ─── Drag-to-resize hook ─────────────────────────────────────────────────────

function useDragResize(
  storageKey: string,
  defaultVh: number,
  minPx: number,
  onClose?: () => void,
) {
  const [height, setHeight] = useState<number | null>(null);
  const heightRef = useRef(0);

  // Hydrate from localStorage after mount
  useEffect(() => {
    const defaultH = window.innerHeight * defaultVh;
    const stored = Number(localStorage.getItem(storageKey) || "0");
    const init =
      stored > 0
        ? Math.max(minPx, Math.min(window.innerHeight * 0.95, stored))
        : defaultH;
    heightRef.current = init;
    setHeight(init);
  }, [storageKey, defaultVh, minPx]);

  const startDrag = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startY = e.clientY;
      const startH = heightRef.current;

      function onMove(me: PointerEvent) {
        const delta = startY - me.clientY; // drag up → increase height
        const maxH = window.innerHeight * 0.95;
        const newH = Math.max(minPx - 80, Math.min(maxH, startH + delta));
        heightRef.current = newH;
        setHeight(newH);
      }

      function onUp() {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        // Close if dragged below minimum
        if (onClose && heightRef.current < minPx) {
          onClose();
        } else {
          const clamped = Math.max(minPx, heightRef.current);
          heightRef.current = clamped;
          setHeight(clamped);
          localStorage.setItem(storageKey, String(clamped));
        }
      }

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [storageKey, minPx, onClose],
  );

  return { height, startDrag };
}

// ─── Image helpers ────────────────────────────────────────────────────────────

function compressImage(file: File, maxPx = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")!.drawImage(img, 0, 0, w, h);
      resolve(canvas.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ─── Streaming turn client ────────────────────────────────────────────────────
//
// POSTs to /api/copilot/turn and parses the SSE stream, invoking onPart for
// each incremental part so the panel renders progress live. Resolves with the
// terminal event ('done' with the persisted turn, or 'error').

type TurnEvent =
  | { type: "part"; part: MessagePart }
  | { type: "done"; data: CopilotTurnOutput }
  | { type: "error"; error: string };

async function streamCopilotTurn(
  body: {
    conversationId: string;
    message: string;
    images?: string[];
    writeMode?: boolean;
  },
  onPart: (part: MessagePart) => void,
): Promise<{ ok: true; data: CopilotTurnOutput } | { ok: false; error: string }> {
  const res = await fetch("/api/copilot/turn", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok || !res.body) {
    return { ok: false, error: `request_failed_${res.status}` };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let terminal: { ok: true; data: CopilotTurnOutput } | { ok: false; error: string } | null =
    null;

  const handleEvent = (evt: TurnEvent) => {
    if (evt.type === "part") onPart(evt.part);
    else if (evt.type === "done") terminal = { ok: true, data: evt.data };
    else if (evt.type === "error") terminal = { ok: false, error: evt.error };
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let sep: number;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      const frame = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);
      const dataLine = frame
        .split("\n")
        .find((l) => l.startsWith("data: "));
      if (!dataLine) continue;
      try {
        handleEvent(JSON.parse(dataLine.slice(6)) as TurnEvent);
      } catch {
        // Malformed frame — skip; the terminal event decides the outcome.
      }
    }
  }

  return terminal ?? { ok: false, error: "stream_interrupted" };
}

// ─── No-provider notice ───────────────────────────────────────────────────────

function NoProviderPanel() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-5 py-8 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-bg-secondary">
        <Plug2 className="h-6 w-6 text-text-tertiary" />
      </div>
      <div className="space-y-1.5">
        <p className="text-[14px] font-semibold text-text-primary">
          AI provider not connected
        </p>
        <p className="text-[12px] leading-relaxed text-text-tertiary">
          Copilot needs an OpenRouter or Anthropic key to run. Add one in
          Integrations, then come back here.
        </p>
      </div>
      <div className="flex flex-col items-center gap-2">
        <Link
          href="/integrations"
          className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-[13px] font-semibold text-white hover:bg-accent-hover transition-colors"
        >
          Go to Integrations
        </Link>
        <Link
          href="/settings/copilot"
          className="text-[12px] text-text-tertiary hover:text-text-secondary transition-colors"
        >
          Copilot settings
        </Link>
      </div>
    </div>
  );
}

// ─── Panel ────────────────────────────────────────────────────────────────────

interface CopilotPanelProps {
  hasProvider: boolean;
}

export function CopilotPanel({ hasProvider }: CopilotPanelProps) {
  const {
    open,
    setOpen,
    conversationId,
    setConversationId,
    messages,
    resetMessages,
    appendMessage,
    updateMessage,
    writeMode,
    setWriteMode,
    sending,
    setSending,
    sessionCostUsd,
    addCost,
    newSession,
  } = useCopilotStore();

  const [input, setInput] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const [listening, setListening] = useState(false);
  const [voiceLevels, setVoiceLevels] = useState<number[]>(() =>
    Array.from({ length: VOICE_BAR_COUNT }, () => 0),
  );
  const [, startSend] = useTransition();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const mobileScrollerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mobileFileInputRef = useRef<HTMLInputElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recognitionRef = useRef<any>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);
  const voiceAudioContextRef = useRef<AudioContext | null>(null);
  const voiceAnimationRef = useRef<number | null>(null);
  const voiceMeterRunRef = useRef(0);

  // Drag-to-resize — desktop panel height + mobile sheet height
  const {
    height: desktopHeight,
    startDrag: startDesktopDrag,
  } = useDragResize(DESKTOP_STORAGE_KEY, 0.72, 280);

  const {
    height: mobileHeight,
    startDrag: startMobileDrag,
  } = useDragResize(MOBILE_STORAGE_KEY, 0.65, 220, () => setOpen(false));

  useEffect(() => {
    if (scrollerRef.current) {
      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }
    if (mobileScrollerRef.current) {
      mobileScrollerRef.current.scrollTop =
        mobileScrollerRef.current.scrollHeight;
    }
  }, [messages]);

  useEffect(() => {
    if (!conversationId) return;
    let cancelled = false;
    void (async () => {
      const res = await getConversation(conversationId);
      if (!cancelled && res.ok) {
        resetMessages(
          res.data.messages.map((m) => ({
            id: m.id,
            role: m.role,
            parts: m.parts,
          })),
        );
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [conversationId, resetMessages]);

  // ── Audio / speech-to-text ─────────────────────────────────────────────────

  function resetVoiceMeter() {
    if (voiceAnimationRef.current !== null) {
      cancelAnimationFrame(voiceAnimationRef.current);
      voiceAnimationRef.current = null;
    }
    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
    voiceStreamRef.current = null;
    void voiceAudioContextRef.current?.close();
    voiceAudioContextRef.current = null;
    setVoiceLevels(Array.from({ length: VOICE_BAR_COUNT }, () => 0));
  }

  function stopVoiceCapture() {
    voiceMeterRunRef.current += 1;
    resetVoiceMeter();
    setListening(false);
  }

  async function startVoiceMeter() {
    resetVoiceMeter();
    const runId = voiceMeterRunRef.current + 1;
    voiceMeterRunRef.current = runId;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (voiceMeterRunRef.current !== runId) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      const AudioContextCtor =
        window.AudioContext ??
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).webkitAudioContext;
      const audioContext = new AudioContextCtor();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.72;

      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);

      voiceStreamRef.current = stream;
      voiceAudioContextRef.current = audioContext;

      const frequencyData = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        if (voiceMeterRunRef.current !== runId) return;
        analyser.getByteFrequencyData(frequencyData);

        const usableBins = Math.min(frequencyData.length, 72);
        const nextLevels = Array.from(
          { length: VOICE_BAR_COUNT },
          (_, index) => {
            const start = Math.floor((index / VOICE_BAR_COUNT) * usableBins);
            const end = Math.max(
              start + 1,
              Math.floor(((index + 1) / VOICE_BAR_COUNT) * usableBins),
            );
            let total = 0;
            for (let i = start; i < end; i += 1) {
              total += frequencyData[i] ?? 0;
            }
            const average = total / (end - start);
            return Math.min(1, Math.pow(average / 170, 0.85));
          },
        );

        setVoiceLevels(nextLevels);
        voiceAnimationRef.current = requestAnimationFrame(tick);
      };

      tick();
    } catch {
      if (voiceMeterRunRef.current === runId) {
        setVoiceLevels(Array.from({ length: VOICE_BAR_COUNT }, () => 0));
      }
    }
  }

  useEffect(() => {
    return () => {
      voiceMeterRunRef.current += 1;
      resetVoiceMeter();
    };
  }, []);

  function toggleMic() {
    if (listening) {
      recognitionRef.current?.stop();
      stopVoiceCapture();
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any;
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) {
      alert("Voice input is not supported in this browser.");
      return;
    }
    const rec = new SR();
    rec.lang = "pt-BR";
    rec.interimResults = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (e: any) => {
      const transcript = Array.from(e.results as unknown[])
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .map((r: any) => r[0].transcript as string)
        .join(" ");
      setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
    };
    rec.onend = stopVoiceCapture;
    rec.onerror = stopVoiceCapture;
    try {
      rec.start();
      recognitionRef.current = rec;
      setListening(true);
      void startVoiceMeter();
    } catch {
      stopVoiceCapture();
    }
  }

  // ── Image picker ───────────────────────────────────────────────────────────

  async function handleImageFiles(files: FileList | null) {
    if (!files) return;
    const compressed = await Promise.all(
      Array.from(files)
        .slice(0, 4)
        .map((f) => compressImage(f)),
    );
    setImages((prev) => [...prev, ...compressed].slice(0, 4));
  }

  function removeImage(idx: number) {
    setImages((prev) => prev.filter((_, i) => i !== idx));
  }

  // ── Send ───────────────────────────────────────────────────────────────────

  async function handleSend() {
    const text = input.trim();
    if ((!text && images.length === 0) || sending) return;
    setSending(true);

    let activeConvId = conversationId;
    if (!activeConvId) {
      const created = await createConversation();
      if (!created.ok) {
        setSending(false);
        appendMessage({
          id: tempId(),
          role: "assistant",
          parts: [{ type: "text", text: `Error: ${created.error}` }],
        });
        return;
      }
      activeConvId = created.data.id;
      setConversationId(activeConvId);
    }

    const sentImages = [...images];
    appendMessage({
      id: tempId(),
      role: "user",
      parts: [
        { type: "text", text: text || "(image)" },
        ...sentImages.map((url) => ({ type: "image" as const, url })),
      ],
    });
    setInput("");
    setImages([]);

    const assistantMsgId = tempId();
    appendMessage({
      id: assistantMsgId,
      role: "assistant",
      parts: [],
      pending: true,
    });

    startSend(async () => {
      // Parts stream in one at a time; keep a local accumulator so each
      // update replaces the pending message's parts with everything so far.
      const streamedParts: MessagePart[] = [];
      try {
        const res = await streamCopilotTurn(
          {
            conversationId: activeConvId!,
            message: text || "(describe the image)",
            images: sentImages.length > 0 ? sentImages : undefined,
            writeMode,
          },
          (part) => {
            streamedParts.push(part);
            updateMessage(assistantMsgId, { parts: [...streamedParts] });
          },
        );
        if (res.ok) {
          updateMessage(assistantMsgId, {
            id: res.data.assistantMessageId,
            parts: res.data.assistantParts,
            pending: false,
            runId: res.data.runId,
            costUsd: res.data.costUsd,
          });
          addCost(res.data.costUsd);
        } else {
          updateMessage(assistantMsgId, {
            parts: [
              ...streamedParts,
              { type: "text", text: `Error: ${res.error}` },
            ],
            pending: false,
          });
        }
      } catch (err) {
        updateMessage(assistantMsgId, {
          parts: [
            ...streamedParts,
            {
              type: "text",
              text: `Error: ${err instanceof Error ? err.message : String(err)}`,
            },
          ],
          pending: false,
        });
      } finally {
        setSending(false);
      }
    });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  // ── Shared composer content ────────────────────────────────────────────────

  function composerContent(
    textareaRef: React.RefObject<HTMLTextAreaElement | null>,
    fileRef: React.RefObject<HTMLInputElement | null>,
    compact?: boolean,
  ) {
    return (
      <>
        {images.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {images.map((src, i) => (
              <div key={i} className="relative">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt=""
                  className={cn(
                    "rounded-lg object-cover border border-border",
                    compact ? "h-14 w-14" : "h-16 w-16",
                  )}
                />
                <button
                  type="button"
                  onClick={() => removeImage(i)}
                  className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-bg-primary border border-border text-text-tertiary hover:text-text-primary"
                >
                  <X size={10} weight="bold" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className={cn("flex items-stretch", compact ? "" : "gap-2.5")}>
          {!compact && (
            <>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-12 w-12 shrink-0 p-0"
                onClick={() => fileRef.current?.click()}
                disabled={sending || images.length >= 4}
              >
                <ImageSquare size={24} weight="bold" className="text-text-secondary" />
              </Button>
              <Button
                type="button"
                size="sm"
                variant={listening ? "primary" : "ghost"}
                className={cn(
                  "h-12 w-12 shrink-0 p-0",
                  listening
                    ? "bg-red-500 text-white hover:bg-red-600 shadow-lg shadow-red-500/30"
                    : "text-text-secondary",
                )}
                onClick={toggleMic}
                disabled={sending}
              >
                {listening ? (
                  <Square size={16} weight="fill" />
                ) : (
                  <Microphone size={24} weight="bold" />
                )}
              </Button>
            </>
          )}

          <div className="relative flex flex-1">
            {compact && (
              <div className="absolute bottom-2 left-2 z-10 flex items-center gap-1">
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0 text-text-secondary hover:text-text-primary"
                  onClick={() => fileRef.current?.click()}
                  disabled={sending || images.length >= 4}
                >
                  <ImageSquare size={16} weight="bold" />
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={listening ? "secondary" : "ghost"}
                  className={cn(
                    "h-7 w-7 p-0 text-text-secondary hover:text-text-primary",
                    listening && "text-red-500",
                  )}
                  onClick={toggleMic}
                  disabled={sending}
                >
                  {listening ? (
                    <Square size={14} weight="fill" />
                  ) : (
                    <Microphone size={16} weight="bold" />
                  )}
                </Button>
              </div>
            )}
            <Textarea
              ref={textareaRef as React.RefObject<HTMLTextAreaElement>}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={compact ? handleKeyDown : undefined}
              placeholder={listening ? "Listening…" : "Ask Copilot…"}
              rows={compact ? 2 : 1}
              className={cn(
                "resize-none rounded-r-none border-r-0 text-sm",
                compact
                  ? "min-h-[88px] flex-1 pb-10 pl-3"
                  : "flex-1 min-h-[56px] max-h-40 text-base leading-relaxed py-4 px-4",
              )}
              enterKeyHint="send"
              autoCapitalize="sentences"
              disabled={sending || (compact ? false : listening)}
            />
          </div>

          <Button
            size="sm"
            onClick={handleSend}
            disabled={sending || (!input.trim() && images.length === 0) || !hasProvider}
            className={cn(
              "rounded-l-none p-0 shrink-0",
              compact ? "h-full min-h-[88px] w-10" : "h-auto min-h-[56px] w-12",
            )}
          >
            {sending ? (
              <CircleNotch
                size={compact ? 16 : 24}
                weight="bold"
                className="animate-spin"
              />
            ) : (
              <PaperPlaneTilt size={compact ? 16 : 24} weight="bold" />
            )}
          </Button>
        </div>
      </>
    );
  }

  // ── Desktop drag handle ────────────────────────────────────────────────────

  const DragHandle = ({ onPointerDown }: { onPointerDown: (e: React.PointerEvent) => void }) => (
    <div
      className="flex h-3.5 shrink-0 cursor-ns-resize select-none items-center justify-center border-b border-border bg-bg-secondary hover:bg-bg-tertiary transition-colors touch-none"
      onPointerDown={onPointerDown}
      title="Drag to resize"
      aria-hidden
    >
      <div className="h-1 w-8 rounded-full bg-border" />
    </div>
  );

  // ── Desktop render ─────────────────────────────────────────────────────────

  const desktopPanelInner = (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 shrink-0">
        <span className="text-sm font-semibold text-text-primary">Copilot</span>
        <div className="ml-auto flex items-center gap-1">
          {sessionCostUsd > 0 && (
            <span className="text-[11px] text-text-tertiary">
              ~${sessionCostUsd.toFixed(4)}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setWriteMode(!writeMode)}
            className={cn(
              "h-7 gap-1 px-2 text-xs",
              writeMode ? "text-amber-500" : "text-green-500",
            )}
            title={writeMode ? "Write mode ON" : "Read-only mode"}
          >
            {writeMode ? (
              <Pencil size={16} weight="bold" />
            ) : (
              <ShieldCheck size={16} weight="bold" />
            )}
            <span className="hidden sm:inline">
              {writeMode ? "Write" : "Read-only"}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={newSession}
            className="h-7 px-2"
            title="New conversation"
          >
            <ArrowCounterClockwise size={16} weight="bold" />
          </Button>
          <Link
            href="/copilot/conversations"
            className="inline-flex h-7 items-center rounded-md px-2 text-text-secondary hover:bg-bg-tertiary"
            onClick={() => setOpen(false)}
            title="History"
          >
            <ClockCounterClockwise size={16} weight="bold" />
          </Link>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            className="h-7 px-2"
          >
            <X size={16} weight="bold" />
          </Button>
        </div>
      </div>

      {/* Messages */}
      <div
        ref={scrollerRef}
        className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0"
      >
        {messages.length === 0 && (
          hasProvider ? (
            <GreetingPanel onPick={setInput} />
          ) : (
            <NoProviderPanel />
          )
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>

      {/* Input area — hidden when no provider and no messages */}
      {hasProvider && (
        <div className="relative border-t border-border p-3 shrink-0">
          {composerContent(
            { current: null } as React.RefObject<HTMLTextAreaElement | null>,
            fileInputRef,
            true,
          )}
          {listening && (
            <VoiceRecordingOverlay
              onStop={toggleMic}
              compact
              levels={voiceLevels}
            />
          )}
          <p className="mt-1.5 text-[10px] text-text-tertiary">
            Enter to send · Shift+Enter for newline · ⌘I to toggle
          </p>
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleImageFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );

  // ── Mobile render (bottom sheet) ───────────────────────────────────────────

  const mobilePanelInner = (
    <div className="relative flex h-full flex-col bg-bg-primary">
      {/* Branded header */}
      <header className="flex items-center gap-3 border-b border-border bg-bg-primary px-4 pt-safe-3 pb-3 shrink-0">
        <img src="/xphere-icon.svg" alt="Xphere" className="h-9 w-9 shrink-0" />
        <span className="text-[15px] font-semibold text-text-primary">
          Copilot
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setWriteMode(!writeMode)}
            className={cn(
              "h-9 gap-1.5 px-2.5 text-xs font-medium",
              writeMode ? "text-amber-500" : "text-green-500",
            )}
          >
            {writeMode ? (
              <Pencil size={16} weight="bold" />
            ) : (
              <ShieldCheck size={16} weight="bold" />
            )}
            {writeMode ? "Write" : "Read-only"}
            {sessionCostUsd > 0 && (
              <span className="font-normal text-text-tertiary">
                · ~${sessionCostUsd.toFixed(4)}
              </span>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={newSession}
            className="h-9 w-9 p-0 text-text-secondary"
            title="New conversation"
          >
            <ArrowCounterClockwise size={18} weight="bold" />
          </Button>
          <Link
            href="/copilot/conversations"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-text-secondary hover:bg-bg-tertiary"
            onClick={() => setOpen(false)}
          >
            <ClockCounterClockwise size={18} weight="bold" />
          </Link>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
            className="h-9 w-9 p-0 text-text-secondary"
          >
            <X size={22} weight="bold" />
          </Button>
        </div>
      </header>

      {/* Messages */}
      <div
        ref={mobileScrollerRef}
        className="flex-1 overflow-y-auto px-4 py-4 space-y-3 min-h-0"
      >
        {messages.length === 0 && (
          hasProvider ? (
            <MobileGreetingPanel onPick={setInput} />
          ) : (
            <NoProviderPanel />
          )
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
      </div>

      {/* Composer */}
      {hasProvider && (
        <div className="relative border-t border-border bg-bg-primary px-3 pt-3 pb-safe-3 shrink-0">
          {composerContent(
            { current: null } as React.RefObject<HTMLTextAreaElement | null>,
            mobileFileInputRef,
            false,
          )}
          {listening && (
            <VoiceRecordingOverlay onStop={toggleMic} levels={voiceLevels} />
          )}
        </div>
      )}

      {/* Hidden file input */}
      <input
        ref={mobileFileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleImageFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );

  return (
    <>
      {/* ── Desktop: right sidebar with drag-to-resize ── */}
      <motion.aside
        className="relative hidden md:block border-l border-border shrink-0 overflow-hidden"
        initial={false}
        animate={{ width: open ? 380 : 0 }}
        transition={{ type: "spring", stiffness: 300, damping: 24, mass: 0.85 }}
      >
        <AnimatePresence>
          {open && (
            <motion.div
              key="copilot-panel-desktop"
              initial={{ x: 30, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: -24, opacity: 0 }}
              transition={{
                x: { type: "spring", stiffness: 380, damping: 28 },
                opacity: { duration: 0.12 },
              }}
              className={cn(
                "absolute bottom-0 left-0 right-0 flex flex-col bg-bg-primary overflow-hidden",
                "border-t border-border",
              )}
              style={
                desktopHeight !== null
                  ? { height: desktopHeight }
                  : { top: 0, bottom: 0 }
              }
            >
              <DragHandle onPointerDown={startDesktopDrag} />
              <div className="w-[380px] flex flex-1 min-h-0 flex-col">
                {desktopPanelInner}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.aside>

      {/* ── Mobile: bottom sheet with drag handle ── */}
      {open && (
        <>
          {/* Backdrop */}
          <div
            className="md:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm animate-fade-in"
            onClick={() => setOpen(false)}
          />
          {/* Sheet */}
          <div
            className="md:hidden fixed bottom-0 left-0 right-0 z-50 flex flex-col rounded-t-2xl bg-bg-primary shadow-2xl animate-sheet-in overflow-hidden"
            style={mobileHeight !== null ? { height: mobileHeight } : { height: "65vh" }}
          >
            {/* Drag handle */}
            <div
              className="flex h-8 shrink-0 cursor-ns-resize select-none items-center justify-center rounded-t-2xl touch-none active:bg-bg-secondary"
              onPointerDown={startMobileDrag}
            >
              <div className="h-1.5 w-12 rounded-full bg-border" />
            </div>
            <div className="flex flex-1 min-h-0 flex-col overflow-hidden">
              {mobilePanelInner}
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ─── Greeting panels ──────────────────────────────────────────────────────────

function GreetingPanel({ onPick }: { onPick: (text: string) => void }) {
  const suggestions = [
    "List my 10 most recent contacts",
    "Summarize pipeline health",
    "Show all open tasks due this week",
    "Find duplicate contacts by email",
  ];
  return (
    <div className="rounded-lg border border-border bg-bg-secondary p-4 text-sm">
      <p className="font-medium text-text-primary">Chat with Xphere.</p>
      <p className="mt-1 text-xs text-text-secondary">
        Query, summarize, and (in write mode) mutate contacts, deals, tasks, and
        notes. Attach images or use your mic to ask anything.
      </p>
      <div className="mt-3 grid grid-cols-1 gap-1.5">
        {suggestions.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => onPick(s)}
            className="rounded-md border border-border bg-bg-primary px-2.5 py-1.5 text-left text-xs hover:bg-bg-tertiary"
          >
            {s}
          </button>
        ))}
      </div>
    </div>
  );
}

function MobileGreetingPanel({ onPick }: { onPick: (text: string) => void }) {
  const suggestions: Array<{ icon: typeof Users; label: string }> = [
    { icon: Users, label: "List my 10 most recent contacts" },
    { icon: Pulse, label: "Summarize pipeline health" },
    { icon: ListChecks, label: "Show all open tasks due this week" },
    { icon: GitMerge, label: "Show deals closing this month" },
  ];
  return (
    <div className="flex flex-col gap-5 py-4 animate-fade-in">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-accent shadow-xl shadow-accent/30">
          <ChatCircle size={32} weight="fill" className="text-white" />
        </div>
        <div className="space-y-1">
          <h2 className="text-lg font-semibold text-text-primary">
            Chat with Xphere
          </h2>
          <p className="mx-auto max-w-[280px] text-[13px] leading-relaxed text-text-secondary">
            Query, summarize, and mutate contacts, deals, tasks, and notes.
            Attach images or hold the mic to ask anything.
          </p>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-2">
        {suggestions.map(({ icon: Icon, label }) => (
          <button
            key={label}
            type="button"
            onClick={() => onPick(label)}
            className="flex items-center gap-3 rounded-xl border border-border bg-bg-secondary px-3 py-3 text-left text-[13px] text-text-primary active:bg-bg-tertiary active:scale-[0.99] transition"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-bg-tertiary text-accent">
              <Icon size={16} weight="bold" />
            </span>
            <span className="leading-snug">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── Voice recording overlay ──────────────────────────────────────────────────

function VoiceRecordingOverlay({
  onStop,
  compact = false,
  levels,
}: {
  onStop: () => void;
  compact?: boolean;
  levels: number[];
}) {
  const bars = compact ? levels.slice(2, 9) : levels;
  return (
    <div
      className={cn(
        "absolute inset-0 z-10 flex flex-col items-center justify-center gap-3",
        "bg-bg-primary/95 backdrop-blur-md animate-fade-in",
        compact ? "rounded-md" : "pt-3 pb-safe-3",
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500 opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-red-500" />
        </span>
        <span
          className={cn(
            "font-medium text-text-primary",
            compact ? "text-xs" : "text-sm",
          )}
        >
          Listening…
        </span>
      </div>

      <div
        className={cn(
          "flex items-center justify-center gap-1",
          compact ? "h-7" : "h-10",
        )}
      >
        {bars.map((level, i) => (
          <span
            key={i}
            className={cn(
              "voice-bar rounded-full bg-red-500",
              compact ? "w-1" : "w-1.5",
            )}
            style={{
              height: `${Math.round((compact ? 6 : 8) + level * (compact ? 22 : 34))}px`,
              opacity: 0.45 + level * 0.55,
            }}
          />
        ))}
      </div>

      <button
        type="button"
        onClick={onStop}
        className={cn(
          "flex items-center gap-2 rounded-full bg-red-500 font-semibold text-white shadow-lg shadow-red-500/30",
          "active:scale-95 transition",
          compact ? "px-3 py-1 text-xs" : "px-5 py-2 text-sm",
        )}
      >
        <Square size={compact ? 12 : 14} weight="fill" />
        Stop
      </button>
    </div>
  );
}

function tempId() {
  return `tmp_${Math.random().toString(36).slice(2)}`;
}
