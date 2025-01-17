export const MAX_INT = Math.pow(2, 31) - 1;
export const MIN_INT = -Math.pow(2, 31);
export const GIGABYTE = Math.pow(2, 30);
export const GIGABYTE_PACKETS = Math.floor(GIGABYTE / 192);

export const BITS_PER_SAMPLE = [0, 16, 20, 24];
export const CHANNEL_LAYOUTS = [
    null, {
        name: 'MONO',
        channels: 1,
    }, null, {
        name: 'STEREO',
        channels: 2,
    }, {
        name: 'SURROUND',
        channels: 5,
    }, {
        name: '2.1',
        channels: 3,
    }, {
        name: '4.0',
        channels: 4,
    }, {
        name: '2.2',
        channels: 4,
    }, {
        name: '5.0',
        channels: 5,
    }, {
        name: '5.1',
        channels: 6,
    }, {
        name: '7.0',
        channels: 7,
    }, {
        name: '7.1',
        channels: 8,
    }, null, null, null, null,
];

export const SAMPLE_RATE: Record<number, number> = {
    1: 48000,
    4: 96000,
    5: 192000
}