export default class BlurayGraphics {
    private ctx: OffscreenCanvasRenderingContext2D;
    private frames: VideoFrame[] = [];
    private audio: AudioData[] = [];
    private displaySets: DisplaySet[] = [];
    private start: number | null = null;
    private startTime = 0;
    videoWriter?: WritableStreamDefaultWriter<VideoFrame | AudioData>;
    audioWriter?: WritableStreamDefaultWriter<VideoFrame | AudioData>;
    animationId?: number;

    static async init() {
        const { canvas } = await new Promise<{ canvas: OffscreenCanvas }>(resolve => {
            self.onmessage = function(e) {
                self.onmessage = null;
                resolve(e.data);
            }
        });

        return new this(canvas);
    }

    private constructor(canvas: OffscreenCanvas) {
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get 2d context of canvas');
        this.ctx = ctx;

        self.onmessage = (e) => {
            const { frame, audio, displaySet, videoWriter, audioWriter, startTime } = e.data;
        
            if (startTime) {
                this.startTime = startTime;
                return;
            }
            if (displaySet) this.displaySets.push(displaySet);
            if (frame) this.frames.push(frame);
            if (audio) this.audio.push(audio);

            if (videoWriter && audioWriter) {
                this.ctx.clearRect(0, 0, 1920, 1080);
                this.displaySets.length = 0;
                this.frames.forEach(frame => frame.close());
                this.frames.length = 0;
                this.audio.forEach(audio => audio.close());
                this.audio.length = 0;
                this.start = null;
                this.videoWriter = videoWriter.getWriter();
                this.audioWriter = audioWriter.getWriter();
            }
            
            if (!this.start && this.frames.length > 5 && this.audio.length > 200)
                this.start = performance.now();
        }
    }

    async animate() {
        if (!this.start || !this.videoWriter || !this.audioWriter) return setTimeout(this.animate.bind(this));
        const time = performance.now();

        const latestFrameIdx = this.frames.findIndex(frame => frame.timestamp > (time - this.start!) * 1000);
        const framesToDraw = this.frames.splice(0, latestFrameIdx);
        if (framesToDraw.length)
            self.postMessage({ timestamp: framesToDraw[framesToDraw.length - 1].timestamp / 1000000 + this.startTime })
        for (const frame of framesToDraw)
            await this.videoWriter.write(frame);

        const latestAudioIdx = this.audio.findIndex(audio => audio.timestamp > (time - this.start!) * 1000);
        const audioToPlay = this.audio.splice(0, latestAudioIdx);
        for (const audio of audioToPlay)
            await this.audioWriter.write(audio);

        const latestDisplaySetIdx = this.displaySets.findIndex(audio => audio.timestamp > (time - this.start!) * 1000);
        const displaySet = this.displaySets.splice(0, latestDisplaySetIdx)[latestDisplaySetIdx - 1];
        if (displaySet?.compositionInfo.compositionDescriptor.state) {
            const { x, y } = displaySet.compositionInfo.compositionObjects[0];
            this.ctx.drawImage(displaySet.bitmap, x, y);
        } else if (displaySet) {
            this.ctx.clearRect(0, 0, 1920, 1080);
        }
    
        return setTimeout(this.animate.bind(this));
    }
}

const graphics = await BlurayGraphics.init();
graphics.animationId = setTimeout(graphics.animate.bind(graphics));