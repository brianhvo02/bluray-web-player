import BlurayRegister, { isValidRegister, PSR_FLAG } from './BlurayRegister.js';
import { MAX_SAMPLES } from './consts.js';
import { HdmvInsnGrp, HdmvInsnGrpSet, HdmvInsnSetSystem, HdmvInsnGrpBranch, HdmvInsnGoto, HdmvInsnSet } from './HdmvInsn.js';
import { byteArrToString, getPathArrayBuffer, getStreams } from './utils.js';

export default class BlurayPlayer {
    audioSize = 0;
    videoReady = false;
    audioPlaying = false;
    audioSource?: AudioBufferSourceNode;
    timestamp = 0;
    graphicsWorker: Worker;
    decodingWorker: Worker;
    clpi?: ClpiInfo;
    resolveClpi?: (value: ClpiInfo | PromiseLike<ClpiInfo>) => void;
    register = new BlurayRegister();
    mobj: MovieObject | null = null;
    titleIdx = 0;
    cmdIdx = 0;
    playlistIdx: Number | null = null;

    constructor(options?: BlurayPlayerOptions) {
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
                    if (this.resolveClpi)
                        this.resolveClpi(e.data.clpi);
                    return;
                }
                case 'video': {
                    const { frame } = e.data;
                    this.graphicsWorker.postMessage({ frame }, [frame]);
                    return;
                }
                case 'audio': {
                    const { channels, sampleRate, audio } = e.data;
                    if (!this.audioSource) {
                        const audioCtx = new AudioContext();
                        const audioBuffer = audioCtx.createBuffer(channels, MAX_SAMPLES, sampleRate);
                        this.audioSource = audioCtx.createBufferSource();
                        this.audioSource.buffer = audioBuffer;
                        this.audioSource.connect(audioCtx.destination);
                    }
                    if (this.videoReady && !this.audioPlaying) {
                        this.audioPlaying = true;
                        this.audioSource.start();
                        this.graphicsWorker.postMessage({ audioStart: true });
                    }
                    
                    audio.forEach((newBuf, channel) => this.audioSource?.buffer?.copyToChannel(newBuf, channel, this.audioSize));
                    this.audioSize += audio[0].length;
                    return;
                }
                case 'subtitle': {
                    const { displaySet } = e.data;
                    this.graphicsWorker.postMessage({ displaySet }, [displaySet.bitmap]);
                    return;
                }
            }
        }

        this.graphicsWorker.onmessage = async e => {
            if (e.data.videoReady) {
                this.videoReady = e.data.videoReady;
                
                if (!this.audioPlaying && this.audioSource) {
                    this.audioPlaying = true;
                    this.audioSource.start();
                    this.graphicsWorker.postMessage({ audioStart: true });
                }
            }
            if (e.data.timestamp && this.timestamp < e.data.timestamp) {
                this.timestamp = e.data.timestamp;
                // instance.setCurrentTime((timestamp / 2 - 189000000) / 45000);
            }
        }
    }

    static getMovieObject(buf: Uint8Array) {
        const dataView = new DataView(buf.buffer);
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

    fetchOperand(setStream: boolean, setButtonPage: boolean, imm: boolean, value: number) {
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

    runMovieObject() {
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
            //                 case INSN_JUMP_TITLE:  _jump_title(p, dst); break;
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
            //                 case INSN_PLAY_PL:      _play_at(p, dst,  -1,  -1); break;
            //                 case INSN_PLAY_PL_PI:   _play_at(p, dst, src,  -1); break;
            //                 case INSN_PLAY_PL_PM:   _play_at(p, dst,  -1, src); break;
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
            //         case INSN_BC: p->pc += !!(dst & ~src); break;
            //         case INSN_EQ: p->pc += !(dst == src); break;
            //         case INSN_NE: p->pc += !(dst != src); break;
            //         case INSN_GE: p->pc += !(dst >= src); break;
            //         case INSN_GT: p->pc += !(dst >  src); break;
            //         case INSN_LE: p->pc += !(dst <= src); break;
            //         case INSN_LT: p->pc += !(dst <  src); break;
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
            //                 case INSN_SET_STREAM:      _set_stream     (p, dst, src); break;
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

    async openBlurayDirectory(dirHandle: FileSystemDirectoryHandle) {
        // this.decodingWorker.postMessage({ dirHandle });
        // this.clpi = await new Promise<ClpiInfo>(resolve => {
        //     this.resolveClpi = resolve;
        // });

        const mobjBuf = await getPathArrayBuffer(dirHandle, 'BDMV/MovieObject.bdmv');
        this.mobj = BlurayPlayer.getMovieObject(new Uint8Array(mobjBuf));
        this.runMovieObject();
        
        // return getStreams(this.clpi);
    }

    demux(options?: DemuxOptions) {
        this.decodingWorker.postMessage({ demux: true, ...options });
    }
}