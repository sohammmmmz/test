/**
 * Voice audio for Gemini Live on React Native.
 *
 * react-native-audio-api (Software Mansion) implements the Web Audio API
 * natively, so playback is the same AudioContext scheduling as the web app,
 * and the mic is its native AudioRecorder streaming 16-kHz PCM frames —
 * continuously, so Gemini Live's server-side VAD does the turn-taking.
 * On expo-web the browser's own AudioContext + AudioWorklet are used.
 */

import { Platform } from "react-native";

/* eslint-disable @typescript-eslint/no-explicit-any */

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_INDEX = new Map([...B64].map((c, i) => [c, i]));

// Pure-JS base64 — no atob/btoa dependency, identical under Hermes and web.
export function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    out += B64[a >> 2] + B64[((a & 3) << 4) | (b === undefined ? 0 : b >> 4)];
    out += b === undefined ? "=" : B64[((b & 15) << 2) | (c === undefined ? 0 : c >> 6)];
    out += c === undefined ? "=" : B64[c & 63];
  }
  return out;
}

export function base64ToBytes(s: string): Uint8Array {
  const clean = s.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const [a, b, c, d] = [0, 1, 2, 3].map((k) => B64_INDEX.get(clean[i + k]) ?? 0);
    out[o++] = (a << 2) | (b >> 4);
    if (clean[i + 2] !== undefined) out[o++] = ((b & 15) << 4) | (c >> 2);
    if (clean[i + 3] !== undefined) out[o++] = ((c & 3) << 6) | d;
  }
  return out;
}

function getAudioContextCtor(): new (opts?: { sampleRate?: number }) => AudioContext {
  if (Platform.OS === "web") return (globalThis as any).AudioContext;
  return require("react-native-audio-api").AudioContext;
}

/** Gapless 16-bit PCM playback (Gemini outputs 24 kHz). flush() supports
 * barge-in: when Gemini reports an interruption, queued speech is dropped. */
export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private nextTime = 0;
  private active = new Set<AudioBufferSourceNode>();
  onPlaybackChange?: (playing: boolean) => void;

  constructor(private sampleRate = 24000) {}

  private ensureCtx(): AudioContext {
    if (!this.ctx || (this.ctx as any).state === "closed") {
      const Ctor = getAudioContextCtor();
      this.ctx = new Ctor({ sampleRate: this.sampleRate });
      this.nextTime = 0;
    }
    if ((this.ctx as any).state === "suspended") void (this.ctx as any).resume?.();
    return this.ctx!;
  }

  play(pcm: Uint8Array): void {
    const ctx = this.ensureCtx();
    const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
    if (samples.length === 0) return;
    const buffer = ctx.createBuffer(1, samples.length, this.sampleRate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 0x8000;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    const startAt = Math.max(ctx.currentTime, this.nextTime);
    source.start(startAt);
    this.nextTime = startAt + buffer.duration;

    this.active.add(source);
    if (this.active.size === 1) this.onPlaybackChange?.(true);
    source.onended = () => {
      this.active.delete(source);
      if (this.active.size === 0) this.onPlaybackChange?.(false);
    };
  }

  /** Barge-in: drop everything scheduled and go quiet immediately. */
  flush(): void {
    for (const source of this.active) {
      try {
        source.onended = null;
        source.stop();
      } catch {
        /* already ended */
      }
    }
    this.active.clear();
    this.nextTime = 0;
    this.onPlaybackChange?.(false);
  }

  stop(): void {
    this.flush();
    void (this.ctx as any)?.close?.();
    this.ctx = null;
  }
}

function floatTo16(ch: Float32Array): Uint8Array {
  const i16 = new Int16Array(ch.length);
  for (let i = 0; i < ch.length; i++) {
    const s = Math.max(-1, Math.min(1, ch[i]));
    i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return new Uint8Array(i16.buffer);
}

const WEB_WORKLET = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

/** Continuous 16-kHz mic stream. No push-to-talk: frames flow until stop()
 * and Gemini Live's automatic (server) VAD decides when a turn starts/ends. */
export class MicCapture {
  private recorder: any = null;
  private webCtx: AudioContext | null = null;
  private webStream: MediaStream | null = null;

  async start(onFrame: (pcm: Uint8Array) => void): Promise<void> {
    if (Platform.OS === "web") {
      const md = (globalThis.navigator as any)?.mediaDevices;
      if (!md?.getUserMedia) throw new Error("microphone not available in this browser");
      this.webStream = await md.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      const Ctor = getAudioContextCtor();
      this.webCtx = new Ctor({ sampleRate: 16000 });
      const url = URL.createObjectURL(new Blob([WEB_WORKLET], { type: "text/javascript" }));
      await (this.webCtx as any).audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const source = (this.webCtx as any).createMediaStreamSource(this.webStream);
      const node = new (globalThis as any).AudioWorkletNode(this.webCtx, "pcm-capture");
      node.port.onmessage = (e: MessageEvent<Float32Array>) => onFrame(floatTo16(e.data));
      source.connect(node);
      return;
    }

    const { AudioRecorder, AudioManager } = require("react-native-audio-api");
    AudioManager.setAudioSessionOptions({
      iosCategory: "playAndRecord",
      iosMode: "voiceChat",
      iosOptions: ["defaultToSpeaker", "allowBluetooth"],
    });
    const permission = await AudioManager.requestRecordingPermissions();
    if (permission !== "Granted") throw new Error("microphone permission denied");
    this.recorder = new AudioRecorder({
      sampleRate: 16000,
      bufferLengthInSamples: 1600, // 100 ms frames
    });
    this.recorder.onAudioReady((event: { buffer: AudioBuffer }) => {
      onFrame(floatTo16(event.buffer.getChannelData(0) as unknown as Float32Array));
    });
    this.recorder.start();
  }

  stop(): void {
    this.recorder?.stop();
    this.recorder = null;
    this.webStream?.getTracks().forEach((t: MediaStreamTrack) => t.stop());
    void (this.webCtx as any)?.close?.();
    this.webStream = null;
    this.webCtx = null;
  }
}
