/**
 * Browser audio for Gemini Live: real-time PCM playback (no fs.writeFile /
 * WAV files — the Node reference's audio.wav is replaced by scheduling
 * AudioBufferSourceNodes) and 16-kHz mic capture via an AudioWorklet.
 */

export function base64ToBytes(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Plays 16-bit little-endian PCM chunks gaplessly (Gemini outputs 24 kHz). */
export class PcmPlayer {
  private ctx: AudioContext | null = null;
  private nextTime = 0;
  onPlaybackChange?: (playing: boolean) => void;
  private activeSources = 0;

  constructor(private sampleRate = 24000) {}

  private ensureCtx(): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") {
      this.ctx = new AudioContext({ sampleRate: this.sampleRate });
      this.nextTime = 0;
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
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

    this.activeSources++;
    if (this.activeSources === 1) this.onPlaybackChange?.(true);
    source.onended = () => {
      this.activeSources--;
      if (this.activeSources === 0) this.onPlaybackChange?.(false);
    };
  }

  stop(): void {
    void this.ctx?.close();
    this.ctx = null;
    this.activeSources = 0;
    this.onPlaybackChange?.(false);
  }
}

const WORKLET_SOURCE = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    if (ch && ch.length) {
      const i16 = new Int16Array(ch.length);
      for (let i = 0; i < ch.length; i++) {
        const s = Math.max(-1, Math.min(1, ch[i]));
        i16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
      this.port.postMessage(i16.buffer, [i16.buffer]);
    }
    return true;
  }
}
registerProcessor("pcm-capture", PcmCapture);
`;

/** getUserMedia → AudioWorklet → 16-kHz Int16 PCM frames. */
export class MicCapture {
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;

  async start(onFrame: (pcm: Uint8Array) => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    this.ctx = new AudioContext({ sampleRate: 16000 });
    const workletUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
    await this.ctx.audioWorklet.addModule(workletUrl);
    URL.revokeObjectURL(workletUrl);

    const source = this.ctx.createMediaStreamSource(this.stream);
    const node = new AudioWorkletNode(this.ctx, "pcm-capture");
    node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onFrame(new Uint8Array(e.data));
    source.connect(node);
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.stream = null;
    this.ctx = null;
  }
}
