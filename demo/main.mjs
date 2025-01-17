import BlurayPlayer from '../dist/BlurayPlayer.js';
import { get, set } from 'https://cdn.jsdelivr.net/npm/idb-keyval@6/+esm';

const player = new BlurayPlayer({
    videoEl: document.querySelector('video'),
    canvasEl: document.getElementById('canvas'),
    extCanvasEl: document.getElementById('extcanvas'),
});

document.querySelector('button').onclick = async function() {
    const dirHandle = await showDirectoryPicker();
    set('BDMV', dirHandle);
    location.reload();
}

const dirHandle = await get('BDMV');
await player.openBlurayDirectory(dirHandle);

// setTimeout(() => {
//     player.test();
// }, 10000);
// console.log(player.register.gprRegister)
// player.demux({ audio: 0 });