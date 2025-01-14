interface CommandInstruction {
    grp: HdmvInsnGrp;
    subGrp: number;
    immOp1: number;
    immOp2: number;
    branchOpt: number;
    cmpOpt: number;
    setOpt: number;
    opCnt: number;
}

interface BranchCommandInstruction extends CommandInstruction {
    grp: HdmvInsnGrp.GROUP_BRANCH;
    subGrp: HdmvInsnGrpBranch;
}

interface BranchGotoCommandInstruction extends BranchCommandInstruction {
    subGrp: HdmvInsnGrpBranch.GOTO;
    branchOpt: HdmvInsnGoto;
}

interface BranchJumpCommandInstructon extends BranchCommandInstruction {
    subGrp: HdmvInsnGrpBranch.JUMP;
    branchOpt: HdmvInsnJump;
}

interface BranchPlayCommandInstruction extends BranchCommandInstruction {
    subGrp: HdmvInsnGrpBranch.PLAY;
    branchOpt: HdmvInsnPlay;
}

interface CompareCommandInstruction extends CommandInstruction {
    grp: HdmvInsnGrp.GROUP_CMP;
    cmpOpt: HdmvInsnCmp;
}

interface SetCommandInstruction extends CommandInstruction {
    grp: HdmvInsnGrp.GROUP_SET;
    subGrp: HdmvInsnGrpSet;
}

interface SetRegularCommandInstruction extends SetCommandInstruction {
    subGrp: HdmvInsnGrpSet.SET;
    branchOpt: HdmvInsnSet;
}

interface SetSystemCommandInstruction extends SetCommandInstruction {
    subGrp: HdmvInsnGrpSet.SETSYSTEM;
    branchOpt: HdmvInsnSetSystem;
}

interface Command {
    insn: CommandInstruction;
    dst: number;
    src: number;
}

interface TitleObject {
    resumeIntentionFlag: boolean;
    menuCallMask: boolean;
    titleSearchMask: boolean;
    cmds: Command[];
}

interface MovieObject {
    bdHeader: BlurayHeader;
    objs: TitleObject[];
}