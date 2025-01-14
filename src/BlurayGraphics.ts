export default class BlurayGraphics {
    private ctx: OffscreenCanvasRenderingContext2D;
    private frames: VideoFrame[] = [];
    private displaySets: DisplaySet[] = [];
    private currentDisplaySet: DisplaySet | null = null;
    private start?: number;
    private frameIdx = 0;
    animationId?: number;

    static async init() {
        const canvas = await new Promise<OffscreenCanvas>(resolve => {
            self.onmessage = function(e) {
                self.onmessage = null;
                resolve(e.data.canvas);
            }
        });

        return new this(canvas);
    }

    private constructor(canvas: OffscreenCanvas) {
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Could not get 2d context of canvas');
        this.ctx = ctx;

        self.onmessage = (e) => {
            const { frame, audioStart, displaySet } = e.data;
        
            if (displaySet) {
                this.displaySets.push(displaySet);
                return;
            }
        
            if (frame) {
                this.frames.push(frame);
                if (this.frames.length === 5) 
                    self.postMessage({ videoReady: true });
                return;
            };
            
            if (audioStart) this.start = performance.now();
        }
    }

    animate() {
        if (!this.start) return requestAnimationFrame(this.animate.bind(this));
            
        let time = performance.now();
        const currentFrameIdx = Math.floor((time - this.start) / 1000 * 24 / 1.001);
    
        if (this.frames.length < currentFrameIdx - this.frameIdx)
            console.log('Frames, overrun');
        if (this.frameIdx < currentFrameIdx && this.frames.length > currentFrameIdx - this.frameIdx) {
            const framesToDraw = this.frames.splice(0, currentFrameIdx - this.frameIdx);
            framesToDraw.forEach(frame => {
                if (this.frameIdx + 1 === currentFrameIdx) {
                    if (this.ctx.canvas.width !== frame.displayWidth)
                        this.ctx.canvas.width = frame.displayWidth;
                    if (this.ctx.canvas.height !== frame.displayHeight)
                        this.ctx.canvas.height = frame.displayHeight;
                    this.ctx.drawImage(frame, 0, 0);
                }
                self.postMessage({ timestamp: frame.timestamp })
                frame.close();
                this.frameIdx++;
            });
    
            if (this.currentDisplaySet) {
                const { x, y } = this.currentDisplaySet.compositionInfo.compositionObjects[0];
                this.ctx.drawImage(this.currentDisplaySet.bitmap, x, y);
            }
    
            const currentTimestamp = framesToDraw[framesToDraw.length - 1].timestamp;
            for (const displaySet of this.displaySets) {
                if (displaySet.timestamp > currentTimestamp)
                    break;
                this.displaySets.shift();
                this.currentDisplaySet = displaySet.compositionInfo.compositionDescriptor.state 
                    ? displaySet : null;
            }
        }
    
        return requestAnimationFrame(this.animate.bind(this));
    }
}

const graphics = await BlurayGraphics.init();
graphics.animationId = requestAnimationFrame(graphics.animate.bind(graphics));