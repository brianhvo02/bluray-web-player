import { MAX_SAMPLES } from './consts.js';

export default class BlurayPlayer {
    audioSize = 0;
    videoReady = false;
    audioPlaying = false;
    audioSource?: AudioBufferSourceNode;
    timestamp = 0;
    graphicsWorker: Worker;
    decodingWorker: Worker;

    constructor(options?: BlurayPlayerOptions) {
        const canvas = document.getElementById(options?.canvasId ?? 'canvas');
        if (!canvas || !(canvas instanceof HTMLCanvasElement))
            throw new Error(`No <canvas> element with id ${options?.canvasId ?? 'canvas'} found`);
        const offscreenCanvas = canvas.transferControlToOffscreen();

        this.graphicsWorker = new Worker(new URL('./BlurayGraphics.js', import.meta.url), { type: "module" });
        this.graphicsWorker.postMessage({ canvas: offscreenCanvas }, [offscreenCanvas]);

        this.decodingWorker = new Worker(new URL('./BlurayDecoder.js', import.meta.url), { type: "module" });

        this.decodingWorker.onmessage = async (e: MessageEvent<DecodingMessage>) => {
            switch (e.data.type) {
                case 'video': {
                    const { frame } = e.data;
                    this.graphicsWorker.postMessage({ frame }, [frame]);
                    return;
                }
                case 'audio': {
                    const { channels, sampleRate, audio } = e.data;
                    if (!this.audioSource) {
                        const audioCtx = new AudioContext();
                        const audioBuffer = audioCtx.createBuffer(channels, MAX_SAMPLES, sampleRate);
                        this.audioSource = audioCtx.createBufferSource();
                        this.audioSource.buffer = audioBuffer;
                        this.audioSource.connect(audioCtx.destination);
                    }
                    if (this.videoReady && !this.audioPlaying) {
                        this.audioPlaying = true;
                        this.audioSource.start();
                        this.graphicsWorker.postMessage({ audioStart: true });
                    }
                    
                    audio.forEach((newBuf, channel) => this.audioSource?.buffer?.copyToChannel(newBuf, channel, this.audioSize));
                    this.audioSize += audio[0].length;
                    return;
                }
                case 'subtitle': {
                    const { displaySet } = e.data;
                    this.graphicsWorker.postMessage({ displaySet }, [displaySet.bitmap]);
                    return;
                }
            }
        }

        this.graphicsWorker.onmessage = async e => {
            if (e.data.videoReady) {
                this.videoReady = e.data.videoReady;
                
                if (!this.audioPlaying && this.audioSource) {
                    this.audioPlaying = true;
                    this.audioSource.start();
                    this.graphicsWorker.postMessage({ audioStart: true });
                }
            }
            if (e.data.timestamp && this.timestamp < e.data.timestamp) {
                this.timestamp = e.data.timestamp;
                // instance.setCurrentTime((timestamp / 2 - 189000000) / 45000);
            }
        }
    }

    async openBlurayDirectory(idx: number, time?: number) {
        // @ts-ignore
        const dirHandle = await showDirectoryPicker();
        this.decodingWorker.postMessage({ dirHandle, idx, time });
    }
}