import { GIGABYTE_PACKETS, MIN_INT, MAX_INT, CHANNEL_LAYOUTS, BITS_PER_SAMPLE, SAMPLE_RATE } from './consts.js';
import { byteArrToString, convertToRgb, getClipInfo, getPathArrayBuffer, getPathHandle, getStreams, joinArrayBuffers, StreamType } from './utils.js';

const config: VideoDecoderConfig = {
    codec: 'avc1.640829',
    codedWidth: 1920,
    codedHeight: 1080,
}

let flag = true;

class BlurayDecoder {
    file: File;
    clpi: ClpiInfo;
    time: number;
    initialPacketIdx: number;
    private videoContinuity: number | null = null;
    private audioContinuity: number | null = null;
    private prevVideoTimestamp: number | null = null;
    private prevAudioTimestamp: number | null = null;
    private pendingVideo: Uint8Array[] = [];
    private pendingAudio: Uint8Array[] = [];
    private pendingPg: Uint8Array[] = [];
    private audioPacketSize: number | null = null;
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

    lookupClipSpn(timestamp: number) {
        const { presentationStartTime, presentationEndTime } = this.clpi.sequenceInfo.atcSeq[0].stcSeq[0];
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
    
        const { spnEp, refEpFineId, ptsEp } = entry.coarse[i];
        const fine = entry.fine[refEpFineId + fineIdx];
        return {
            packet: (spnEp & ~0x1FFFF) + fine.spnEp,
            pts: ((ptsEp & ~0x01) << 18) + (fine.ptsEp << 8),
        };
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
        const { packet, pts } = time ? this.lookupClipSpn(time * 45000) : { packet: 0, pts: 0 };
        this.initialPacketIdx = packet;
        this.time = pts * 2;
        self.postMessage({ type: 'startTime', startTime: (pts - this.clpi.sequenceInfo.atcSeq[0].stcSeq[0].presentationStartTime) / 45000 });
        this.buffersLoaded = new Promise<void>(async resolve => {
            for (let i = 0; i < Math.ceil(this.file.size / (GIGABYTE_PACKETS * 192)); i++) {
                if (i < Math.floor(packet / GIGABYTE_PACKETS)) {
                    this.buffers.push(new Promise(resolve => resolve(new ArrayBuffer())));
                    continue;
                }
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
                    const baseTs = this.time || this.clpi.sequenceInfo.atcSeq[0].stcSeq[0].presentationStartTime * 2;
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

        if ((this.audioContinuity + 1) % 16 !== continuityCounter)
            console.error('Audio continuity error');
            
        this.audioContinuity = continuityCounter;

        // if (this.audioPacketSize === null && startCode && !continuityCounter)
        //     this.audioPacketSize = newPacketSize;
        if (startCode && this.prevAudioTimestamp === null)
            this.prevAudioTimestamp = timestamp;
        if ((this.prevAudioTimestamp ?? 0) <= this.time && !startCode)
            return;
        if (startCode && payload[0] === 0x05 && payload[1] === 0xA0) {
            if (this.pendingAudio.length > 1) {
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

                const baseTs = this.time || this.clpi.sequenceInfo.atcSeq[0].stcSeq[0].presentationStartTime * 2;
                const audio = new AudioData({
                    format: 's32',
                    sampleRate,
                    numberOfFrames: data.byteLength / 4 / numberOfChannels,
                    numberOfChannels,
                    timestamp: ((this.prevAudioTimestamp ?? baseTs) - baseTs) / 90 * 1000,
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
        } else if (this.audioPacketSize !== null) {
            this.pendingAudio.push(payload);
            this.audioPacketSize -= payload.byteLength;
        }
    }

    private async decodeVideoBuf(lastFrame = false) {
        const baseTs = this.time || this.clpi.sequenceInfo.atcSeq[0].stcSeq[0].presentationStartTime * 2;
        const newBuf = joinArrayBuffers(this.pendingVideo);

        const iframeIdx = newBuf.findIndex((val, idx, arr) => val === 0 && arr[idx + 1] === 0 && (
            (arr[idx + 2] === 1 && arr[idx - 1] !== 0 && (arr[idx + 3] & 0x1F) === 5) ||
            (arr[idx + 2] === 0 && arr[idx + 3] === 1 && (arr[idx + 4] & 0x1F) === 5)
        ));
        const iframe = iframeIdx > -1;

        const decoder = this.getDecoder();
        if (this.newDecoder && !iframe) return true;
        else this.newDecoder = false;
        
        try {
            if (iframe || lastFrame) await decoder.flush();
            decoder.decode(new EncodedVideoChunk({
                timestamp: ((this.prevVideoTimestamp ?? baseTs) - baseTs) / 90 * 1000,
                type: iframe ? 'key' : 'delta',
                data: newBuf,
            }));
            return true;
        } catch(e) {
            console.error(e);
            return false;
        }
    }

    private async decodeVideoPacket(packet: Uint8Array) {
        if (packet.byteLength === 0)
            return this.decodeVideoBuf(true);
        
        const { startCode, timestamp, continuityCounter, payload } = this.getPacketInfo(packet);
        if (startCode && this.prevVideoTimestamp === null)
            this.prevVideoTimestamp = timestamp;

        if (this.videoContinuity === null)
            this.videoContinuity = continuityCounter - 1;

        if ((this.videoContinuity + 1) % 16 !== continuityCounter)
            console.error('Video continuity error');

        this.videoContinuity = continuityCounter;
        
        if (this.pendingVideo.length && startCode) {
            return await this.decodeVideoBuf()
                .then(res => {
                    this.pendingVideo.length = 0;
                    this.pendingVideo.push(payload);
                    this.prevVideoTimestamp = timestamp;
                    return res;
                });
        } else {
            this.pendingVideo.push(payload);
            return true;
        }
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
                
                if (pid === this.currentVideoPid) {
                    const res = await this.decodeVideoPacket(packet);
                    if (!res) {
                        self.postMessage({ type: 'decodingComplete' });
                        return;
                    }
                }
            }
        }

        // if (this.getDecoder().state !== 'closed')
        //     self.postMessage({ type: 'decodingComplete' });

        const res = await this.decodeVideoPacket(new Uint8Array());
        if (!res) {
            self.postMessage({ type: 'decodingComplete' });
            return;
        }
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
    const { dirHandle, clipId, time } = e.data;
    
    const clpi = await getPathArrayBuffer(dirHandle, `BDMV/CLIPINF/${clipId}.clpi`)
        .then(getClipInfo);

    const fh = await getPathHandle(dirHandle, `BDMV/STREAM/${clipId}.m2ts`);
    const file = await fh.getFile();

    self.postMessage({ type: 'clipInfo', clpi });
    
    decoder = new BlurayDecoder(file, clpi, time);
    demuxer = decoder.demux(e.data);
}