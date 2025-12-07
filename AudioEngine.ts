import { Notice } from 'obsidian';

export type AudioTheme = 'win95' | 'msdos';

export class AudioEngine {
    private ctx: AudioContext | null = null;
    private gainNode: GainNode | null = null;
    private enabled: boolean = true;
    private volume: number = 0.5;
    private theme: AudioTheme = 'win95';

    constructor() {
        try {
            const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
            this.ctx = new AudioContextClass();
            this.gainNode = this.ctx.createGain();
            this.gainNode.connect(this.ctx.destination);
            this.setVolume(0.5);
        } catch (e) {
            console.error("AudioEngine Init Failed", e);
        }
    }

    public setEnabled(enabled: boolean) {
        this.enabled = enabled;
        if (this.ctx?.state === 'suspended' && enabled) {
            this.ctx.resume();
        }
    }

    public setVolume(vol: number) {
        this.volume = Math.max(0, Math.min(1, vol));
        if (this.gainNode) {
            this.gainNode.gain.value = this.volume;
        }
    }

    public setTheme(theme: string) {
        if (theme === 'msdos' || theme === 'win95') {
            this.theme = theme as AudioTheme;
        } else {
            // Default to Win95 for 'auto' or others unless it's strictly MS-DOS
            this.theme = 'win95';
        }
    }

    private playTone(freq: number, type: OscillatorType, duration: number, startTime: number = 0) {
        if (!this.enabled || !this.ctx || !this.gainNode) return;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime + startTime);

        // Envelope to avoid clicking
        gain.gain.setValueAtTime(0, this.ctx.currentTime + startTime);
        gain.gain.linearRampToValueAtTime(this.volume, this.ctx.currentTime + startTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + startTime + duration);

        osc.connect(gain);
        gain.connect(this.gainNode);

        osc.start(this.ctx.currentTime + startTime);
        osc.stop(this.ctx.currentTime + startTime + duration + 0.1);
    }

    private playNoise(duration: number) {
        if (!this.enabled || !this.ctx || !this.gainNode) return;
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);

        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(this.volume * 0.2, this.ctx.currentTime);
        gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + duration);

        noise.connect(gain);
        gain.connect(this.gainNode);
        noise.start();
    }

    // --- SOUND PROFILES ---

    public playStartup() {
        if (this.theme === 'msdos') {
            // Single POST Beep
            this.playTone(880, 'square', 0.3); // A5
        } else {
            // Win95 "The Sound" (Simplified Chord)
            // Eb Major add 9ish
            const t = 0;
            const dur = 2.0;
            this.playTone(311.13, 'sine', dur, t); // Eb4
            this.playTone(466.16, 'sine', dur, t + 0.1); // Bb4
            this.playTone(622.25, 'triangle', dur, t + 0.2); // Eb5
            this.playTone(830.61, 'sine', dur * 1.5, t + 0.4); // Ab5 (Dreamy)
            this.playTone(932.33, 'sine', dur, t + 0.6); // Bb5
        }
    }

    public playClick() {
        if (this.theme === 'msdos') {
            // Mechanical Key Click
            this.playTone(1200, 'square', 0.01);
        } else {
            // Soft Navigation Click
            this.playTone(600, 'triangle', 0.02);
            this.playTone(800, 'sine', 0.02, 0.01);
        }
    }

    public playKeystroke() {
        if (this.theme === 'msdos') {
             this.playTone(150, 'sawtooth', 0.03);
        } else {
             // Softer key sound
             this.playTone(300, 'triangle', 0.02);
        }
    }

    public playProcess() {
        if (this.theme === 'msdos') {
            // Floppy Seek / Computing noises
            const count = 3;
            for(let i=0; i<count; i++) {
                this.playTone(200 + Math.random() * 600, 'square', 0.05, i * 0.1);
            }
        } else {
            // HDD Chug (Synthesized Noise bursts)
             this.playNoise(0.1);
             setTimeout(() => this.playNoise(0.05), 150);
        }
    }

    public playSuccess() {
        if (this.theme === 'msdos') {
            // Happy Arpeggio
            this.playTone(523.25, 'square', 0.1, 0); // C5
            this.playTone(659.25, 'square', 0.1, 0.1); // E5
            this.playTone(783.99, 'square', 0.2, 0.2); // G5
        } else {
            // Win95 Tada
            const start = 0;
            this.playTone(1046.50, 'triangle', 0.4, start); // C6
            this.playTone(523.25, 'sine', 0.4, start); // C5

            // Slide up?
            this.playTone(1318.51, 'triangle', 0.6, start + 0.1); // E6
            this.playTone(1567.98, 'sine', 0.8, start + 0.2); // G6
            this.playTone(2093.00, 'triangle', 1.0, start + 0.4); // C7
        }
    }

    public playError() {
        if (this.theme === 'msdos') {
            // Error Buzz
            this.playTone(100, 'sawtooth', 0.4);
        } else {
            // Windows "Chord" (Bonk)
            this.playTone(200, 'sawtooth', 0.2, 0);
            this.playTone(150, 'square', 0.2, 0);
        }
    }
}
