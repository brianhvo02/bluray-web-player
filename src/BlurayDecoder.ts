import { GIGABYTE_PACKETS, MIN_INT, MAX_INT, CHANNEL_LAYOUTS, BITS_PER_SAMPLE, SAMPLE_RATE } from './consts.js';
import { byteArrToString, convertToRgb, getPathArrayBuffer, getPathHandle, getStreams, joinArrayBuffers, StreamType } from './utils.js';

const config: VideoDecoderConfig = {
    codec: 'avc1.640829',
    codedWidth: 1920,
    codedHeight: 1080,
}

let flag = true;

class BlurayDecoder {
    file: File;
    clpi: ClpiInfo;
    initialPacketIdx: number;
    private videoContinuity: number | null = null;
    private audioContinuity: number | null = null;
    private prevVideoTimestamp: number | null = null;
    private prevAudioTimestamp: number | null = null;
    private pendingVideo: Uint8Array[] = [];
    private pendingAudio: Uint8Array[] = [];
    private pendingPg: Uint8Array[] = [];
    private audioPacketSize: number | null = null;
    private audioOffset: number | null = null;
    private displaySet: Partial<DisplaySet> = {};
    private decoder: VideoDecoder | null = null;
    private newDecoder = true;
    streamMap: StreamMap;
    currentVideoPid: number | null = null;
    currentAudioPid: number | null = null;
    currentSubtitlePid: number | null = null;
    buffers: Promise<ArrayBuffer>[] = [];
    buffersLoaded: Promise<void>;
    gib = 0;
    idx = 0;

    static getClipInfo(buf: ArrayBuffer): ClpiInfo {
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

    lookupClipSpn(timestamp: number) {
        const { presentationStartTime, presentationEndTime } = this.clpi.sequenceInfo.atcSeq[0].stcSeq[0];
        console.log('presentationStartTime:', presentationStartTime);
        console.log('total time:', (presentationEndTime - presentationStartTime) / 45000)
        const entry = this.clpi.cpiInfo.entries[0];
        const maxCoarseIdx = entry.coarse.findIndex(({ ptsEp }) => ((ptsEp & ~0x01) << 18) > timestamp + presentationStartTime);
        let i = maxCoarseIdx;
        let fineIdx = 0;
        while (i > -1) {
            const coarse = entry.coarse[i];
            const fines = entry.fine.slice(coarse.refEpFineId, entry.coarse[i + 1].refEpFineId);
        
            fineIdx = fines.findIndex(({ ptsEp }) => ((coarse.ptsEp & ~0x01) << 18) + (ptsEp << 8) < timestamp + presentationStartTime);
            if (fineIdx > -1)
                break;
    
            i--;
        }
    
        if (i === -1) {
            i = 0;
            fineIdx = 0;
        }
    
        const { spnEp, refEpFineId } = entry.coarse[i];
        return (spnEp & ~0x1FFFF) + entry.fine[refEpFineId + fineIdx].spnEp;
    }

    getDecoder() {
        if (!this.decoder || this.decoder.state === 'closed') {
            this.newDecoder = true;
            this.decoder = new VideoDecoder({
                output: async function(frame) {
                    // @ts-ignore
                    self.postMessage({ type: 'video', frame }, [frame]);
                },
                error: function(e) {
                    // self.postMessage({ type: 'decodingComplete' });
                },
            });
            this.decoder.configure(config);
        }

        return this.decoder;
    } 

    constructor(file: File, clpi: ClpiInfo, time: number) {
        this.file = file;
        this.clpi = clpi;
        this.streamMap = getStreams(clpi);
        this.initialPacketIdx = time ? this.lookupClipSpn(time * 45000) : 0;
        this.buffersLoaded = new Promise<void>(async resolve => {
            for (let i = 0; i < Math.ceil(this.file.size / (GIGABYTE_PACKETS * 192)); i++) {
                const end = (i + 1) * GIGABYTE_PACKETS * 192;
                this.buffers.push(this.file.slice(...[i * GIGABYTE_PACKETS * 192].concat(end < this.file.size ? end : [])).arrayBuffer());
                await this.buffers[i];
            }
            resolve();
        });
    }

    private getPacketInfo(packet: Uint8Array) {
        const pusi = (packet[5] & 0x40) >> 6;
        const continuityCounter = packet[7] & 0xF;
        const adaptation = (packet[7] & 0x30) >> 5;
        const adaptationSize = adaptation && packet[8] + 1;
        const startCode = Boolean(pusi) && packet[adaptationSize + 8] === 0 && packet[adaptationSize + 9] === 0 && packet[adaptationSize + 10] === 1;
        const payload = packet.slice(8 + adaptationSize + (Number(startCode) && (9 + packet[8 + adaptationSize + 8])));

        const timestamp = startCode && packet[adaptationSize + 11] !== 0xBF && (packet[adaptationSize + 15] & 0x80) ? (
            ((packet[adaptationSize + 17] & 0x0E) << 29) |
            (packet[adaptationSize + 18] << 22) |
            ((packet[adaptationSize + 19] & 0xFE) << 14) |
            (packet[adaptationSize + 20] << 7) |
            ((packet[adaptationSize + 21] & 0xFE) >> 1)
        ): null;

        const newPacketSize = ((packet[adaptationSize + 12] << 8) | packet[adaptationSize + 13]) - (packet.byteLength - adaptationSize - 14);

        return { startCode, timestamp, continuityCounter, payload, newPacketSize };
    }

    private async decodeSubtitlePacket(packet: Uint8Array) {
        const { startCode, timestamp, payload } = this.getPacketInfo(packet);

        if (startCode && this.pendingPg.length) {
            const buf = joinArrayBuffers(this.pendingPg);
            const dataView = new DataView(buf.buffer);
            const type = buf[0];
            // const len = dataView.getUint16(1);
            switch (type) {
                case 0x14: { // PGS_PALETTE
                    // console.log('PGS_PALETTE');
                    this.displaySet.paletteInfo = {
                        id: buf[3],
                        version: buf[4],
                        entries: [...Array((buf.byteLength - 5) / 5).keys()].reduce((map: Record<number, [number, number, number, number]>, i) => {
                            const entryIdx = 5 + i * 5;
                            const id = buf[entryIdx];
                            map[id] = [...convertToRgb(buf.slice(entryIdx + 1, entryIdx + 4)), buf[entryIdx + 4]];

                            return map;
                        }, {}),
                    };
                    // console.log(paletteInfo);
                    break;
                }
                case 0x15: { // PGS_OBJECT
                    // console.log('PGS_OBJECT');

                    if (!((buf[6] & 0x80) >> 7)) {
                        console.error('not first in sequence');
                        return;
                    }
                    
                    if (!((buf[6] & 0x40) >> 6)) {
                        console.error('not last in sequence');
                        return;
                    }
                    
                    const dataLen = ((buf[7] << 16) | (buf[8] << 8) | buf[9]);
                    if (dataLen !== buf.byteLength - 10) {
                        console.error(`buffer size mismatch: expected ${dataLen}, have ${buf.byteLength - 10}`);
                        return;
                    }
                    
                    const width = dataView.getUint16(10);
                    const height = dataView.getUint16(12);

                    let i = 0;
                    const payload = buf.slice(14);
                    const decodedData = [];
                    let pixelsDecoded = 0;
                    
                    while (i < payload.byteLength) {
                        let color = payload[i];
                        i++;
                
                        let run = 1;
                
                        if (color == 0x00) {
                            const flags = payload[i];
                            i++;
                            
                            run = flags & 0x3f;
                            if (flags & 0x40) {
                                run = (run << 8) + payload[i];
                                i++;
                            }
                
                            if (flags & 0x80) {
                                color = payload[i];
                                i++;
                            } else {
                                color = 0;
                            }
                        } 
                
                        if (run < 0) {
                            console.error('problem decoding pgs object');
                            break;
                        }
                        if (run > 0) {
                            for (let j = 0; j < run; j++)
                                decodedData.push(color);
                            pixelsDecoded += run;
                        } else if (pixelsDecoded % width != 0) {
                            console.error('pixelsDecoded: %lu, width: %u\n', pixelsDecoded, width);
                            console.error('Incorrect number of pixels\n');
                            break;
                        }
                    }
                    
                    const expectedSize = width * height;
                    const actualSize = decodedData.length;
                    
                    if (actualSize < expectedSize) {
                        console.error('Not enough pixels decoded: %lu < %lu\n', actualSize, expectedSize);
                        break;
                    } else if (actualSize > expectedSize) {
                        console.log('Expected %lu pixels, got %lu\n', actualSize, expectedSize);
                    }

                    this.displaySet.objectInfo = {
                        id: dataView.getUint16(3),
                        version: buf[5],
                        decodedData,
                        width,
                        height,
                    };                        
                    
                    // console.log(objectInfo);
                    break;
                }
                case 0x16: { // PGS_PG_COMPOSITION
                    // console.log('PGS_PG_COMPOSITION');
                    const baseTs = this.clpi.sequenceInfo.atcSeq[0].stcSeq[0].presentationStartTime * 2;
                    this.displaySet.timestamp = ((timestamp ?? baseTs) - baseTs) / 90 * 1000;
                    this.displaySet.compositionInfo = {
                        videoDescriptor: {
                            videoWidth: dataView.getUint16(3),
                            videoHeight: dataView.getUint16(5),
                            frameRate: (buf[7] & 0xF0) >> 4,
                        },
                        compositionDescriptor: {
                            number: dataView.getUint16(8),
                            state: (buf[10] & 0xC0) >> 6,
                        },
                        paletteUpdateFlag: Boolean((buf[11] & 0x80) >> 7),
                        paletteIdRef: buf[12],
                        // numCompositionObjects: buf[13],
                        compositionObjects: Array(buf[13]).fill(0).reduce(([offset, objs]) => {
                            const cropFlag = Boolean((buf[offset + 3] & 0x80) >> 7);
                            objs.push({
                                objectIdRef: dataView.getUint16(offset),
                                windowIdRef: buf[offset + 2],
                                cropFlag,
                                forcedOnFlag: Boolean((buf[offset + 3] & 0x40) >> 6),
                                x: dataView.getUint16(offset + 4),
                                y: dataView.getUint16(offset + 6),
                                ...((buf[offset + 2] & 0x80) >> 7 ? {
                                    cropX: dataView.getUint16(offset + 8),
                                    cropY: dataView.getUint16(offset + 10),
                                    cropW: dataView.getUint16(offset + 12),
                                    cropH: dataView.getUint16(offset + 14),
                                } : {}),
                            });
                            return [offset + 8 + (cropFlag && 8), objs];
                        }, [14, []])[1],
                    };
                    // console.log(compositionInfo);
                    break;
                }
                case 0x17: { // PGS_WINDOW
                    // console.log('PGS_WINDOW');
                    this.displaySet.windowInfo = {
                        // numWindows: buf[3],
                        windows: [...Array(buf[3]).keys()].map(i => {
                            return {
                                id: buf[i + 4],
                                x: dataView.getUint16(i + 5),
                                y: dataView.getUint16(i + 7),
                                width: dataView.getUint16(i + 9),
                                height: dataView.getUint16(i + 11),
                            }
                        })
                    };
                    // console.log(len, windowInfo);
                    break;
                }
                case 0x80: { // PGS_END_OF_DISPLAY
                    // console.log('PGS_END_OF_DISPLAY');
                    if (!this.displaySet.objectInfo || !this.displaySet.paletteInfo) break;
                    const { width, height, decodedData } = this.displaySet.objectInfo;
                    const arr = new Uint8ClampedArray(width * height * 4);
                    decodedData.forEach((palette, i) =>
                        arr.set(this.displaySet.paletteInfo!.entries[palette], i * 4));
                    const imageData = new ImageData(arr, width, height);
                    const bitmap = await self.createImageBitmap(imageData);
                    this.displaySet.bitmap = bitmap;
                    self.postMessage({ 
                        type: 'subtitle',
                        displaySet: this.displaySet 
                    // @ts-ignore
                    }, [bitmap]);
                    break;
                }
                default: console.log('pg', type.toString(16));
            }

            this.pendingPg.length = 0;
            this.pendingPg.push(payload);
        } else this.pendingPg.push(payload);
    }

    private async decodeAudioPacket(packet: Uint8Array) {
        const { startCode, timestamp, continuityCounter, payload, newPacketSize } = this.getPacketInfo(packet);

        if (this.audioContinuity === null)
            this.audioContinuity = continuityCounter - 1;

        if ((this.audioContinuity + 1) % 16 !== continuityCounter) {
            console.error('Audio continuity error');
            return;
        }
        this.audioContinuity = continuityCounter;

        if (this.audioPacketSize === null && startCode && !continuityCounter)
            this.audioPacketSize = newPacketSize;
        if (startCode && this.prevAudioTimestamp === null)
            this.prevAudioTimestamp = timestamp;
        if (startCode && payload[0] === 0x05 && payload[1] === 0xA0) {
            if (this.pendingAudio.length) {
                if (this.audioPacketSize)
                    console.error('PES packet mismatch');
                const payload = joinArrayBuffers(this.pendingAudio);

                const channelLayout = CHANNEL_LAYOUTS[payload[2] >> 4];
                const numberOfChannels = channelLayout?.channels ?? 0;
                const sampleRate = SAMPLE_RATE[payload[2] & 0x0f];
                const buf = payload.slice(4);
                const data = new Uint8Array(buf.byteLength / 3 * 4);

                for (let i = 0; i < buf.byteLength / 3; i++) {
                    const idx = i * 3;
                    data.set([0, buf[idx + 2], buf[idx + 1], buf[idx]], i * 4);
                }

                const baseTs = this.clpi.sequenceInfo.atcSeq[0].stcSeq[0].presentationStartTime * 2;
                if (!this.audioOffset) 
                    this.audioOffset = this.prevAudioTimestamp ?? baseTs;
                const audio = new AudioData({
                    format: 's32',
                    sampleRate,
                    numberOfFrames: data.byteLength / 4 / numberOfChannels,
                    numberOfChannels,
                    timestamp: ((this.prevAudioTimestamp ?? baseTs) - this.audioOffset) / 90 * 1000,
                    data,
                    transfer: [data.buffer],
                });
                    
                self.postMessage({ 
                    type: 'audio', 
                    audio, timestamp,
                });
            };
            this.pendingAudio.length = 0;
            this.audioPacketSize = newPacketSize;
            this.prevAudioTimestamp = timestamp;
            this.pendingAudio.push(payload);
        } else {
            this.pendingAudio.push(payload);
            if (this.audioPacketSize !== null)
                this.audioPacketSize -= payload.byteLength;
        }
    }

    private async decodeVideoBuf() {
        const baseTs = this.clpi.sequenceInfo.atcSeq[0].stcSeq[0].presentationStartTime * 2;
        const newBuf = joinArrayBuffers(this.pendingVideo);

        const iframeIdx = newBuf.findIndex((val, idx, arr) => val === 0 && arr[idx + 1] === 0 && (
            (arr[idx + 2] === 1 && arr[idx - 1] !== 0 && (arr[idx + 3] & 0x1F) === 5) ||
            (arr[idx + 2] === 0 && arr[idx + 3] === 1 && (arr[idx + 4] & 0x1F) === 5)
        ));
        const iframe = iframeIdx > -1;

        const decoder = this.getDecoder();
        if (this.newDecoder && !iframe) return;
        else this.newDecoder = false;
        
        try {
            if (iframe) await decoder.flush();
            decoder.decode(new EncodedVideoChunk({
                timestamp: ((this.prevVideoTimestamp ?? baseTs) - baseTs) / 90 * 1000,
                type: iframe ? 'key' : 'delta',
                data: newBuf,
            }));
        } catch(e) {
            return;
        }
    }

    private async decodeVideoPacket(packet: Uint8Array) {
        if (packet.byteLength === 0)
            return this.decodeVideoBuf();
        
        const { startCode, timestamp, continuityCounter, payload } = this.getPacketInfo(packet);
        if (startCode && this.prevVideoTimestamp === null)
            this.prevVideoTimestamp = timestamp;

        if (this.videoContinuity === null)
            this.videoContinuity = continuityCounter - 1;

        if ((this.videoContinuity + 1) % 16 !== continuityCounter) {
            console.error('Video continuity error');
            return;
        }

        this.videoContinuity = continuityCounter;
        
        if (this.pendingVideo.length && startCode) {
            await this.decodeVideoBuf();

            this.pendingVideo.length = 0;
            this.pendingVideo.push(payload);
            this.prevVideoTimestamp = timestamp;
        } else this.pendingVideo.push(payload);
    }

    
    async demux(options?: DemuxOptions) { 
        this.currentVideoPid =  this.streamMap.video[options?.video ?? 0]?.pid ?? null;
        this.currentAudioPid = this.streamMap.audio[options?.audio ?? 0]?.pid ?? null;
        this.currentSubtitlePid = this.streamMap.subtitle[options?.subtitle ?? 0]?.pid ?? null;
        console.log('demuxing', this.file.name);

        const max = Math.ceil(this.file.size / (GIGABYTE_PACKETS * 192));
        for (this.gib = Math.floor(this.initialPacketIdx / GIGABYTE_PACKETS); this.gib < max; this.gib++) {
            const buf = await this.buffers[this.gib];
            for (this.idx = this.initialPacketIdx % GIGABYTE_PACKETS; this.idx < buf.byteLength / 192; this.idx++) {
                if (this.decoder?.state === 'closed')
                    return;

                const packet = new Uint8Array(buf.slice(this.idx * 192, (this.idx + 1) * 192));
                if (packet[4] !== 0x47) {
                    console.error('sync byte not present at', this.idx * 192);
                    return;
                }
                const pid = ((packet[5] & 0x1F) << 8) | packet[6];
                // console.log('pid:', pid.toString(16).padStart(4, '0').toUpperCase());

                if (pid === this.currentSubtitlePid)
                    await this.decodeSubtitlePacket(packet);

                if (pid === this.currentAudioPid)
                    await this.decodeAudioPacket(packet);
                
                if (pid === this.currentVideoPid)
                    await this.decodeVideoPacket(packet);
            }
        }

        // if (this.getDecoder().state !== 'closed')
        //     self.postMessage({ type: 'decodingComplete' });

        // await this.decodeVideoPacket(new Uint8Array());
        // self.postMessage({ type: 'decodingComplete' });
        // const newBuf = joinArrayBuffers(this.pendingVideo);
        // test.push(newBuf);
        // console.log('done')
    }

    close() {
        this.gib = Math.ceil(this.file.size / (GIGABYTE_PACKETS * 192));
        this.getDecoder().close();
    }
}

const { supported } = await VideoDecoder.isConfigSupported(config);
if (!supported) throw new Error('codec not supported');

let decoder: BlurayDecoder | null = null;
let demuxer: Promise<void> | null = null;
onmessage = async function(e: MessageEvent<DemuxOptions>) {
    if (decoder) {
        decoder.close();
        await demuxer;
    }
    const { dirHandle, clipId, time, ...options } = e.data;
    
    const clpi = await getPathArrayBuffer(dirHandle, `BDMV/CLIPINF/${clipId}.clpi`)
        .then(BlurayDecoder.getClipInfo);

    const fh = await getPathHandle(dirHandle, `BDMV/STREAM/${clipId}.m2ts`);
    const file = await fh.getFile();

    self.postMessage({ type: 'clipInfo', clpi });
    
    decoder = new BlurayDecoder(file, clpi, time);
    demuxer = decoder.demux();
}