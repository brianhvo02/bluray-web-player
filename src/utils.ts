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

export const getClipInfo = function(buf: ArrayBuffer): ClpiInfo {
    const dataView = new DataView(buf);
    const arr = new Uint8Array(buf);

    const bdHeader: BlurayHeader = {
        tag: byteArrToString(arr, 0, 4),
        ver: byteArrToString(arr, 4, 4),
    };
    
    const sequenceInfoStartIdx = dataView.getUint32(8);
    const programInfoStartIdx = dataView.getUint32(12);
    const cpiStartIdx = dataView.getUint32(16);
    // const clipMarkStartIdx = dataView.getUint32(20);
    // const extDataStartIdx = dataView.getUint32(24);
    
    // TODO: ext_data
    
    const tsTypeInfoLength = dataView.getUint16(188);
    const clipInfo: ClipInfo = {
        // clipInfoLength: dataView.getUint32(40),
        clipStreamType: arr[46],
        applicationType: arr[47],
        isAtcDelta: Boolean(arr[51] & 1),
        tsRecordingRate: dataView.getUint32(52),
        numSourcePackets: dataView.getUint32(56),
        // tsTypeInfoLength,
        tsTypeInfo: tsTypeInfoLength ? {
            validity: arr[190],
            formatId: byteArrToString(arr, 191, 4)
        } : undefined,
        // TODO: is_atc_delta
    };
    // TODO: font info
    
    const sequenceInfo: SequenceInfo = {
        // sequenceInfoLength: dataView.getUint32(sequenceInfoStartIdx),
        // numAtcSeq: arr[sequenceInfoStartIdx + 5],
        atcSeq: Array(arr[sequenceInfoStartIdx + 5]).fill(0).reduce(([offset, seqs]) => {
            const numStcSeq = arr[offset + 4];
            const seq = {
                spnAtcStart: dataView.getUint32(offset),
                // numStcSeq: arr[offset + 4],
                offsetStcId: arr[offset + 5],
                stcSeq: [...Array(numStcSeq).keys()].map(i => {
                    const stcSeqIdx =  offset + 6 + i * 14;
                    return {
                        pcrPid: dataView.getUint16(stcSeqIdx),
                        spnStcStart: dataView.getUint32(stcSeqIdx + 2),
                        presentationStartTime: dataView.getUint32(stcSeqIdx + 6),
                        presentationEndTime: dataView.getUint32(stcSeqIdx + 10),
                    }
                }),
            };
            seqs.push(seq);
            return [offset + 6 + numStcSeq * 14, seqs];
        }, [sequenceInfoStartIdx + 6, []])[1],
    };
    
    const programInfo: ProgramInfo = {
        // programInfoLength: dataView.getUint32(programInfoStartIdx),
        // numProg: arr[programInfoStartIdx + 5],
        prog: Array(arr[programInfoStartIdx + 5]).fill(0).reduce(([offset, progs]) => {
            const numStreams = arr[offset + 6];
            const seq = {
                spnProgramSequenceStart: dataView.getUint32(offset),
                programMapPid: dataView.getUint16(offset + 4),
                numStreams,
                numGroups: arr[offset + 7],
                ps: Array(arr[offset + 6]).fill(0).reduce(([offset, progs]) => {
                    const pid = dataView.getUint16(offset);
                    const len = arr[offset + 2];
                    const codingType = arr[offset + 3];
                    switch (codingType) {
                        case StreamType.VIDEO_MPEG1:
                        case StreamType.VIDEO_MPEG2:
                        case StreamType.VIDEO_VC1:
                        case StreamType.VIDEO_H264:
                        case StreamType.VIDEO_HEVC:
                        case 0x20:
                            progs.push({
                                codingType,
                                pid,
                                format: (arr[offset + 4] & 0xF0) >> 4,
                                rate: arr[offset + 4] & 0xF,
                                aspect: (arr[offset + 5] & 0xF0) >> 4,
                                ocFlag: (arr[offset + 5] & 0b10) >> 1,
                                crFlag: codingType == 0x24 ?
                                    arr[offset + 5] & 1 :
                                    null,
                                dynamicRangeType: codingType == 0x24 ?
                                    (arr[offset + 6] & 0xF0) >> 4:
                                    null,
                                colorSpace: codingType == 0x24 ?
                                    arr[offset + 6] & 0xF :
                                    null,
                                hdrPlusFlag: codingType == 0x24 ?
                                    (arr[offset + 6] & 0x80) >> 7 :
                                    null,
                            });
                            break;
                
                        case StreamType.AUDIO_MPEG1:
                        case StreamType.AUDIO_MPEG2:
                        case StreamType.AUDIO_LPCM:
                        case StreamType.AUDIO_AC3:
                        case StreamType.AUDIO_DTS:
                        case StreamType.AUDIO_TRUHD:
                        case StreamType.AUDIO_AC3PLUS:
                        case StreamType.AUDIO_DTSHD:
                        case StreamType.AUDIO_DTSHD_MASTER:
                        case StreamType.AUDIO_AC3PLUS_SECONDARY:
                        case StreamType.AUDIO_DTSHD_SECONDARY:
                            progs.push({
                                codingType,
                                pid,
                                format: (arr[offset + 4] & 0xF0) >> 4,
                                rate: arr[offset + 4] & 0xF,
                                lang: byteArrToString(arr, offset + 5, 3),
                            });
                            break;
                
                        case StreamType.SUB_PG:
                        case StreamType.SUB_IG:
                        case 0xa0:
                            progs.push({
                                codingType,
                                pid,
                                lang: byteArrToString(arr, offset + 4, 3),
                            });
                            break;
                
                        case StreamType.SUB_TEXT:
                            progs.push({
                                codingType,
                                pid,
                                charCode: byteArrToString(arr, offset + 4, 1),
                                lang: byteArrToString(arr, offset + 5, 3),
                            });
                            break;
                
                        default: break;
                    };
    
                    return [offset + len + 3, progs];
                }, [offset + 8, []])[1],
            };
            progs.push(seq);
            return [offset + 6 + numStreams * 14, progs];
        }, [programInfoStartIdx + 6, []])[1],
    };
    
    const cpiInfo: CpiInfo = {
        // cpiLength: dataView.getUint32(cpiStartIdx),
        type: arr[cpiStartIdx + 5] & 0x0F,
        numStreamPid: arr[cpiStartIdx + 7],
        entries: Array(arr[cpiStartIdx + 7]).fill(0).reduce(([offset, cpiEntries]) => {
            const numEpCoarse = ((arr[offset + 3] & 0b11) << 15) | (arr[offset + 4] << 6) | ((arr[offset + 5] & 0xFC) >> 2);
            const numEpFine = ((arr[offset + 5] & 0b11) << 16 | dataView.getUint16(offset + 6));
            const mapStreamStartAddress = cpiStartIdx + 6 + dataView.getUint32(offset + 8);
            const fineStart = dataView.getUint32(mapStreamStartAddress);
            cpiEntries.push({
                pid: dataView.getUint16(offset),
                epStreamType: (arr[offset + 3] & 0x3C) >> 2,
                // numEpCoarse,
                // numEpFine,
                // mapStreamStartAddress,
                coarse: [...Array(numEpCoarse).keys()].map(i => {
                    const coarseIdx = mapStreamStartAddress + 4 + i * 8
                    return {
                        refEpFineId: (dataView.getUint32(coarseIdx) & 0xFFFFC000) >> 0xE,
                        ptsEp: dataView.getUint32(coarseIdx) & 0x3FFF,
                        spnEp: dataView.getUint32(coarseIdx + 4),
                    }
                }),
                fine: [...Array(numEpFine).keys()].map(i => {
                    const fineIdx = mapStreamStartAddress + fineStart + i * 4;
                    return {
                        isAngleChangePoint: Boolean((arr[fineIdx] & 0x80) >> 7),
                        iEndPositionOffset: (arr[fineIdx] & 0x70) >> 4,
                        ptsEp: ((arr[fineIdx] & 0xF) << 7) | ((arr[fineIdx + 1] & 0xFE) >> 1),
                        spnEp: ((arr[fineIdx + 1] & 1) << 16) | (arr[fineIdx + 2] << 8) | arr[fineIdx + 3],
                    }
                }),
            });
    
            return [offset + 6 + dataView.getUint32(offset + 8) + fineStart + numEpFine * 4, cpiEntries];
        }, [cpiStartIdx + 8, []])[1],
    };

    return { bdHeader, clipInfo, sequenceInfo, programInfo, cpiInfo };
}