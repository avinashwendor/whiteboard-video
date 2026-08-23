import { Mic, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { useVoiceDictation } from "@/hooks/useVoiceDictation";

interface MicButtonProps {
  onTranscription: (text: string) => void;
  className?: string;
  disabled?: boolean;
}

export function MicButton({ onTranscription, className, disabled }: MicButtonProps) {
  const { isRecording, isProcessing, error, toggleRecording } = useVoiceDictation(onTranscription);

  return (
    <button
      type="button"
      onClick={toggleRecording}
      disabled={disabled || isProcessing}
      title={error ? `Error: ${error}` : isRecording ? "Click to stop recording" : "Click to dictate (Wispr style)"}
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-all",
        isRecording
          ? "bg-red-500 text-white animate-pulse shadow-sm shadow-red-500/50"
          : "bg-transparent text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100",
        (disabled || isProcessing) && "opacity-50 cursor-not-allowed",
        className
      )}
    >
      {isProcessing ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <Mic className="size-3.5" />
      )}
    </button>
  );
}
