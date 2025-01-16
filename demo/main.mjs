import BlurayPlayer from '../dist/BlurayPlayer.js';
import { get, set } from 'https://cdn.jsdelivr.net/npm/idb-keyval@6/+esm';

const player = new BlurayPlayer({ videoEl: document.querySelector('video') });

document.querySelector('button').onclick = async function() {
    const dirHandle = await showDirectoryPicker();
    location.reload();
    set('BDMV', dirHandle);
}

const dirHandle = await get('BDMV');
await player.openBlurayDirectory(dirHandle, 2);

setTimeout(() => {
    player.test();
}, 10000);
// console.log(player.register.gprRegister)
// player.demux({ audio: 0 });