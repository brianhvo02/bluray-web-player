export const getPathHandle = async function(dirHandle: FileSystemDirectoryHandle, path: string) {
    const entries = path.split('/');
    const directories = entries.slice(0, -1);
    const filename = entries[entries.length - 1];

    const parentDirectoryHandle = await directories.reduce(
        async (handlePromise, directory) => handlePromise
            .then(handle => handle.getDirectoryHandle(directory)), 
        new Promise<FileSystemDirectoryHandle>(resolve => resolve(dirHandle))
    );

    return parentDirectoryHandle.getFileHandle(filename);
};

export const byteArrToString = (arr: Uint8Array, idx: number, len: number) => 
    [...arr.slice(idx, idx + len)].map(val => String.fromCharCode(val)).join('');

export const joinArrayBuffers = function(buffers: Uint8Array[]) {
    const newSize = buffers.reduce((size, arr) => size + arr.byteLength, 0);
    const newBuf = new Uint8Array(newSize);
    buffers.reduce((i, buf) => {
        newBuf.set(buf, i);
        return i + buf.byteLength;
    }, 0);
    return newBuf;
}

export const convertToRgb = (arr: Uint8Array) => [
    [1.164,  0.000,  1.793],
    [1.164, -0.213, -0.533],
    [1.164,  2.112,  0.000],
].map(row => Math.max(0, Math.min(255, Math.round(
    row.reduce((sum, mul, i) => sum + mul * (arr[i] - (i ? 128 : 16)), 0)
))));