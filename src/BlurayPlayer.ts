import BlurayRegister, { isValidRegister, PSR_FLAG, PsrIdx } from './BlurayRegister.js';
import { MAX_SAMPLES } from './consts.js';
import { HdmvInsnGrp, HdmvInsnGrpSet, HdmvInsnSetSystem, HdmvInsnGrpBranch, HdmvInsnGoto, HdmvInsnSet, HdmvInsnPlay, HdmvInsnJump, HdmvInsnCmp } from './enums/HdmvInsn.js';
import { IndexObjectType } from './enums/Index.js';
import { IndexRoot, IndexAppInfo, IndexTitle, indxObjIsHdmv } from './Index.js';
import { byteArrToString, getBit, getPathArrayBuffer, getStreams, StreamType, uoMaskParse } from './utils.js';

export default class BlurayPlayer {
    dirHandle?: FileSystemDirectoryHandle;
    audioSize = 0;
    videoReady = false;
    audioPlaying = false;
    audioSource?: AudioBufferSourceNode;
    timestamp = 0;
    graphicsWorker: Worker;
    decodingWorker: Worker;
    // clpi?: ClpiInfo;
    // resolveClpi?: (value: ClpiInfo | PromiseLike<ClpiInfo>) => void;
    register = new BlurayRegister();
    mobj: MovieObject | null = null;
    indx: IndexRoot | null = null;
    init = false;
    titleIdx = 0;
    cmdIdx = 0;
    playlistIdx: Number | null = null;
    videoEl: HTMLVideoElement;

    constructor(options: BlurayPlayerOptions) {
        // @ts-ignore
        window.register = this.register;
        
        this.videoEl = options.videoEl;
        
        const canvas = document.getElementById(options?.canvasId ?? 'canvas');
        if (!canvas || !(canvas instanceof HTMLCanvasElement))
            throw new Error(`No <canvas> element with id ${options?.canvasId ?? 'canvas'} found`);
        const offscreenCanvas = canvas.transferControlToOffscreen();

        this.graphicsWorker = new Worker(new URL('./BlurayGraphics.js', import.meta.url), { type: 'module' });
        this.graphicsWorker.postMessage({ canvas: offscreenCanvas }, [offscreenCanvas]);

        this.decodingWorker = new Worker(new URL('./BlurayDecoder.js', import.meta.url), { type: 'module' });
        this.decodingWorker.onmessage = async (e: MessageEvent<DecodingMessage>) => {
            switch (e.data.type) {
                case 'clipInfo': {
                    this.init = false;
                    // if (this.resolveClpi)
                    //     this.resolveClpi(e.data.clpi);
                    return;
                }
                case 'video': {
                    if (this.init) return;
                    const { frame } = e.data;
                    this.graphicsWorker.postMessage({ frame }, [frame]);
                    return;
                }
                case 'audio': {
                    if (this.init) return;
                    const { audio } = e.data;
                    this.graphicsWorker.postMessage({ audio }, [audio]);
                    return;
                }
                case 'subtitle': {
                    if (this.init) return;
                    const { displaySet } = e.data;
                    this.graphicsWorker.postMessage({ displaySet }, [displaySet.bitmap]);
                    return;
                }
                case 'decodingComplete': {
                    // this.cmdIdx++;
                    // this.runMovieObjectLoop();
                    return;
                }
            }
        }

        this.graphicsWorker.onmessage = async e => {
        //     if (e.data.videoReady) {
        //         this.videoReady = e.data.videoReady;
                
        //         if (!this.audioPlaying && this.audioSource) {
        //             this.audioPlaying = true;
        //             this.audioSource.start();
        //             this.graphicsWorker.postMessage({ audioStart: true });
        //         }
        //     }
            if (e.data.timestamp && this.timestamp < e.data.timestamp) {
                this.timestamp = e.data.timestamp;
        //         // instance.setCurrentTime((timestamp / 2 - 189000000) / 45000);
            }
        }
    }

    private createStreams() {
        const videoTrack = new MediaStreamTrackGenerator({ kind: 'video' });
        const audioTrack = new MediaStreamTrackGenerator({ kind: 'audio' });
        const mediaStream = new MediaStream([videoTrack, audioTrack]);
        this.videoEl.srcObject = mediaStream;

        return {
            videoWriter: videoTrack.writable, 
            audioWriter: audioTrack.writable,
        }
    }

    private async getMovieObject(): Promise<MovieObject | null> {
        if (!this.dirHandle) return null;
        const mobjBuf = await getPathArrayBuffer(this.dirHandle, 'BDMV/MovieObject.bdmv');
        const buf = new Uint8Array(mobjBuf);
        const dataView = new DataView(mobjBuf);
        const bdHeader: BlurayHeader = {
            tag: byteArrToString(buf, 0, 4),
            ver: byteArrToString(buf, 4, 4),
        };
        if (bdHeader.tag !== 'MOBJ')
            throw new Error('Invalid MovieObject');
        const extensionDataStart = dataView.getUint32(8);
        if (extensionDataStart) console.log('unknown mobj extension data at', extensionDataStart);
        const dataLen = dataView.getUint32(40);
        if (buf.byteLength - 44 < dataLen)
            throw new Error('invalid mobj data length!');
        const objs = Array(dataView.getUint16(48)).fill(0).reduce(([offset, objs]) => {
            const numCmds = dataView.getUint16(offset + 2);
            objs.push({
                resumeIntentionFlag: Boolean((buf[offset] & 0x80) >> 7),
                menuCallMask: Boolean((buf[offset] & 0x40) >> 6),
                titleSearchMask: Boolean((buf[offset] & 0x20) >> 5),
                cmds: [...Array(numCmds).keys()].map(i => {
                    const cmdOffset = offset + 4 + i * 12;
                    return {
                        insn: {
                            opCnt: (buf[cmdOffset] & 0xE0) >> 5,
                            grp: (buf[cmdOffset] & 0x18) >> 3,
                            subGrp: (buf[cmdOffset] & 0x7),
                            immOp1: (buf[cmdOffset + 1] & 0x80) >> 7,
                            immOp2: (buf[cmdOffset + 1] & 0x40) >> 6,
                            branchOpt: (buf[cmdOffset + 1] & 0xF),
                            cmpOpt: (buf[cmdOffset + 2] & 0xF),
                            setOpt: (buf[cmdOffset + 3] & 0x1F),
                        },
                        dst: dataView.getUint32(cmdOffset + 4),
                        src: dataView.getUint32(cmdOffset + 8),
                    };
                }),
            });

            return [offset + 4 + numCmds * 12, objs];
        }, [50, []])[1];
        return { bdHeader, objs };
    }

    private fetchOperand(setStream: boolean, setButtonPage: boolean, imm: boolean, value: number) {
        if (imm) return value;
    
        if (setStream) {
            const flags = value & 0xf000f000;
            const reg0 = value & 0xfff;
            const reg1 = (value >> 16) & 0xfff;

            const val0 = this.register.gprRegister[reg0] & 0x0fff;
            const val1 = this.register.gprRegister[reg1] & 0x0fff;

            return flags | val0 | (val1 << 16);
        } else if (setButtonPage) {
            const flags = value & 0xc0000000;
            const reg0  = value & 0x00000fff;

            const val0  = this.register.gprRegister[reg0] & 0x3fffffff;

            return flags | val0;
        } else {
            if (!isValidRegister(value)) {
                console.error('invalid register');
                return 0;
            }
        
            return (value & PSR_FLAG) ?
                this.register.psrRegister[value & 0x7f] :
                this.register.gprRegister[value];
        }
    
    }

    async playAt(playlistIdx: number, playitemIdx: number, playmarkIdx: number) {
        if (!this.dirHandle) return false;

        const playlist = await this.getPlaylist(playlistIdx);
        if (!playlist) {
            console.error('no playlist found');
            return false;
        }

        const playMark = playmarkIdx >= 0 ? playlist.playMarks[playmarkIdx] : null;
        const playItem = playMark
            ? {}
            : playitemIdx >= 0 
                ? playlist.playItems[playitemIdx] 
                : playlist.playItems[0];
        this.demux({ dirHandle: this.dirHandle, clipId: playItem.clipId, time: 0 });
        return false;
    }

    async runMovieObject() {
        if (!this.mobj) return false;
        const obj = this.mobj.objs[this.titleIdx];
        if (!obj) return false;
        const cmd = obj.cmds[this.cmdIdx];
        if (!cmd) return false;
        
        const setStream = (
            cmd.insn.grp == HdmvInsnGrp.GROUP_SET &&
            cmd.insn.subGrp == HdmvInsnGrpSet.SETSYSTEM && (
                cmd.insn.setOpt == HdmvInsnSetSystem.SET_STREAM ||
                cmd.insn.setOpt == HdmvInsnSetSystem.SET_SEC_STREAM
            )
        );

        const setButtonPage = (
            cmd.insn.grp == HdmvInsnGrp.GROUP_SET &&
            cmd.insn.subGrp == HdmvInsnGrpSet.SETSYSTEM &&
            cmd.insn.setOpt == HdmvInsnSetSystem.SET_BUTTON_PAGE
        );

        let dst = cmd.insn.opCnt > 0 ? 
            this.fetchOperand(setStream, setButtonPage, Boolean(cmd.insn.immOp1), cmd.dst) : 0;

        let src = cmd.insn.opCnt > 1 ? 
            this.fetchOperand(setStream, setButtonPage, Boolean(cmd.insn.immOp2), cmd.src) : 0;

        switch (cmd.insn.grp) {
            case HdmvInsnGrp.GROUP_BRANCH:
                switch (cmd.insn.subGrp) {
                    case HdmvInsnGrpBranch.GOTO:
                        if (cmd.insn.opCnt > 1)
                            console.error('too many operands in BRANCH/GOTO');
                        switch (cmd.insn.branchOpt) {
                            case HdmvInsnGoto.NOP:
                                break;
                            case HdmvInsnGoto.GOTO:
                                this.cmdIdx = cmd.dst - 1;
                                break;
                            // case HdmvInsnGoto.BREAK: p->pc   = 1 << 17; break;
                            default:
                                console.error('unknown BRANCH/GOTO option');
                                break;
                        }
                        break;
                    case HdmvInsnGrpBranch.JUMP:
                        if (cmd.insn.opCnt > 1) {
                            console.error('too many operands in BRANCH/JUMP');
                            break;
                        }
                        switch (cmd.insn.branchOpt) {
                            case HdmvInsnJump.JUMP_TITLE: {
                                if (!this.indx) {
                                    console.error('no index to jump title!');
                                    return false;
                                }
                                console.log('jump title:', dst);
                                const title = this.indx.titles[dst - 1];
                                if (indxObjIsHdmv(title)) {
                                    this.titleIdx = title.idRef;
                                    this.cmdIdx = 0;
                                    return true;
                                } else {
                                    console.error('jump title to bdj is not supported, aborting... ');
                                    return false;
                                }
                            }
            //                 case INSN_CALL_TITLE:  _call_title(p, dst); break;
            //                 case INSN_RESUME:      _resume_object(p, 1);   break;
            //                 case INSN_JUMP_OBJECT: if (!_jump_object(p, dst)) { inc_pc = 0; } break;
            //                 case INSN_CALL_OBJECT: if (!_call_object(p, dst)) { inc_pc = 0; } break;
                            default:
                                console.error('unknown BRANCH/JUMP option');
                                break;
                        }
                        break;
                    case HdmvInsnGrpBranch.PLAY:
                        switch (cmd.insn.branchOpt) {
                            case HdmvInsnPlay.PLAY_PL:
                                return this.playAt(dst,  -1,  -1);
                            case HdmvInsnPlay.PLAY_PL_PI:
                                return this.playAt(dst, src,  -1);
                            case HdmvInsnPlay.PLAY_PL_PM:
                                return this.playAt(dst,  -1, src);
            //                 case INSN_LINK_PI:      _link_at(p,      dst,  -1); break;
            //                 case INSN_LINK_MK:      _link_at(p,       -1, dst); break;
            //                 case INSN_TERMINATE_PL: if (!_play_stop(p)) { inc_pc = 0; } break;
                            default:
                                console.error('unknown BRANCH/PLAY option')
                                break;
                        }
                        break;
    
                    default:
                        console.error('unknown BRANCH subgroup');
                        break;
                }
                break; /* INSN_GROUP_BRANCH */
    
            case HdmvInsnGrp.GROUP_CMP:
                if (cmd.insn.opCnt  < 2) 
                    console.error('missing operand in BRANCH/JUMP');
                switch (cmd.insn.cmpOpt) {
                    case HdmvInsnCmp.BC: this.cmdIdx += Number(!!(dst & ~src)); break;
                    case HdmvInsnCmp.EQ: this.cmdIdx += Number(!(dst == src)); break;
                    case HdmvInsnCmp.NE: this.cmdIdx += Number(!(dst != src)); break;
                    case HdmvInsnCmp.GE: this.cmdIdx += Number(!(dst >= src)); break;
                    case HdmvInsnCmp.GT: this.cmdIdx += Number(!(dst >  src)); break;
                    case HdmvInsnCmp.LE: this.cmdIdx += Number(!(dst <= src)); break;
                    case HdmvInsnCmp.LT: this.cmdIdx += Number(!(dst <  src)); break;
                    default:
                        console.error('unknown COMPARE option');
                        break;
                }
                break; /* INSN_GROUP_CMP */
    
            case HdmvInsnGrp.GROUP_SET:
                switch (cmd.insn.subGrp) {
                    case HdmvInsnGrpSet.SET: {
                        const src0 = src;
                        const dst0 = dst;

                        if (cmd.insn.opCnt < 2)
                            console.error('missing operand in SET/SET');
                        switch (cmd.insn.setOpt) {
                            case HdmvInsnSet.MOVE:
                                dst = src;
                                break;
            //                 case INSN_SWAP:   SWAP_u32(src, dst);   break;
            //                 case INSN_SUB:    dst  = dst > src ? dst - src :          0; break;
            //                 case INSN_DIV:    dst  = src > 0   ? dst / src : 0xffffffff; break;
            //                 case INSN_MOD:    dst  = src > 0   ? dst % src : 0xffffffff; break;
            //                 case INSN_ADD:    dst  = ADD_u32(src, dst);  break;
            //                 case INSN_MUL:    dst  = MUL_u32(dst, src);  break;
            //                 case INSN_RND:    dst  = RAND_u32(p, src);   break;
            //                 case INSN_AND:    dst &= src;         break;
            //                 case INSN_OR:     dst |= src;         break;
            //                 case INSN_XOR:    dst ^= src;         break;
            //                 case INSN_BITSET: dst |=  (1 << src); break;
            //                 case INSN_BITCLR: dst &= ~(1 << src); break;
            //                 case INSN_SHL:    dst <<= src;        break;
            //                 case INSN_SHR:    dst >>= src;        break;
                            default:
                                console.error('unknown SET option');
                                break;
                        }
    
                        /* store result(s) */
                        if (dst != dst0 || src != src0) {
                            /* store result to destination register(s) */
                            if (dst != dst0) {
                                if (cmd.insn.immOp1) {
                                    console.error('storing to imm !');
                                    return false;
                                }

                                if (!isValidRegister(cmd.dst)) {
                                    console.error('invalid register');
                                    return false;
                                }

                                if (cmd.dst & PSR_FLAG) {
                                    console.error('storing to PSR is not allowed');
                                    return false;
                                }

                                this.register.gprRegister[cmd.dst] = dst;
                            }

                            if (src != src0) {
                                if (cmd.insn.immOp1) {
                                    console.error('storing to imm !');
                                    return false;
                                }

                                if (!isValidRegister(cmd.src)) {
                                    console.error('invalid register');
                                    return false;
                                }

                                if (cmd.src & PSR_FLAG) {
                                    console.error('storing to PSR is not allowed');
                                    return false;
                                }

                                this.register.gprRegister[cmd.src] = src;
                            }
                        }
                        break;
                    }
                    case HdmvInsnGrpSet.SETSYSTEM:
                        switch (cmd.insn.setOpt) {
                            case HdmvInsnSetSystem.SET_STREAM:
                                /* primary audio stream */
                                if (dst & 0x80000000)
                                    this.register.psrRegister[PsrIdx.PSR_PRIMARY_AUDIO_ID] = (dst >> 16) & 0xfff;

                                /* IG stream */
                                if (src & 0x80000000)
                                    this.register.psrRegister[PsrIdx.PSR_IG_STREAM_ID] = (src >> 16) & 0xff;

                                /* angle number */
                                if (src & 0x8000)
                                    this.register.psrRegister[PsrIdx.PSR_ANGLE_NUMBER] = src & 0xff;

                                /* PSR2 */
                                let psr2 = this.register.psrRegister[PsrIdx.PSR_PG_STREAM];

                                /* PG TextST stream number */
                                if (dst & 0x8000)
                                    psr2 = (dst & 0xfff) | (psr2 & 0xfffff000);

                                /* Update PG TextST stream display flag */
                                psr2 = ((dst & 0x4000) << 17) | (psr2 & 0x7fffffff);

                                this.register.psrRegister[PsrIdx.PSR_PG_STREAM] = psr2;
                                break;
            //                 case INSN_SET_SEC_STREAM:  _set_sec_stream (p, dst, src); break;
            //                 case INSN_SET_NV_TIMER:    _set_nv_timer   (p, dst, src); break;
            //                 case INSN_SET_BUTTON_PAGE: _set_button_page(p, dst, src); break;
            //                 case INSN_ENABLE_BUTTON:   _enable_button  (p, dst,   1); break;
            //                 case INSN_DISABLE_BUTTON:  _enable_button  (p, dst,   0); break;
            //                 case INSN_POPUP_OFF:       _popup_off      (p);           break;
            //                 case INSN_STILL_ON:        _set_still_mode (p,   1);      break;
            //                 case INSN_STILL_OFF:       _set_still_mode (p,   0);      break;
            //                 case INSN_SET_OUTPUT_MODE: _set_output_mode(p, dst);      break;
            //                 case INSN_SET_STREAM_SS:   _set_stream_ss  (p, dst, src); break;
            //                 case INSN_SETSYSTEM_0x10:  _setsystem_0x10 (p, dst, src); break;
                            default:
                                console.error('unknown SETSYSTEM option');
                                break;
                        }
                        break;
                    default:
                        console.error('unknown SET subgroup');
                        break;
                }
                break; /* INSN_GROUP_SET */
    
            default:
                console.error('unknown operation group');
                break;
        }

        this.cmdIdx++;
        return true;
    }

    async getPlaylist(idx: number) {
        if (!this.dirHandle) return;

        const playlistNum = idx.toString().padStart(5, '0');
        const playlistBuf = await getPathArrayBuffer(this.dirHandle, `BDMV/PLAYLIST/${playlistNum}.mpls`);
        const buf = new Uint8Array(playlistBuf);
        const dataView = new DataView(playlistBuf);
        const bdHeader: BlurayHeader = {
            tag: byteArrToString(buf, 0, 4),
            ver: byteArrToString(buf, 4, 4),
        };
        if (bdHeader.tag !== 'MPLS')
            throw new Error('Invalid playlist');

        const listPos = dataView.getUint32(8);
        const markPos = dataView.getUint32(12);
        const extPos = dataView.getUint32(16);

        // const len = dataView.getUint32(40);
        const headerIdx = 45;
        const playlistHeader = {
            playbackType: buf[headerIdx],
            playbackCount: (buf[headerIdx] === 2 || buf[headerIdx] === 3) ? dataView.getUint16(headerIdx + 1) : 0,
            uoMask: uoMaskParse(buf.slice(headerIdx + 3, headerIdx + 7)),
            randomAccessFlag: Boolean(getBit(buf[headerIdx + 7], 7)),
            audioMixFlag: Boolean(getBit(buf[headerIdx + 7], 6)),
            losslessBypassFlag: Boolean(getBit(buf[headerIdx + 7], 5)),
            mvcBaseViewFlag: Boolean(getBit(buf[headerIdx + 7], 4)),
            sdrConversionNotificationFlag: Boolean(getBit(buf[headerIdx + 7], 3)),
        };
        
        // const len = dataView.getUint32(listPos);
        const [playItemsLen, playItems] = Array(dataView.getUint16(listPos + 6)).fill(0).reduce(([offset, playItems]) => {
            const codecId = byteArrToString(buf, offset + 7, 4);
            if (codecId !== 'M2TS' && codecId !== 'FMTS')
                console.error('Incorrect CodecIdentifier', codecId);
            const isMultiAngle = Boolean(getBit(buf[offset + 12], 4));
            const connectionCondition = buf[offset + 12] & 0x0F;
            if (![0x01, 0x05, 0x06].includes(connectionCondition))
                console.error('Unexpected connection condition');
            const angleCount = (isMultiAngle && buf[offset + 30] > 1) ? buf[offset + 30] : 1;

            const stnIdx = offset + 34 + Number(isMultiAngle) * 3;

            const parseStream = function([offset, streams]: [number, any[]]) {
                const streamType = buf[offset + 1];
                const streamInfo: {
                    pid: number;
                    subpathId?: number;
                    subclipId?: number;
                } = { pid: 0 };
                switch (streamType) {
                    case 1:
                        streamInfo.pid = dataView.getUint16(offset + 2);
                        break;
            
                    case 2:
                        streamInfo.subpathId = buf[offset + 2];
                        streamInfo.subclipId = buf[offset + 3];
                        streamInfo.pid       = dataView.getUint16(offset + 4);
                        break;
            
                    case 3:
                    case 4:
                        streamInfo.subpathId = buf[offset + 2];
                        streamInfo.pid       = dataView.getUint16(offset + 3);
                        break;
            
                    default:
                        console.error('unrecognized stream type');
                        break;
                };            
                const dataOffset = offset + buf[offset] + 1;
                const codingType = buf[dataOffset + 1];
                switch (codingType) {
                    case StreamType.VIDEO_MPEG1:
                    case StreamType.VIDEO_MPEG2:
                    case StreamType.VIDEO_VC1:
                    case StreamType.VIDEO_H264:
                    case StreamType.VIDEO_HEVC:
                        streams.push({
                            ...streamInfo,
                            codingType,
                            format: (buf[dataOffset + 2] & 0xF0) >> 4,
                            rate: buf[dataOffset + 2] & 0x0F,
                            ...(codingType === StreamType.VIDEO_HEVC ? {
                                dynamicRangeType: (buf[dataOffset + 3] & 0xF0) >> 4,
                                colorSpace: buf[dataOffset + 3] & 0x0F,
                                crFlag: Boolean(getBit(buf[dataOffset + 4], 7)),
                                hdrPlusFlag: Boolean(getBit(buf[dataOffset + 4], 6)),
                            } : {})
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
                        streams.push({
                            ...streamInfo,
                            codingType,
                            format: (buf[dataOffset + 2] & 0xF0) >> 4,
                            rate: buf[dataOffset + 2] & 0x0F,
                            lang: byteArrToString(buf, dataOffset + 3, 3),
                        });
                        break;
            
                    case StreamType.SUB_PG:
                    case StreamType.SUB_IG:
                        streams.push({
                            ...streamInfo,
                            codingType,
                            lang: byteArrToString(buf, dataOffset + 2, 3),
                        });
                        break;
            
                    case StreamType.SUB_TEXT:
                        streams.push({
                            ...streamInfo,
                            codingType,
                            charCode: buf[dataOffset + 2],
                            lang: byteArrToString(buf, dataOffset + 3, 3),
                        });
                        break;
            
                    default:
                        console.error('unrecognized coding type');
                        break;
                };
            
                return [dataOffset + buf[dataOffset] + 1, streams];
            }

            const [videoLen, videoStreams] = Array(buf[stnIdx + 4]).fill(0)
                .reduce(parseStream, [stnIdx + 16, []]);
            const [audioLen, audioStreams] = Array(buf[stnIdx + 5]).fill(0)
                .reduce(parseStream, [videoLen, []]);
            const [pgLen, pgStreams] = Array(buf[stnIdx + 6]).fill(0)
                .reduce(parseStream, [audioLen, []]);
            const [igLen, igStreams] = Array(buf[stnIdx + 7]).fill(0)
                .reduce(parseStream, [pgLen, []]);
            const [secondaryAudioLen, secondaryAudioStreams] = Array(buf[stnIdx + 8]).fill(0)
                .reduce(parseStream, [igLen, []]);
            const [secondaryVideoLen, secondaryVideoStreams] = Array(buf[stnIdx + 9]).fill(0)
                .reduce(parseStream, [secondaryAudioLen, []]);
            const [pipPgLen, pipPgStreams] = Array(buf[stnIdx + 10]).fill(0)
                .reduce(parseStream, [secondaryVideoLen, []]);
            const [_, dvStreams] = Array(buf[stnIdx + 11]).fill(0)
                .reduce(parseStream, [pipPgLen, []]);

            const stn = {
                video: videoStreams,
                audio: audioStreams,
                pg: pgStreams,
                ig: igStreams,
                secondaryAudio: secondaryAudioStreams,
                secondaryVideo: secondaryVideoStreams,
                pipPg: pipPgStreams,
                dv: dvStreams,
            };

            playItems.push({
                clipId: byteArrToString(buf, offset + 2, 5),
                codecId,
                isMultiAngle,
                connectionCondition,
                stcId: buf[offset + 13],
                inTime: dataView.getUint32(offset + 14),
                outTime: dataView.getUint32(offset + 18),
                uoMask: uoMaskParse(buf.slice(offset + 18, offset + 26)),
                privateAccessFlag: Boolean(getBit(buf[offset + 26], 7)),
                stillMode: buf[offset + 27],
                stillTime: buf[offset + 27] === 0x01 ? dataView.getUint16(offset + 28) : 0,
                // angleCount,
                isDifferentAngle: isMultiAngle && Boolean(getBit(buf[offset + 31], 1)),
                isSeamlessAngle: isMultiAngle && Boolean(getBit(buf[offset + 31], 0)),
                // TODO: Multi-angle clips
                stn,
            });
            return [offset + dataView.getUint16(offset) + 2, playItems];
        }, [listPos + 10, []]);

        const subPaths = Array(dataView.getUint16(listPos + 8)).fill(0).reduce(([offset, subPaths]) => {
            subPaths.push({
                type: buf[offset + 5],
                isRepeat: getBit(buf[offset + 7], 0),
                subPlayItem: Array(buf[offset + 9]).fill(0).reduce(([offset, subPlayItems]) => {
                    const codecId = byteArrToString(buf, offset + 7, 4);
                    if (codecId !== 'M2TS' && codecId !== 'FMTS')
                        console.error('Incorrect CodecIdentifier', codecId);
                    const connectionCondition = (buf[offset + 14] & 0x1E) >> 1;
                    if (![0x01, 0x05, 0x06].includes(connectionCondition))
                        console.error('Unexpected connection condition');
                    const isMultiClip = Boolean(getBit(buf[offset + 14], 0));
                    const clipCount = (isMultiClip && buf[offset + 30] > 1) ? buf[offset + 30] : 1;
                    subPlayItems.push({
                        clipId: byteArrToString(buf, offset + 2, 5),
                        codecId,
                        connectionCondition,
                        isMultiClip,
                        stcId: buf[offset + 15],
                        inTime: dataView.getUint32(offset + 16),
                        outTime: dataView.getUint32(offset + 20),
                        syncPlayItemId: dataView.getUint16(offset + 24),
                        syncPts: dataView.getUint32(offset + 26),
                        // clipCount,
                        // TODO: Multi clips
                    });
                    return [offset + dataView.getUint16(offset), subPlayItems];
                }, [offset + 10, []])[1],
            });
            return [offset + dataView.getUint32(offset), subPaths];
        }, [playItemsLen, []])[1];

        // const len = dataView.getUint32(markPos);
        const playMarks = [...Array(dataView.getUint16(markPos + 4)).keys()].map(i => {
            const playMarkIdx = markPos + 6 + i * 14;
            return {
                markType: buf[playMarkIdx + 1],
                playItemRef: dataView.getUint16(playMarkIdx + 2),
                time: dataView.getUint32(playMarkIdx + 4),
                entryEsPid: dataView.getUint16(playMarkIdx + 8),
                duration: dataView.getUint32(playMarkIdx + 10),
            };
        });

        // TODO: Parse mpls ext data

        return { playlistHeader, playItems, subPaths, playMarks };
    }

    async getIndex(): Promise<IndexRoot | null> {
        if (!this.dirHandle) return null;
        const idxBuf = await getPathArrayBuffer(this.dirHandle, 'BDMV/index.bdmv');
        const buf = new Uint8Array(idxBuf);
        const dataView = new DataView(idxBuf);
        const bdHeader: BlurayHeader = {
            tag: byteArrToString(buf, 0, 4),
            ver: byteArrToString(buf, 4, 4),
        };
        if (bdHeader.tag !== 'INDX')
            throw new Error('Invalid index');
        const indexStart = dataView.getUint32(8);
        const extensionStart = dataView.getUint32(12);
        
        const len = dataView.getUint32(40);
        if (len != 34) console.error(`index.bdmv app_info length is ${len}, expected 34!`);

        const appInfo: IndexAppInfo = {
            initialOutputModePreference: getBit(buf[44], 6),
            contentExistFlag: Boolean(getBit(buf[44], 5)),
            initialDynamicRangeType: buf[44] & 0x0F,
            videoFormat: (buf[45] & 0xF0) >> 4,
            frameRate: buf[45] & 0x0F,
            userData: dataView.getUint32(46),
        }

        const indexLen = dataView.getUint32(indexStart);

        const parseObject = function(idx: number): IndexTitle{
            const objectType = (buf[idx] & 0xC0) >> 6;
            return {
                objectType,
                playbackType: (buf[idx + 4] & 0xC0) >> 6,
                ...(objectType === IndexObjectType.HDMV ? {
                    idRef: dataView.getUint16(idx + 6)
                } : {
                    name: byteArrToString(buf, idx + 6, 5)
                }),
            }
        }

        const firstPlay = parseObject(indexStart + 4);
        const topMenu = parseObject(indexStart + 16);

        const titles = [...Array(dataView.getUint16(indexStart + 28)).keys()]
            .map(i => parseObject(indexStart + 30 + i * 12));

        // TODO: Parse UHD extension

        return { appInfo, firstPlay, topMenu, titles };
    }

    async runMovieObjectLoop() {
        let continueObj = true;
        do {
            continueObj = await this.runMovieObject();
        } while (continueObj);
    }

    async openBlurayDirectory(dirHandle: FileSystemDirectoryHandle) {
        this.dirHandle = dirHandle;
        this.mobj = await this.getMovieObject();
        this.indx = await this.getIndex();
        if (!this.indx || !this.mobj) return;

        if (this.indx.firstPlay) {
            if (indxObjIsHdmv(this.indx.firstPlay))
                this.titleIdx = this.indx.firstPlay.idRef;
            else {
                console.error('bdj not yet supported. aborting...');
                return;
            }
        } else {
            if (indxObjIsHdmv(this.indx.titles[0]))
                this.titleIdx = this.indx.titles[0].idRef;
            else {
                console.error('bdj not yet supported. aborting...');
                return;
            }
        }

        this.demux({ dirHandle, clipId: '00020', time: 0 });

        // this.runMovieObjectLoop();
    }

    test() {
        if (!this.dirHandle) return;
        // this.demux({ dirHandle: this.dirHandle, clipId: '00020', time: 30 });
    }

    demux(options: DemuxOptions) {
        this.init = true;
        this.decodingWorker.postMessage(options);
        const { videoWriter, audioWriter } = this.createStreams();
        this.graphicsWorker.postMessage({ videoWriter, audioWriter }, [videoWriter, audioWriter]);
    }
}