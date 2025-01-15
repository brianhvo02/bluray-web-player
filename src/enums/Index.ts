export enum IndexObjectType {
    HDMV = 1,
    BDJ = 2,
}

export enum IndexVideoFormat {
    VIDEO_FORMAT_IGNORED,
    VIDEO_480i,
    VIDEO_576i,
    VIDEO_480p,
    VIDEO_1080i,
    VIDEO_720p,
    VIDEO_1080p,
    VIDEO_576p,
}

export enum IndexFrameRate {
    FPS_RESERVED_1,
    FPS_23_976,
    FPS_24,
    FPS_25,
    FPS_29_97,
    FPS_RESERVED_2,
    FPS_50,
    FPS_59_94,
}

export enum HdmvPlaybackType {
    MOVIE       = 0,
    INTERACTIVE = 1,
}

export enum BdjPlaybackType {
    MOVIE       = 2,
    INTERACTIVE = 3,
}