export enum HdmvInsnGrp {
    GROUP_BRANCH = 0,
    GROUP_CMP    = 1,
    GROUP_SET    = 2,
}

export enum HdmvInsnGrpBranch {
    GOTO   = 0x00,
    JUMP   = 0x01,
    PLAY   = 0x02,
}

export enum HdmvInsnGoto {
    NOP          = 0x00,
    GOTO         = 0x01,
    BREAK        = 0x02,
}

export enum HdmvInsnJump {
    JUMP_OBJECT  = 0x00,
    JUMP_TITLE   = 0x01,
    CALL_OBJECT  = 0x02,
    CALL_TITLE   = 0x03,
    RESUME       = 0x04,
}

export enum HdmvInsnPlay {
    PLAY_PL      = 0x00,
    PLAY_PL_PI   = 0x01,
    PLAY_PL_PM   = 0x02,
    TERMINATE_PL = 0x03,
    LINK_PI      = 0x04,
    LINK_MK      = 0x05,
}

export enum HdmvInsnCmp {
    BC = 0x01,
    EQ = 0x02,
    NE = 0x03,
    GE = 0x04,
    GT = 0x05,
    LE = 0x06,
    LT = 0x07,
}

export enum HdmvInsnGrpSet {
    SET       = 0x00,
    SETSYSTEM = 0x01,
} 

export enum HdmvInsnSet {
    MOVE   = 0x01,
    SWAP   = 0x02,
    ADD    = 0x03,
    SUB    = 0x04,
    MUL    = 0x05,
    DIV    = 0x06,
    MOD    = 0x07,
    RND    = 0x08,
    AND    = 0x09,
    OR     = 0x0a,
    XOR    = 0x0b,
    BITSET = 0x0c,
    BITCLR = 0x0d,
    SHL    = 0x0e,
    SHR    = 0x0f,
}

export enum HdmvInsnSetSystem {
    SET_STREAM      = 0x01,
    SET_NV_TIMER    = 0x02,
    SET_BUTTON_PAGE = 0x03,
    ENABLE_BUTTON   = 0x04,
    DISABLE_BUTTON  = 0x05,
    SET_SEC_STREAM  = 0x06,
    POPUP_OFF       = 0x07,
    STILL_ON        = 0x08,
    STILL_OFF       = 0x09,
    SET_OUTPUT_MODE = 0x0a,
    SET_STREAM_SS   = 0x0b,

    SETSYSTEM_0x10  = 0x10,
}
