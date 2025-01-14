enum VideoFormat {
    FORMAT_480I = 1,
    FORMAT_576I = 2,
    FORMAT_480P = 3,
    FORMAT_1080I = 4,
    FORMAT_720P = 5,
    FORMAT_1080P = 6,
    FORMAT_576P = 7,
    FORMAT_2160P = 8,
}
   
enum VideoRate {
    RATE_24000_1001 = 1,
    RATE_24 = 2,
    RATE_25 = 3,
    RATE_30000_1001 = 4,
    RATE_50 = 6,
    RATE_60000_1001 = 7,
}

enum VideoAspectRatio {
    ASPECT_RATIO_4_3 = 2,
    ASPECT_RATIO_16_9 = 3,
}
   
enum AudioFormat {
    MONO = 1,
    STEREO = 3,
    MULTI_CHANNEL = 6,
    COMBO = 12,
}
   
enum AudioRate {
    RATE_48 = 1,
    RATE_96 = 4,
    RATE_192 = 5,
    RATE_192_COMBO = 12,
    RATE_96_COMBO = 14
}
   
enum CharCode {
    UTF8 = 0x01,
    UTF16BE = 0x02,
    SHIFT_JIS = 0x03,
    EUC_KR = 0x04,
    GB18030_20001 = 0x05,
    CN_GB = 0x06,
    BIG5 = 0x07,
}
   
enum DynamicRangeType {
    SDR = 0,
    HDR10 = 1,
    DOLBY_VISION = 2,
}

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
    codingType: StreamType;
}

interface VideoProgramStream extends ProgramStream {
    format: VideoFormat;
    rate: VideoRate;
    aspect: VideoAspectRatio;
    ocFlag: number;
    crFlag?: number;
    dynamicRangeType?: DynamicRangeType;
    colorSpace?: number;
    hdrPlusFlag?: number;
}

interface AudioProgramStream extends ProgramStream {
    format: AudioFormat;
    rate: AudioRate;
    lang: string;
}

interface SubtitleProgramStream extends ProgramStream {
    lang: string;
}

interface TextProgramStream extends ProgramStream {
    charCode: CharCode;
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

interface StreamMap {
    video: VideoProgramStream[];
    audio: AudioProgramStream[];
    subtitle: SubtitleProgramStream[];
}