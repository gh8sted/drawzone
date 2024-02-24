import { camera, canvas } from "../camera.js";
import { CHUNK_SIZE, requestRender } from "../renderer.js";
import { chunks, lines, texts } from "../sharedState.js";
import { mouse } from "../mouse.js";
import events from "../events.js";
import local_player from "../local_player.js";
import Bucket from "../../modules/player/Bucket.js";
import world from "../world.js";

var loadQueue = [];

const socket = io();

const getLoginKeys = () => Object.keys(localStorage).filter(key => key.endsWith("login"));
const loginKeys = getLoginKeys();

socket.on("connect", () => {
    console.log("Connected!");
    document.getElementById("players-display").innerText = "Players: 1"; // we connected

    events.emit("loadChunks");

    loginKeys.forEach(key => {
        const value = localStorage.getItem(key);
        socket.emit("send", `/${key} ${value}`);
    });
    if(localStorage.getItem("nick")) socket.emit("send", "/nick " + localStorage.getItem("nick"));
    
    socket.on("chunkLoaded", chunkDatas => {
        for(let key in chunkDatas) {
            const [x, y] = key.split(',').map(Number);
            addChunk(chunkDatas[key].data, x, y, chunkDatas[key].protected);
        }
        requestRender();
    });

    socket.on("newPixel", (x, y, color) => {
        const chunkX = Math.floor(x / CHUNK_SIZE);
        const chunkY = Math.floor(y / CHUNK_SIZE);

        let pixelX = Math.floor(x % 16);
        let pixelY = Math.floor(y % 16);
        
        if (pixelX < 0) pixelX += 16;
        if (pixelY < 0) pixelY += 16;

        if(chunks[`${chunkX},${chunkY}`]) {
            requestRender();
            chunks[`${chunkX},${chunkY}`].data[pixelX][pixelY] = color;
        }
    });

    socket.on("newLine", (from, to) => {
        lines.push([from, to]);
        requestRender();
    });
    socket.on("newText", (text, x, y) => {
        texts[`${x},${y}`] = text;
        requestRender();
    });

    socket.on("newRank", rank => {
        console.log("Got rank:", rank);
        local_player.rank = rank;
        events.emit("newRank", rank);
    });

    socket.on("newPixelQuota", (rate, per) => {
        console.log(`Got PixelQuota: ${rate}x${per}`);
        local_player.pixelQuota = new Bucket(rate, per);
    });
    socket.on("newLineQuota", (rate, per) => {
        console.log(`Got LineQuota: ${rate}x${per}`);
        local_player.lineQuota = new Bucket(rate, per);
    });

    socket.on("teleport", (x, y) => {
        camera.centerAt(x, y);
    });
});

events.on("addText", (text, x, y) => {
    socket.emit("setText", text, x, y);
});

events.on("setTool", toolID => {
    socket.emit("setTool", toolID);
});

canvas.addEventListener('mousemove', () => {
    world.move(mouse.tileX, mouse.tileY);
});

setInterval(() => {
    if(loadQueue.length > 0) {
        socket.emit("loadChunk", loadQueue);
        loadQueue = [];
    }
}, 1000 / 5);

function addChunk(chunkData, chunkX, chunkY, isProtected) {
    const key = `${chunkX},${chunkY}`;
    chunks[key] = { data: chunkData, protected: isProtected };
}

export function loadVisibleChunks() {
    const chunkSizeInPixels = CHUNK_SIZE * camera.zoom;
    const leftChunkIndex = Math.floor(camera.x / chunkSizeInPixels);
    const rightChunkIndex = Math.ceil((camera.x + canvas.width) / chunkSizeInPixels);
    const topChunkIndex = Math.floor(camera.y / chunkSizeInPixels);
    const bottomChunkIndex = Math.ceil((camera.y + canvas.height) / chunkSizeInPixels);

    for (let y = topChunkIndex; y < bottomChunkIndex; y++) {
        for (let x = leftChunkIndex; x < rightChunkIndex; x++) {
            const chunkKey = `${x},${y}`;
            if (!chunks.hasOwnProperty(chunkKey)) {
                loadQueue.push([x, y]);
            }
        }
    }
    // if(loadQueue.length > 0) {
    //     socket.emit("loadChunk", loadQueue);
    //     loadQueue = [];
    // }
}

export function unloadInvisibleChunks() {
    const chunkSizeInPixels = CHUNK_SIZE * camera.zoom;
    const leftChunkIndex = Math.floor(camera.x / chunkSizeInPixels);
    const rightChunkIndex = Math.ceil((camera.x + canvas.width) / chunkSizeInPixels);
    const topChunkIndex = Math.floor(camera.y / chunkSizeInPixels);
    const bottomChunkIndex = Math.ceil((camera.y + canvas.height) / chunkSizeInPixels);

    const visibleChunksKeys = new Set();
    for (let y = topChunkIndex; y < bottomChunkIndex; y++) {
        for (let x = leftChunkIndex; x < rightChunkIndex; x++) {
            visibleChunksKeys.add(`${x},${y}`);
        }
    }

    const chunksToDelete = Object.keys(chunks).filter(chunkKey => !visibleChunksKeys.has(chunkKey));
    if (chunksToDelete.length > Object.keys(chunks).length / 2) {
        chunksToDelete.forEach(chunkKey => delete chunks[chunkKey]);
        requestRender();
    }
}

events.on("loadChunks", () => {
    unloadInvisibleChunks(); // removing this improves performance but stores more chunks in memory
    loadVisibleChunks();
});

export default socket;