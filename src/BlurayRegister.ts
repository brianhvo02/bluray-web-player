/*
 * Initial values for player status/setting registers (5.8.2).
 *
 * PS in comment indicates player setting -> register can't be changed from movie object code.
 */

import { AudioCapability, OutputPrefer, PlayerProfile, Region, VideoCapability } from './enums/PlayerSettings.js';

export const PSR_FLAG = 0x80000000;
const GPR_COUNT = 4096;
const PSR_COUNT = 128;
const psrInit = new Uint32Array([
    1,           /*     PSR0:  Interactive graphics stream number */
    0xff,        /*     PSR1:  Primary audio stream number */
    0x0fff0fff,  /*     PSR2:  PG TextST stream number and PiP PG stream number*/
    1,           /*     PSR3:  Angle number */
    0xffff,      /*     PSR4:  Title number */
    0xffff,      /*     PSR5:  Chapter number */
    0,           /*     PSR6:  PlayList ID */
    0,           /*     PSR7:  PlayItem ID */
    0,           /*     PSR8:  Presentation time */
    0,           /*     PSR9:  Navigation timer */
    0xffff,      /*     PSR10: Selected button ID */
    0,           /*     PSR11: Page ID */
    0xff,        /*     PSR12: User style number */
    0xff,        /* PS: PSR13: User age */
    0xffff,      /*     PSR14: Secondary audio stream number and secondary video stream number */
                 /* PS: PSR15: player capability for audio */
    AudioCapability.LPCM_48_96_SURROUND |
    AudioCapability.LPCM_192_SURROUND   |
    AudioCapability.DDPLUS_SURROUND     |
    AudioCapability.DDPLUS_DEP_SURROUND |
    AudioCapability.DTSHD_CORE_SURROUND |
    AudioCapability.DTSHD_EXT_SURROUND  |
    AudioCapability.DD_SURROUND         |
    AudioCapability.MLP_SURROUND,

    0xffffff,    /* PS: PSR16: Language code for audio */
    0xffffff,    /* PS: PSR17: Language code for PG and Text subtitles */
    0xffffff,    /* PS: PSR18: Menu description language code */
    0xffff,      /* PS: PSR19: Country code */
                 /* PS: PSR20: Region code */ /* 1 - A, 2 - B, 4 - C */
    Region.REGION_B,
                 /* PS: PSR21: Output mode preference */
    OutputPrefer.PREFER_2D,
    0,           /*     PSR22: Stereoscopic status */
    0,           /* PS: PSR23: Display capability */
    0,           /* PS: PSR24: 3D capability */
    0,           /* PS: PSR25: UHD capability */
    0,           /* PS: PSR26: UHD display capability */
    0,           /* PS: PSR27: HDR preference */
    0,           /* PS: PSR28: SDR conversion preference */
                 /* PS: PSR29: player capability for video */
    VideoCapability.VCAP_SECONDARY_HD |
    VideoCapability.VCAP_25Hz_50Hz,

    0x1ffff,     /* PS: PSR30: player capability for text subtitle */
                 /* PS: PSR31: Player profile and version */
    PlayerProfile.PROFILE_2_v2_0,
    0,           /*     PSR32 */
    0,           /*     PSR33 */
    0,           /*     PSR34 */
    0,           /*     PSR35 */
    0xffff,      /*     PSR36: backup PSR4 */
    0xffff,      /*     PSR37: backup PSR5 */
    0,           /*     PSR38: backup PSR6 */
    0,           /*     PSR39: backup PSR7 */
    0,           /*     PSR40: backup PSR8 */
    0,           /*     PSR41: */
    0xffff,      /*     PSR42: backup PSR10 */
    0,           /*     PSR43: backup PSR11 */
    0xff,        /*     PSR44: backup PSR12 */
    0,           /*     PSR45: */
    0,           /*     PSR46: */
    0,           /*     PSR47: */
    0xffffffff,  /* PS: PSR48: Characteristic text caps */
    0xffffffff,  /* PS: PSR49: Characteristic text caps */
    0xffffffff,  /* PS: PSR50: Characteristic text caps */
    0xffffffff,  /* PS: PSR51: Characteristic text caps */
    0xffffffff,  /* PS: PSR52: Characteristic text caps */
    0xffffffff,  /* PS: PSR53: Characteristic text caps */
    0xffffffff,  /* PS: PSR54: Characteristic text caps */
    0xffffffff,  /* PS: PSR55: Characteristic text caps */
    0xffffffff,  /* PS: PSR56: Characteristic text caps */
    0xffffffff,  /* PS: PSR57: Characteristic text caps */
    0xffffffff,  /* PS: PSR58: Characteristic text caps */
    0xffffffff,  /* PS: PSR59: Characteristic text caps */
    0xffffffff,  /* PS: PSR60: Characteristic text caps */
    0xffffffff,  /* PS: PSR61: Characteristic text caps */
    /* 62-95:   reserved */
    /* 96-111:  reserved for BD system use */
    /* 112-127: reserved */
]);


export enum PsrIdx {
    PSR_IG_STREAM_ID     = 0,
    PSR_PRIMARY_AUDIO_ID = 1,
    PSR_PG_STREAM        = 2, /* PG TextST and PIP PG TextST stream number */
    PSR_ANGLE_NUMBER     = 3, /* 1..N */
    PSR_TITLE_NUMBER     = 4, /* 1..N  (0 = top menu, 0xffff = first play) */
    PSR_CHAPTER          = 5, /* 1..N  (0xffff = invalid) */
    PSR_PLAYLIST         = 6, /* playlist file name number */
    PSR_PLAYITEM         = 7, /* 0..N-1 (playitem_id) */
    PSR_TIME             = 8, /* presetation time */
    PSR_NAV_TIMER        = 9,
    PSR_SELECTED_BUTTON_ID = 10,
    PSR_MENU_PAGE_ID     = 11,
    PSR_STYLE            = 12,
    PSR_PARENTAL         = 13,
    PSR_SECONDARY_AUDIO_VIDEO = 14,
    PSR_AUDIO_CAP        = 15,
    PSR_AUDIO_LANG       = 16,
    PSR_PG_AND_SUB_LANG  = 17,
    PSR_MENU_LANG        = 18,
    PSR_COUNTRY          = 19,
    PSR_REGION           = 20,
    PSR_OUTPUT_PREFER    = 21,
    PSR_3D_STATUS        = 22,
    PSR_DISPLAY_CAP      = 23,
    PSR_3D_CAP           = 24,
    PSR_UHD_CAP          = 25,
    PSR_UHD_DISPLAY_CAP  = 26,
    PSR_UHD_HDR_PREFER   = 27,
    PSR_UHD_SDR_CONV_PREFER = 28,
    PSR_VIDEO_CAP        = 29,
    PSR_TEXT_CAP         = 30, /* text subtitles */
    PSR_PROFILE_VERSION  = 31, /* player profile and version */
    PSR_BACKUP_PSR4      = 36,
    PSR_BACKUP_PSR5      = 37,
    PSR_BACKUP_PSR6      = 38,
    PSR_BACKUP_PSR7      = 39,
    PSR_BACKUP_PSR8      = 40,
    PSR_BACKUP_PSR10     = 42,
    PSR_BACKUP_PSR11     = 43,
    PSR_BACKUP_PSR12     = 44,
    /* 48-61: caps for characteristic text subtitle */
}

export default class BlurayRegister {
    psrRegister = new Uint32Array(PSR_COUNT);
    gprRegister = new Uint32Array(GPR_COUNT);
    
    constructor() {
        this.psrRegister.set(psrInit);
    }
}

export const isValidRegister = function(value: number) {
    if (value & PSR_FLAG) {
        if (value & ~0x8000007f) {
            console.error('invalid register');
            return false;
        }
    } else {
        if (value & ~0x00000fff) {
            console.error('invalid register');
            return false;
        }
    }

    return true;
}