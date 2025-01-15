import { BdjPlaybackType, HdmvPlaybackType, IndexObjectType } from "./enums/Index.js";

export interface IndexAppInfo {
    initialOutputModePreference: number; /* 0 - 2D, 1 - 3D */
    contentExistFlag: boolean;
    initialDynamicRangeType: number;
    videoFormat: number;
    frameRate: number;
    userData: number;
}

export interface IndexPlayItemBdj {
    objectType: IndexObjectType.BDJ;
    playbackType: BdjPlaybackType;
    name: string;
}

export interface IndexPlayItemHdmv {
    objectType: IndexObjectType.HDMV;
    playbackType: HdmvPlaybackType;
    idRef: number;
}

export interface IndexTitle {
    objectType: IndexObjectType;
    accessType?: number;
    playbackType: number;
}

export interface IndexRoot {
    appInfo: IndexAppInfo;
    firstPlay: IndexTitle | null;
    topMenu: IndexTitle | null;
    titles: IndexTitle[];
}

export const indxObjIsBdj = (obj: IndexTitle): obj is IndexPlayItemBdj => obj.objectType === IndexObjectType.BDJ;
export const indxObjIsHdmv = (obj: IndexTitle): obj is IndexPlayItemHdmv => obj.objectType === IndexObjectType.HDMV;