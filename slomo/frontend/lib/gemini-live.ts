"use client";

/**
 * Browser port of the Node Gemini Live reference:
 * - fs.writeFile("audio.wav")  → PcmPlayer (AudioContext scheduling)
 * - Buffer                     → Uint8Array + atob/btoa
 * - process.env.GEMINI_API_KEY → ephemeral token minted by /api/gemini/token
 * - single main()              → useGeminiLive() hook lifecycle
 *
 * Division of labor (two-agent handshake): Gemini Live does voice I/O and
 * chit-chat only. Tool-requiring turns are forwarded — via onUserTranscript —
 * to the FastAPI /ws/chat LangGraph agent; its reply comes back through
 * narrate() so the sloth speaks it.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GoogleGenAI,
  MediaResolution,
  Modality,
  type LiveServerMessage,
  type Session,
} from "@google/genai";
import { base64ToBytes, bytesToBase64, MicCapture, PcmPlayer } from "./audio";
import { apiFetch } from "./api";

const LIVE_CONFIG = {
  responseModalities: [Modality.AUDIO],
  mediaResolution: MediaResolution.MEDIA_RESOLUTION_MEDIUM,
  speechConfig: {
    voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } },
  },
  contextWindowCompression: {
    triggerTokens: "104857",
    slidingWindow: { targetTokens: "52428" },
  },
  inputAudioTranscription: {},
  outputAudioTranscription: {},
  systemInstruction: {
    parts: [
      {
        text:
          "You are the voice of SloMo, a calm, warm, slightly slothful home-server mascot. " +
          "Handle greetings and small talk yourself, briefly. Anything involving projects, " +
          "Claude sessions, files, memory or device telemetry is handled elsewhere; when you " +
          "receive a [SLOMO_REPLY] turn, narrate it faithfully in SloMo's voice.",
      },
    ],
  },
};

export interface GeminiLiveHandlers {
  onUserTranscript?: (text: string) => void;
  onModelTranscript?: (text: string) => void;
  onSpeakingChange?: (speaking: boolean) => void;
  onError?: (err: string) => void;
}

export interface GeminiLive {
  connected: boolean;
  listening: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  sendText: (text: string) => void;
  narrate: (text: string) => void;
  startMic: () => Promise<void>;
  stopMic: () => void;
}

export function useGeminiLive(handlers: GeminiLiveHandlers): GeminiLive {
  const sessionRef = useRef<Session | null>(null);
  const playerRef = useRef<PcmPlayer | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const [connected, setConnected] = useState(false);
  const [listening, setListening] = useState(false);

  const handleMessage = useCallback((message: LiveServerMessage) => {
    const content = message.serverContent;
    if (!content) return;
    if (content.inputTranscription?.text) {
      handlersRef.current.onUserTranscript?.(content.inputTranscription.text);
    }
    if (content.outputTranscription?.text) {
      handlersRef.current.onModelTranscript?.(content.outputTranscription.text);
    }
    for (const part of content.modelTurn?.parts ?? []) {
      if (part.inlineData?.data) {
        playerRef.current?.play(base64ToBytes(part.inlineData.data));
      }
    }
  }, []);

  const connect = useCallback(async () => {
    if (sessionRef.current) return;
    const { token, model } = await apiFetch<{ token: string; model: string }>(
      "/api/gemini/token",
      { method: "POST" },
    );
    const ai = new GoogleGenAI({ apiKey: token, httpOptions: { apiVersion: "v1alpha" } });
    playerRef.current = new PcmPlayer(24000);
    playerRef.current.onPlaybackChange = (playing) =>
      handlersRef.current.onSpeakingChange?.(playing);

    sessionRef.current = await ai.live.connect({
      model,
      config: LIVE_CONFIG,
      callbacks: {
        onmessage: handleMessage,
        onerror: (e: ErrorEvent) => handlersRef.current.onError?.(e.message),
        onclose: () => {
          sessionRef.current = null;
          setConnected(false);
        },
      },
    });
    setConnected(true);
  }, [handleMessage]);

  const disconnect = useCallback(() => {
    micRef.current?.stop();
    micRef.current = null;
    setListening(false);
    sessionRef.current?.close();
    sessionRef.current = null;
    playerRef.current?.stop();
    setConnected(false);
  }, []);

  const sendText = useCallback((text: string) => {
    sessionRef.current?.sendClientContent({ turns: [text] });
  }, []);

  const narrate = useCallback((text: string) => {
    sessionRef.current?.sendClientContent({
      turns: [`[SLOMO_REPLY] Narrate this to the user: ${text}`],
    });
  }, []);

  const startMic = useCallback(async () => {
    if (!sessionRef.current || micRef.current) return;
    micRef.current = new MicCapture();
    await micRef.current.start((pcm) => {
      sessionRef.current?.sendRealtimeInput({
        audio: { data: bytesToBase64(pcm), mimeType: "audio/pcm;rate=16000" },
      });
    });
    setListening(true);
  }, []);

  const stopMic = useCallback(() => {
    micRef.current?.stop();
    micRef.current = null;
    setListening(false);
  }, []);

  useEffect(() => () => disconnect(), [disconnect]);

  return { connected, listening, connect, disconnect, sendText, narrate, startMic, stopMic };
}
