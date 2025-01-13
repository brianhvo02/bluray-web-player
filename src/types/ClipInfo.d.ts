interface BlurayHeader {
    tag: string;
    ver: string;
}

interface ClipTsTypeInfo {
    validity: number;
    formatId: string;
}

interface ClipInfo {
    clipStreamType: number;
    applicationType: number;
    isAtcDelta: boolean;
    tsRecordingRate: number;
    numSourcePackets: number;
    tsTypeInfo?: ClipTsTypeInfo;
}

interface StcSequence {
    pcrPid: number;
    spnStcStart: number;
    presentationStartTime: number;
    presentationEndTime: number;
}

interface AtcSequence {
    spnAtcStart: number;
    offsetStcId: number;
    stcSeq: StcSequence[];
}

interface SequenceInfo {
    atcSeq: AtcSequence[];
}

interface ProgramStream {
    pid: number;
    codingType: number;
}

interface VideoProgramStream extends ProgramStream {
    format: number;
    rate: number;
    aspect: number;
    ocFlag: number;
    crFlag?: number;
    dynamicRangeType?: number;
    colorSpace?: number;
    hdrPlusFlag?: number;
}

interface AudioProgramStream extends ProgramStream {
    format: number;
    rate: number;
    lang: string;
}

interface SubtitleProgramStream extends ProgramStream {
    lang: string;
}

interface Program {
    spnProgramSequenceStart: number;
    programMapPid: number;
    numStreams: number;
    numGroups: number;
    ps: ProgramStream[];
}

interface ProgramInfo {
    prog: Program[];
}

interface CoarseEntry {
    refEpFineId: number;
    ptsEp: number;
    spnEp: number;
}

interface FineEntry {
    isAngleChangePoint: boolean;
    iEndPositionOffset: number;
    ptsEp: number;
    spnEp: number;
}

interface CpiEntry {
    pid: number;
    epStreamType: number;
    coarse: CoarseEntry[];
    fine: FineEntry[];
}

interface CpiInfo {
    type: number;
    numStreamPid: number;
    entries: CpiEntry[];
}

interface ClpiInfo {
    bdHeader: BlurayHeader;
    clipInfo: ClipInfo;
    sequenceInfo: SequenceInfo;
    programInfo: ProgramInfo;
    cpiInfo: CpiInfo;
}