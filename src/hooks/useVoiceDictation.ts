import { useState, useCallback, useRef } from "react";

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
        } catch (err: any) {
          console.error("Dictation error:", err);
          setError(err.message || "Failed to transcribe audio");
        } finally {
          setIsProcessing(false);
          // Stop all tracks to release the microphone
          stream.getTracks().forEach((track) => track.stop());
        }
      };

      mediaRecorder.start();
      setIsRecording(true);
    } catch (err: any) {
      console.error("Failed to start recording:", err);
      setError(err.message || "Microphone access denied");
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
