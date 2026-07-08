/**
 * Gemini Live on React Native with the API's native server-side VAD.
 *
 * The mic streams continuously (no push-to-talk); Gemini's automatic
 * activity detection decides when a turn starts and ends. When the user
 * barges in mid-reply, serverContent.interrupted arrives and queued speech
 * is flushed instantly.
 *
 * Two-agent handshake (same as web): Gemini handles voice I/O + chit-chat;
 * every finished user turn is forwarded (as its transcript) to the FastAPI
 * /ws/chat LangGraph agent, whose reply is narrated back via narrate().
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  GoogleGenAI,
  MediaResolution,
  Modality,
  type LiveServerMessage,
  type Session,
} from "@google/genai";
import { apiFetch } from "./api";
import type { Settings } from "./settings";
import { base64ToBytes, bytesToBase64, MicCapture, PcmPlayer } from "./audio";

// Hermes ships atob/btoa in recent RN, but @google/genai may reach for them;
// polyfill with the pure-JS codec so voice never depends on the runtime.
const g = globalThis as { atob?: (s: string) => string; btoa?: (s: string) => string };
if (!g.atob) g.atob = (s) => String.fromCharCode(...base64ToBytes(s));
if (!g.btoa) g.btoa = (s) => bytesToBase64(Uint8Array.from(s, (c) => c.charCodeAt(0)));

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
  // Server VAD is the default for realtime input; stated here so it's
  // explicit that turn-taking belongs to Gemini, not the client.
  realtimeInputConfig: {
    automaticActivityDetection: { disabled: false },
  },
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

const TURN_FLUSH_MS = 1000; // fallback flush when no model output follows quickly

export interface GeminiLiveHandlers {
  /** A finished user turn (per Gemini's VAD), as transcript text. */
  onUserTurn?: (text: string) => void;
  onSpeakingChange?: (speaking: boolean) => void;
  onError?: (err: string) => void;
}

export interface GeminiLive {
  connected: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  sendText: (text: string) => void;
  narrate: (text: string) => void;
}

export function useGeminiLive(settings: Settings, handlers: GeminiLiveHandlers): GeminiLive {
  const sessionRef = useRef<Session | null>(null);
  const playerRef = useRef<PcmPlayer | null>(null);
  const micRef = useRef<MicCapture | null>(null);
  const transcriptRef = useRef("");
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const [connected, setConnected] = useState(false);

  const flushUserTurn = useCallback(() => {
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    flushTimerRef.current = null;
    const text = transcriptRef.current.trim();
    transcriptRef.current = "";
    if (text) handlersRef.current.onUserTurn?.(text);
  }, []);

  const handleMessage = useCallback(
    (message: LiveServerMessage) => {
      const content = message.serverContent;
      if (!content) return;

      // Barge-in: the user talked over SloMo — kill the queued speech.
      if (content.interrupted) playerRef.current?.flush();

      if (content.inputTranscription?.text) {
        transcriptRef.current += content.inputTranscription.text;
        if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
        flushTimerRef.current = setTimeout(flushUserTurn, TURN_FLUSH_MS);
      }

      const modelSpoke =
        content.outputTranscription?.text ||
        content.modelTurn?.parts?.some((p) => p.inlineData?.data);
      // Gemini answering means its VAD closed the user's turn: forward it now.
      if (modelSpoke) flushUserTurn();

      for (const part of content.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) {
          playerRef.current?.play(base64ToBytes(part.inlineData.data));
        }
      }
    },
    [flushUserTurn],
  );

  const disconnect = useCallback(() => {
    micRef.current?.stop();
    micRef.current = null;
    if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    sessionRef.current?.close();
    sessionRef.current = null;
    playerRef.current?.stop();
    setConnected(false);
  }, []);

  const connect = useCallback(async () => {
    if (sessionRef.current) return;
    const { token, model } = await apiFetch<{ token: string; model: string }>(
      settings,
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
        onerror: (e: { message?: string }) =>
          handlersRef.current.onError?.(e.message ?? "voice connection error"),
        onclose: () => {
          sessionRef.current = null;
          setConnected(false);
        },
      },
    });

    // Open mic, stream forever; Gemini's VAD owns the turn-taking.
    micRef.current = new MicCapture();
    try {
      await micRef.current.start((pcm) => {
        sessionRef.current?.sendRealtimeInput({
          audio: { data: bytesToBase64(pcm), mimeType: "audio/pcm;rate=16000" },
        });
      });
    } catch (err) {
      disconnect();
      throw err;
    }
    setConnected(true);
  }, [settings, handleMessage, disconnect]);

  const sendText = useCallback((text: string) => {
    sessionRef.current?.sendClientContent({ turns: [text] });
  }, []);

  const narrate = useCallback((text: string) => {
    sessionRef.current?.sendClientContent({
      turns: [`[SLOMO_REPLY] Narrate this to the user: ${text}`],
    });
  }, []);

  useEffect(() => () => disconnect(), [disconnect]);

  return { connected, connect, disconnect, sendText, narrate };
}
