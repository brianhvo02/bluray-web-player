/**
 * BLURAY_PLAYER_SETTING_AUDIO_CAP (PSR15)
 *
 * Player capability for audio (bitmask)
 */

export enum AudioCapability {
    /* LPCM capability */

    /* 48/96kHz (mandatory) */
    LPCM_48_96_STEREO_ONLY = 0x0001,  /**< LPCM 48kHz and 96kHz stereo capable */
    LPCM_48_96_SURROUND    = 0x0002,  /**< LPCM 48kHz and 96kHz surround capable */

    /* 192kHz (optional) */
    LPCM_192_NONE          = 0x0000,  /**< LPCM 192kHz not supported */
    LPCM_192_STEREO_ONLY   = 0x0004,  /**< LPCM 192kHz stereo capable */
    LPCM_192_SURROUND      = 0x0008,  /**< LPCM 192kHz surround capable */

    /* Dolby Digital Plus capability */

    /* independent substream (mandatory) */
    DDPLUS_STEREO_ONLY     = 0x0010,  /**< DD Plus independent substream stereo capable */
    DDPLUS_SURROUND        = 0x0020,  /**< DD Plus independent substream surround capable */

    /* dependent substream (optional) */
    DDPLUS_DEP_NONE        = 0x0000,  /**< DD Plus dependent substream not supported */
    DDPLUS_DEP_STEREO_ONLY = 0x0040,  /**< DD Plus dependent substream stereo capable */
    DDPLUS_DEP_SURROUND    = 0x0080,  /**< DD Plus dependent substream surround capable */

    /* DTS-HD */

    /* Core substream (mandatory) */
    DTSHD_CORE_STEREO_ONLY = 0x0100,  /**< DTS-HD Core stereo capable */
    DTSHD_CORE_SURROUND    = 0x0200,  /**< DTS-HD Core surround capable */

    /* Extension substream (optional) */
    DTSHD_EXT_NONE         = 0x0000,  /**< DTS-HD extension substream not supported */
    DTSHD_EXT_STEREO_ONLY  = 0x0400,  /**< DTS-HD extension substream stereo capable */
    DTSHD_EXT_SURROUND     = 0x0800,  /**< DTS-HD extension substream surround capable */

    /* Dolby lossless (TrueHD) */

    /* Dolby Digital (mandatory) */
    DD_STEREO_ONLY         = 0x1000,  /**< Dolby Digital audio stereo capable */
    DD_SURROUND            = 0x2000,  /**< Dolby Digital audio surround capable */

    /* MLP (optional) */
    MLP_NONE               = 0x0000,  /**< MLP not supported */
    MLP_STEREO_ONLY        = 0x4000,  /**< MLP stereo capable */
    MLP_SURROUND           = 0x8000,  /**< MLP surround capable */
};


/**
 * BLURAY_PLAYER_SETTING_REGION_CODE (PSR20)
 *
 * Player region code (integer)
 *
 */

export enum Region {
    /** Region A: the Americas, East and Southeast Asia, U.S. territories, and Bermuda. */
    REGION_A = 1,

    /** Region B: Africa, Europe, Oceania, the Middle East, the Kingdom of the Netherlands,
     *            British overseas territories, French territories, and Greenland. */
    REGION_B = 2,
    /** Region C: Central and South Asia, Mongolia, Russia, and the People's Republic of China. */
    REGION_C = 4,
}


/**
 * BLURAY_PLAYER_SETTING_OUTPUT_PREFER (PSR21)
 *
 * Output mode preference (integer)
 */

export enum OutputPrefer {
    PREFER_2D = 0,  /**< 2D output preferred */
    PREFER_3D = 1,  /**< 3D output preferred */
}

/*
 * BLURAY_PLAYER_SETTING_DISPLAY_CAP (PSR23)
 *
 * Display capability (bit mask) and display size
 */
export enum DisplayCapability {
    DCAP_1080p_720p_3D           = 0x01,  /**< capable of 1920x1080 23.976Hz and 1280x720 59.94Hz 3D */
    DCAP_720p_50Hz_3D            = 0x02,  /**< capable of 1280x720 50Hz 3D */
    DCAP_NO_3D_CLASSES_REQUIRED  = 0x04,  /**< 3D glasses are not required */
    DCAP_INTERLACED_3D           = 0x08,  /**< capable of interlaced 3D */
    
    /* horizontal display size in centimeters */
    DCAP_DISPLAY_SIZE_UNDEFINED  = 0,        /**< connected display physical size unknown/undefined */
    DCAP_DISPLAY_SIZE_MASK       = 0xfff00,  /**< display size mask */
}

/**< connected display physical size (cm) */
export const DCAP_DISPLAY_SIZE   = (cm: number) => (cm > 0xfff ? 0xfff : cm) << 8;

/**
 * BLURAY_PLAYER_SETTING_VIDEO_CAP (PSR29)
 *
 * Player capability for video (bit mask)
 */

export enum VideoCapability{
    VCAP_SECONDARY_HD = 0x01,  /**< player can play secondary stream in HD */
    VCAP_25Hz_50Hz    = 0x02,  /**< player can play 25Hz and 50Hz video */
}

/**
 * BLURAY_PLAYER_SETTING_PLAYER_PROFILE (PSR31)
 *
 * Player profile and version
 *
 * - Profile 1, version 1.0: no local storage, no VFS, no internet
 * - Profile 1, version 1.1: PiP, VFS, sec. audio, 256MB local storage, no internet
 * - Profile 2, version 2.0: BdLive (internet), 1GB local storage
 */

export enum PlayerProfile {
    PROFILE_1_v1_0        = ((0x00 << 16) | (0x0100)),   /**< Profile 1, version 1.0 (Initial Standard Profile) */
    PROFILE_1_v1_1        = ((0x01 << 16) | (0x0110)),   /**< Profile 1, version 1.1 (secondary stream support) */
    PROFILE_2_v2_0        = ((0x03 << 16) | (0x0200)),   /**< Profile 2, version 2.0 (network access, BdLive) */
    PROFILE_3_v2_0        = ((0x08 << 16) | (0x0200)),   /**< Profile 3, version 2.0 (audio only player) */
    PROFILE_5_v2_4        = ((0x13 << 16) | (0x0240)),   /**< Profile 5, version 2.4 (3D) */
    PROFILE_6_v3_0        = ((0x00 << 16) | (0x0300)),   /**< Profile 6, version 3.0 (UHD) */
    PROFILE_6_v3_1        = ((0x00 << 16) | (0x0310)),   /**< Profile 6, version 3.1 (UHD) */
    PROFILE_3D_FLAG       = 0x100000,                    /**< set for 3D profiles */
    PROFILE_VERSION_MASK  = 0xffff,                      /**< bit mask for player version */
}

/* Player profile flags and version mask */

//!@}

/**
 * BLURAY_PLAYER_SETTING_DECODE_PG
 *
 * Enable Presentation Graphics and Text Subtitle decoder
 */

export enum PgTextDecoder {
    DISABLE  = 0,  /**< disable both decoders */
    ENABLE   = 1,  /**< enable both decoders */
}


/**
 * BLURAY_PLAYER_SETTING_PERSISTENT_STORAGE
 *
 * Enable / disable BD-J persistent storage.
 *
 * If persistent storage is disabled, BD-J Xlets can't access any data
 * stored during earlier playback sessions. Persistent data stored during
 * current playback session will be removed and can't be accessed later.
 *
 * This setting can't be changed after bd_play() has been called.
 */

export enum PersistentStorage {
    DISABLE = 0,  /**< disable persistent storage between playback sessions */
    ENABLE  = 1,  /**< enable persistent storage */
}
