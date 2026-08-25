import { useState, useCallback, useRef } from "react";

/**
 * The message off a thrown value, whatever it turned out to be.
 *
 * `getUserMedia` rejects with a `DOMException`, `fetch` with a `TypeError`,
 * and a route's own failure arrives as a plain object. None of them are
 * guaranteed to be an `Error`, which is what the `any` here was standing in
 * for -- and reading `.message` off `any` is how "undefined" ends up shown to
 * someone whose microphone was simply blocked.
 */
function messageOf(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  const detail = err as { message?: unknown };
  return typeof detail?.message === "string" && detail.message ? detail.message : fallback;
}

export function useVoiceDictation(onTranscription: (text: string) => void) {
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      let options: MediaRecorderOptions | undefined = { mimeType: "audio/webm" };
      if (!MediaRecorder.isTypeSupported("audio/webm")) {
        options = undefined;
      }
      
      const mediaRecorder = new MediaRecorder(stream, options);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        setIsRecording(false);
        setIsProcessing(true);
        
        const mimeType = mediaRecorder.mimeType || "audio/webm";
        const audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
        
        try {
          const res = await fetch("/api/transcribe", {
            method: "POST",
            headers: {
              "Content-Type": mimeType,
            },
            body: audioBlob,
          });

          if (!res.ok) {
            throw new Error(`Transcription failed: ${res.statusText}`);
          }

          const json = await res.json();
          if (json.transcript) {
            onTranscription(json.transcript);
          }
        } catch (err) {
          console.error("Dictation error:", err);
          setError(messageOf(err, "Failed to transcribe audio"));
        } finally {
          setIsProcessing(false);
          // Stop all tracks to release the microphone
          stream.getTracks().forEach((track) => track.stop());
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Failed to start recording:", err);
      setError(messageOf(err, "Microphone access denied"));
    }
  }, [onTranscription]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
      mediaRecorderRef.current.stop();
    }
  }, []);

  const toggleRecording = useCallback(() => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  }, [isRecording, startRecording, stopRecording]);

  return {
    isRecording,
    isProcessing,
    error,
    startRecording,
    stopRecording,
    toggleRecording,
  };
}
