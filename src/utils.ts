export const getPathHandle = async function(dirHandle: FileSystemDirectoryHandle, path: string) {
    const entries = path.split('/');
    const directories = entries.slice(0, -1);
    const filename = entries[entries.length - 1];

    const parentDirectoryHandle = await directories.reduce(
        async (handlePromise, directory) => handlePromise
            .then(handle => handle.getDirectoryHandle(directory)), 
        new Promise<FileSystemDirectoryHandle>(resolve => resolve(dirHandle))
    );

    return parentDirectoryHandle.getFileHandle(filename);
};

export const getPathArrayBuffer = async function(dirHandle: FileSystemDirectoryHandle, path: string) {
    const fileHandle = await getPathHandle(dirHandle, path);
    const file = await fileHandle.getFile();
    return file.arrayBuffer();
}

export const byteArrToString = (arr: Uint8Array, idx: number, len: number) => 
    [...arr.slice(idx, idx + len)].map(val => String.fromCharCode(val)).join('');

export const joinArrayBuffers = function(buffers: Uint8Array[]) {
    const newSize = buffers.reduce((size, arr) => size + arr.byteLength, 0);
    const newBuf = new Uint8Array(newSize);
    buffers.reduce((i, buf) => {
        newBuf.set(buf, i);
        return i + buf.byteLength;
    }, 0);
    return newBuf;
}

export const convertToRgb = (arr: Uint8Array): [number, number, number] => [
    [1.164,  0.000,  1.793],
    [1.164, -0.213, -0.533],
    [1.164,  2.112,  0.000],
].map(row => Math.max(0, Math.min(255, Math.round(
    row.reduce((sum, mul, i) => sum + mul * (arr[i] - (i ? 128 : 16)), 0)
)))) as [number, number, number];

export enum StreamType {
    VIDEO_MPEG1 = 0x01,
    VIDEO_MPEG2 = 0x02,
    AUDIO_MPEG1 = 0x03,
    AUDIO_MPEG2 = 0x04,
    AUDIO_LPCM = 0x80,
    AUDIO_AC3 = 0x81,
    AUDIO_DTS = 0x82,
    AUDIO_TRUHD = 0x83,
    AUDIO_AC3PLUS = 0x84,
    AUDIO_DTSHD = 0x85,
    AUDIO_DTSHD_MASTER = 0x86,
    VIDEO_VC1 = 0xea,
    VIDEO_H264 = 0x1b,
    VIDEO_HEVC = 0x24,
    SUB_PG = 0x90,
    SUB_IG = 0x91,
    SUB_TEXT = 0x92,
    AUDIO_AC3PLUS_SECONDARY = 0xa1,
    AUDIO_DTSHD_SECONDARY = 0xa2,
}

export const isVideoStream = (stream: ProgramStream): stream is VideoProgramStream => [
    StreamType.VIDEO_MPEG1, StreamType.VIDEO_MPEG2,
    StreamType.VIDEO_VC1, StreamType.VIDEO_H264, StreamType.VIDEO_HEVC,
].includes(stream.codingType);

export const isAudioStream = (stream: ProgramStream): stream is AudioProgramStream => [
    StreamType.AUDIO_MPEG1, StreamType.AUDIO_MPEG2,
    StreamType.AUDIO_LPCM, StreamType.AUDIO_AC3, StreamType.AUDIO_DTS, 
    StreamType.AUDIO_TRUHD, StreamType.AUDIO_AC3PLUS, StreamType.AUDIO_AC3PLUS_SECONDARY,
    StreamType.AUDIO_DTSHD, StreamType.AUDIO_DTSHD_MASTER, StreamType.AUDIO_DTSHD_SECONDARY,
].includes(stream.codingType);

export const isSubtitleStream = (stream: ProgramStream): stream is SubtitleProgramStream => [
    StreamType.SUB_IG, StreamType.SUB_PG,
].includes(stream.codingType);

export const isTextStream = (stream: ProgramStream): stream is SubtitleProgramStream => 
    stream.codingType === StreamType.SUB_TEXT;

export const getStreams = function(clpi: ClpiInfo) {
    return clpi.programInfo.prog[0].ps.reduce((map: StreamMap, stream) => {
        if (isVideoStream(stream))
            map.video.push(stream);
        if (isAudioStream(stream))
            map.audio.push(stream);
        if (isSubtitleStream(stream))
            map.subtitle.push(stream);
        return map;
    }, { video: [], audio: [], subtitle: [] });
}

export const getBit = (byte: number, bitIdx: number) => (byte & Math.pow(2, bitIdx)) >> bitIdx;

export const uoMaskParse = (buf: Uint8Array): UoMask => ({
    menuCall                     : Boolean(getBit(buf[0], 7)),
    titleSearch                  : Boolean(getBit(buf[0], 6)),
    chapterSearch                : Boolean(getBit(buf[0], 5)),
    timeSearch                   : Boolean(getBit(buf[0], 4)),
    skipToNextPoint              : Boolean(getBit(buf[0], 3)),
    skipToPrevPoint              : Boolean(getBit(buf[0], 2)),
    playFirstPlay                : Boolean(getBit(buf[0], 1)),
    stop                         : Boolean(getBit(buf[0], 0)),
    pauseOn                      : Boolean(getBit(buf[1], 7)),
    pauseOff                     : Boolean(getBit(buf[1], 6)),
    stillOff                     : Boolean(getBit(buf[1], 5)),
    forward                      : Boolean(getBit(buf[1], 4)),
    backward                     : Boolean(getBit(buf[1], 3)),
    resume                       : Boolean(getBit(buf[1], 2)),
    moveUp                       : Boolean(getBit(buf[1], 1)),
    moveDown                     : Boolean(getBit(buf[1], 0)),
    moveLeft                     : Boolean(getBit(buf[2], 7)),
    moveRight                    : Boolean(getBit(buf[2], 6)),
    select                       : Boolean(getBit(buf[2], 5)),
    activate                     : Boolean(getBit(buf[2], 4)),
    selectAndActivate            : Boolean(getBit(buf[2], 3)),
    primaryAudioChange           : Boolean(getBit(buf[2], 2)),

    angleChange                  : Boolean(getBit(buf[2], 0)),
    popupOn                      : Boolean(getBit(buf[3], 7)),
    popupOff                     : Boolean(getBit(buf[3], 6)),
    pgEnableDisable              : Boolean(getBit(buf[3], 5)),
    pgChange                     : Boolean(getBit(buf[3], 4)),
    secondaryVideoEnableDisable  : Boolean(getBit(buf[3], 3)),
    secondaryVideoChange         : Boolean(getBit(buf[3], 2)),
    secondaryAudioEnableDisable  : Boolean(getBit(buf[3], 1)),
    secondaryAudioChange         : Boolean(getBit(buf[3], 0)),
    pipPgChange                  : Boolean(getBit(buf[4], 6)),
});
