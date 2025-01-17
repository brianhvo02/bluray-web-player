interface PaletteInfo {
    id: number;
    version: number;
    entries: Record<number, [number, number, number, number]>;
}

interface ObjectInfo {
    id: number;
    version: number;
    width: number;
    height: number;
    decodedData: number[];
}

interface CompositionVideoDescriptor {
    videoWidth: number;
    videoHeight: number;
    frameRate: number;
}

interface CompositionDescriptor {
    number: number;
    state: number;
}

interface CompositionObject {
    objectIdRef: number;
    windowIdRef: number;
    cropFlag: boolean;
    forcedOnFlag: boolean;
    x: number;
    y: number;
    crop?: {
        x: number;
        y: number;
        w: number;
        h: number;
    }
}

interface CompositionInfo {
    videoDescriptor: CompositionVideoDescriptor;
    compositionDescriptor: CompositionDescriptor;
    paletteUpdateFlag: boolean;
    paletteIdRef: number;
    compositionObjects: CompositionObject[];
}

interface GraphicWindow {
    id: number;
    x: number;
    y: number;
    width: number;
    height: number;
}

interface WindowInfo {
    windows: GraphicWindow[];
}

interface DisplaySet {
    timestamp: number;
    paletteInfo: PaletteInfo;
    objectInfo: ObjectInfo;
    compositionInfo: CompositionInfo;
    windowInfo: WindowInfo;
    bitmap: ImageBitmap;
}

interface BlurayPlayerOptions {
    videoEl: HTMLVideoElement;
    canvasEl: HTMLCanvasElement;
    extCanvasEl: HTMLCanvasElement;
}

interface DecodingVideoMessage {
    type: 'video';
    frame: VideoFrame;
}

interface DecodingAudioMessage {
    type: 'audio';
    audio: AudioData;
}

interface DecodingSubtitlesMessage {
    type: 'subtitle';
    displaySet: DisplaySet;
}

interface DecodingClipInfoMessage {
    type: 'clipInfo';
    clpi: ClpiInfo;
}

interface DecodingStartMessage {
    type: 'startTime';
    startTime: number;
}

type DecodingMessage = DecodingVideoMessage | DecodingAudioMessage | DecodingSubtitlesMessage | DecodingClipInfoMessage | DecodingStartMessage;

interface DemuxOptions {
    dirHandle: FileSystemDirectoryHandle;
    clipId: string;
    time: number;
    video?: number;
    audio?: number;
    subtitle?: number;
}