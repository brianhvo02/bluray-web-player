import { GIGABYTE_PACKETS, MIN_INT, MAX_INT, CHANNEL_LAYOUTS, BITS_PER_SAMPLE, SAMPLE_RATE } from './consts.js';
import { byteArrToString, convertToRgb, getPathHandle, joinArrayBuffers } from './utils.js';

const config: VideoDecoderConfig = {
    codec: 'avc1.640829',
    codedWidth: 1920,
    codedHeight: 1080,
}

export default class BlurayDecoder {
    file: File;
    clpi: ClpiInfo;
    initialPacketIdx: number;
    private loaded = false;
    private loadingStart: number | null = null;
    private startPts = Infinity;
    private videoContinuity: number | null = null;
    private audioContinuity: number | null = null;
    private pendingVideo: Uint8Array[] = [];
    private pendingAudio: number[] = [];
    private pendingPg: Uint8Array[] = [];
    private packetSize: number | null = null;
    private streamInfo: AudioStreamInfo | null = null;
    private displaySet: Partial<DisplaySet> = {};

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
                    stcSeq: Array(numStcSeq).fill(0).map((_, i) => {
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
                            case 0x01:
                            case 0x02:
                            case 0xea:
                            case 0x1b:
                            case 0x20:
                            case 0x24:
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
                    
                            case 0x03:
                            case 0x04:
                            case 0x80:
                            case 0x81:
                            case 0x82:
                            case 0x83:
                            case 0x84:
                            case 0x85:
                            case 0x86:
                            case 0xa1:
                            case 0xa2:
                                progs.push({
                                    codingType,
                                    pid,
                                    format: (arr[offset + 4] & 0xF0) >> 4,
                                    rate: arr[offset + 4] & 0xF,
                                    lang: byteArrToString(arr, offset + 5, 3),
                                });
                                break;
                    
                            case 0x90:
                            case 0x91:
                            case 0xa0:
                                progs.push({
                                    codingType,
                                    pid,
                                    lang: byteArrToString(arr, offset + 4, 3),
                                });
                                break;
                    
                            case 0x92:
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
                    coarse: Array(numEpCoarse).fill(0).map((_, i) => {
                        const coarseIdx = mapStreamStartAddress + 4 + i * 8
                        return {
                            refEpFineId: (dataView.getUint32(coarseIdx) & 0xFFFFC000) >> 0xE,
                            ptsEp: dataView.getUint32(coarseIdx) & 0x3FFF,
                            spnEp: dataView.getUint32(coarseIdx + 4),
                        }
                    }),
                    fine: Array(numEpFine).fill(0).map((_, i) => {
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

    static init = async () => new Promise<BlurayDecoder>(async resolve => {
        const { supported } = await VideoDecoder.isConfigSupported(config);
        if (!supported) throw new Error('codec not supported');

        self.onmessage = async e => {
            const { dirHandle, idx, time } = e.data;
        
            const filename = idx.toString().padStart(5, '0');
            const clipInfoHandle = await getPathHandle(dirHandle, `BDMV/CLIPINF/${filename}.clpi`);
            const clipInfoFile = await clipInfoHandle.getFile();
            const clipInfoBuf = await clipInfoFile.arrayBuffer();
            const clpi = this.getClipInfo(clipInfoBuf);
        
            const fh = await getPathHandle(dirHandle, `BDMV/STREAM/${filename}.m2ts`);
            const file = await fh.getFile();

            self.onmessage = null;
            resolve(new this(file, clpi, time));
        
            // const file = await fetch('/local/BDMV/STREAM/00002.m2ts', {
            //     headers: { 'Range': `bytes=0-` }
            // }).then(res => res.blob());
        }
    });

    private constructor(file: File, clpi: ClpiInfo, time?: number) {
        this.file = file;
        this.clpi = clpi;
        this.initialPacketIdx = time ? this.lookupClipSpn(time * 45000) : 0;
    }

    async demux() {
        const decoder = new VideoDecoder({
            output: async function(frame) {
                // @ts-ignore
                self.postMessage({ type: 'video', frame }, [frame]);
            },
            error: function(e) {
                console.error(e);
            },
        });
        decoder.configure(config);
    
        this.loadingStart = performance.now();
        if (this.initialPacketIdx) this.loaded = false;
        for (let gib = Math.floor(this.initialPacketIdx * 192 / GIGABYTE_PACKETS); 
            gib < this.file.size / GIGABYTE_PACKETS; gib++) {
            const end = (gib + 1) * GIGABYTE_PACKETS;
            const buf = await this.file.slice(
                ...[gib * GIGABYTE_PACKETS].concat(end < this.file.size ? end : [])
            ).arrayBuffer();
        
            for (let idx = (this.loaded ? 0 : this.initialPacketIdx % (GIGABYTE_PACKETS / 192)); 
                idx < buf.byteLength / 192; idx++) {
                const packet = new Uint8Array(buf.slice(idx * 192, (idx + 1) * 192));
                if (packet[4] !== 0x47) {
                    console.error('sync byte not present at', idx * 192);
                    decoder.close();
                }
                const pid = ((packet[5] & 0x1F) << 8) | packet[6];
                const pusi = (packet[5] & 0x40) >> 6;
                // console.log('pid:', pid.toString(16).padStart(4, '0').toUpperCase());
        
                const continuityCounter = packet[7] & 0xF;
                const adaptation = (packet[7] & 0x30) >> 5;
                const adaptationSize = adaptation && packet[8] + 1;
                const startCode = pusi && packet[adaptationSize + 8] === 0 && packet[adaptationSize + 9] === 0 && packet[adaptationSize + 10] === 1;
                const payload = packet.slice(8 + adaptationSize + (Number(startCode) && (9 + packet[8 + adaptationSize + 8])));
        
                const timestamp = startCode && packet[adaptationSize + 11] !== 0xBF && (packet[adaptationSize + 15] & 0x80) ? (
                    ((packet[adaptationSize + 17] & 0x0E) << 29) |
                    (packet[adaptationSize + 18] << 22) |
                    ((packet[adaptationSize + 19] & 0xFE) << 14) |
                    (packet[adaptationSize + 20] << 7) |
                    ((packet[adaptationSize + 21] & 0xFE) >> 1)
                ): null;
        
                // if (pid === 4097 && adaptation && (packet[9] & 0x10) >> 4) {
                //     const val = Number((BigInt(new Uint32Array(packet.slice(10, 14).reverse().buffer)[0]) << 1n) | ((BigInt(packet[15]) & 0x80n) >> 7n));
                //     console.log(val);
                // }
    
                if (pid === 0x1200) {
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
                                    entries: Array((buf.byteLength - 5) / 5).fill(0).reduce((map, _, i) => {
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
                                    continue;
                                }
                                
                                if (!((buf[6] & 0x40) >> 6)) {
                                    console.error('not last in sequence');
                                    continue;
                                }
                                
                                const dataLen = ((buf[7] << 16) | (buf[8] << 8) | buf[9]);
                                if (dataLen !== buf.byteLength - 10) {
                                    console.error(`buffer size mismatch: expected ${dataLen}, have ${buf.byteLength - 10}`);
                                    continue;
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
                                        console.error("pixelsDecoded: %lu, width: %u\n", pixelsDecoded, width);
                                        console.error("Incorrect number of pixels\n");
                                        break;
                                    }
                                }
                                
                                const expectedSize = width * height;
                                const actualSize = decodedData.length;
                                
                                if (actualSize < expectedSize) {
                                    console.error("Not enough pixels decoded: %lu < %lu\n", actualSize, expectedSize);
                                    break;
                                } else if (actualSize > expectedSize) {
                                    console.log("Expected %lu pixels, got %lu\n", actualSize, expectedSize);
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
                                if (timestamp)
                                    this.displaySet.timestamp = timestamp;
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
                                    windows: Array(buf[3]).fill(0).map((_, i) => {
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
                    // console.log(startCode, payload);
                }
        
                if (pid === 0x1100) {
                    if (this.audioContinuity === null)
                        this.audioContinuity = continuityCounter - 1;
    
                    if ((this.audioContinuity + 1) % 16 !== continuityCounter) {
                        console.error('Audio continuity error');
                        continue;
                    }
                    this.audioContinuity = continuityCounter;
    
                    if (((timestamp ?? 0) < this.startPts || this.startPts === Infinity) && this.packetSize === null) continue;
                    const header = payload.slice(0, 4);
                    if (startCode && header[0] === 0x05 && header[1] === 0xA0) {
                        if (this.pendingAudio.length) {
                            if (this.packetSize) {
                                console.error('PES packet mismatch');
                                this.pendingAudio.length = 0;
                            } else if (this.streamInfo) {
                                const channels = Array(this.streamInfo.channels).fill(0)
                                    .map(() => new Uint8Array(this.pendingAudio.length / 3 * 4 / this.streamInfo!.channels));
                                this.pendingAudio.forEach((val, i) => {
                                    const channel = channels[Math.floor((i % (3 * channels.length)) / 3)]
                                    const byteCur = Math.floor(i / (3 * channels.length));
                                    const cur = byteCur * 4 + Math.abs(i % 3 - 2) + 1;
                                    if (cur === 1) channel.set([0], byteCur * 4);
                                    channel.set(([val]), cur);
                                });
                                const audio = channels.map(channel => new Float32Array(
                                    [...new Int32Array(channel.buffer)]
                                        .map(val => val < 0 ? -val / MIN_INT : val / MAX_INT)
                                ));
                                self.postMessage({ 
                                    type: 'audio', audio, 
                                    timestamp, ...this.streamInfo
                                });
                                
                                this.pendingAudio.length = 0;
                            }
                        };
                        this.packetSize = (packet[adaptationSize + 12] << 8) | packet[adaptationSize + 13];
                        // console.log('packetSize:', packetSize);
                        
                        const channelLayout = CHANNEL_LAYOUTS[header[2] >> 4];
                        // const bitsPerCodedSample = BITS_PER_SAMPLE[header[3] >> 6];
                        this.streamInfo = {
                            channels: channelLayout?.channels ?? 0,
                            sampleRate: SAMPLE_RATE[header[2] & 0x0f],
                        }
                        // const sampleFormat = bitsPerCodedSample === 16 ? 'S16' : 'S32';
                        // const bitrate = this.streamInfo.channels * bitsPerCodedSample * this.streamInfo.sampleRate;
                        
                        // console.log(`${streamInfo.sampleRate} Hz, ${channelLayout.name.toLowerCase()}, ${sampleFormat.toLowerCase()} (${bitsPerCodedSample} bit), ${bitrate / 1000} kb/s`);
                        this.pendingAudio.push(...payload.slice(4));
                        this.packetSize -= packet.byteLength - adaptationSize - 14;
                    } else {
                        this.pendingAudio.push(...payload);
                        if (this.packetSize !== null)
                            this.packetSize -= payload.byteLength;
                    }
                }
        
                if (pid === 0x1011) {
                    if (this.videoContinuity === null)
                        this.videoContinuity = continuityCounter - 1;
    
                    if ((this.videoContinuity + 1) % 16 !== continuityCounter) {
                        console.error('Video continuity error');
                        continue;
                    }
                    this.videoContinuity = continuityCounter;
                    // if (timestamp)
                    //     console.log(timestamp);
                    const cur = payload.findIndex((val, idx, arr) => val === 0 && arr[idx + 1] === 0 && (
                        (arr[idx + 2] === 1 && arr[idx - 1] !== 0 && (arr[idx + 3] & 0x1F) === 9) ||
                        (arr[idx + 2] === 0 && arr[idx + 3] === 1 && (arr[idx + 4] & 0x1F) === 9)
                    ));
                    
                    if (this.pendingVideo.length && cur > -1) {
                        const newBuf = joinArrayBuffers(this.pendingVideo);
                        
                        const iframe = newBuf.findIndex((val, idx, arr) => val === 0 && arr[idx + 1] === 0 && (
                            (arr[idx + 2] === 1 && arr[idx - 1] !== 0 && (arr[idx + 3] & 0x1F) === 5) ||
                            (arr[idx + 2] === 0 && arr[idx + 3] === 1 && (arr[idx + 4] & 0x1F) === 5)
                        )) > -1;
        
                        if (iframe) {
                            await decoder.flush();
                            // console.log('New keyframe');
                        }
        
                        if (this.loaded || iframe) {
                            if (!this.loaded) this.startPts = timestamp ?? 0;
                            decoder.decode(new EncodedVideoChunk({
                                timestamp: timestamp ?? 0,
                                type: iframe ? 'key' : 'delta',
                                data: newBuf,
                            }));
                            this.loaded = true;
                        }
        
                        this.pendingVideo.length = 0;
                        this.pendingVideo.push(payload);
                    } else this.pendingVideo.push(payload);
                }
            }
        }
        
        console.log(`Loading done in ${(performance.now() - this.loadingStart) / 1000} seconds`);
    }
}

const decoder = await BlurayDecoder.init();
decoder.demux();