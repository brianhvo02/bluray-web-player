declare interface MediaStreamTrackProcessorOptions {
    /** A MediaStreamTrack */
    track: MediaStreamTrack
    /** An integer specifying the maximum number of media frames to be buffered. */
    maxBufferSize?: number
}
  
declare class MediaStreamTrackProcessor extends MediaStreamTrack {
    constructor(options: MediaStreamTrackProcessorOptions)
    readable: ReadableStream<VideoFrame>
}
  
declare interface MediaStreamTrackGeneratorOptions {
    /** A MediaStreamTrack */
    kind: 'audio' | 'video'
}
  
declare class MediaStreamTrackGenerator extends MediaStreamTrack {
    constructor(options: MediaStreamTrackGeneratorOptions)
    readonly writable: WritableStream<VideoFrame | AudioData>
}