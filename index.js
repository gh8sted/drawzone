const express = require("express");
const http = require("http");
const socketIO = require("socket.io");
const path = require("path");
const fs = require("fs");
require("dotenv").config();

const app = express();
const httpServer = http.createServer(app);
const io = socketIO(httpServer);

const Client = require("./modules/player/Client.js");
const chunkManager = require("./modules/world/chunkManager.js");
const textManager = require("./modules/world/textManager.js");
const lineManager = require("./modules/world/lineManager.js");

const config = require("./config.json");
const { getRankByID } = require("./modules/player/rankingUtils.js");
const log = require("./modules/log.js");
const Plugin = require("./modules/Plugin.js");

/**
 * Global server object that holds various server configurations and states.
 * @global
 * @type {Object}
 * @property {Array} worlds - An array to store world instances.
 * @property {Array} plugins - An array to store plugin instances.
 * @property {Object} config - Server configuration loaded from a JSON file.
 * @property {Object} env - Environment variables from the process environment.
 */
global.server = {
    worlds: [],
    plugins: [],
    config,
    env: process.env
}

const sanitizeXSS = input => !input ? input : input.replace(/[&<>"'/]/g, (match) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;', '/': '&#x2F;'})[match] || match);

function followSyntax(plugin) {
    if(typeof plugin.name == "string" &&
        typeof plugin.version == "string" &&
        typeof plugin.install == "function") return true;
    else return false;
}

function timeConverter(seconds) {
    let minutes = Math.floor(seconds / 60);
    let sec = Math.floor(seconds % 60);
    let hours = Math.floor(minutes / 60);
    minutes %= 60;
    let days = Math.floor(hours / 24);
    hours %= 24;
    let milliseconds = Math.floor((seconds % 1) * 1000);

    return `${days ? `${days}d ` : ""}${hours ? `${hours}h ` : ""}${minutes ? `${minutes}m ` : ""}${sec ? `${sec}s` : ""}${milliseconds ? ` ${milliseconds}ms` : ""}`;
}

function loadPlugins() {
    const folder = path.join(__dirname, 'plugins');
    fs.readdirSync(folder).forEach(file => {
        const filePath = path.join(folder, file);
        if (!file.endsWith(".js")) return;
        const plugin = require(filePath);
        plugin.filename = file;
        plugin.loaded = !file.startsWith("-");
        
        if (plugin.loaded) {
            log(`${plugin.name}`, `Loading ${plugin.name} v${plugin.version}`);
            if (followSyntax(plugin)) {
                const start = Date.now();
                plugin.install();
                const end = Date.now();
                plugin.took = end - start;
                log(`${plugin.name}`, `Enabling ${plugin.name} v${plugin.version} took${timeConverter(plugin.took / 1000)}`);
            } else {
                plugin.loaded = false;
                log("ERROR", `Could not load '${filePath}'\nDoesn't follow syntax`);
            }
        }
        server.plugins.push(new Plugin(plugin));
    });
}

loadPlugins();

// Certain modules may necessitate the use of global server variables
const { Command } = require("./modules/player/commands.js");

const files = [];
const getFilesRecursively = function(directory) {
    const filesInDirectory = fs.readdirSync(directory);
    for(let i = 0; i < filesInDirectory.length; i++) {
        const file = filesInDirectory[i];
        let absolute = path.join(directory, file);
        if(fs.statSync(absolute).isDirectory()) {
            getFilesRecursively(absolute);
        } else {
            files.push(absolute);
            let routePath = '/' + path.relative("routing/client/", absolute).split(path.sep).join('/');
            app.get(routePath, function(req, res) {
                return res.sendFile(absolute, {
                    root: '.'
                });
            });
        }
    }
}
getFilesRecursively("./routing/client/");

// Route shared documents with the client
{
    const srcPath = path.join(__dirname, "modules", "shared", "ranks.json");
    const destPath = path.join(__dirname, 'client-src', 'shared', "ranks.json");

    fs.copyFile(srcPath, destPath, (err) => {
        if (err) throw err;
    });
}

app.get("/:worldName?", (req, res) => {
    return res.sendFile("./routing/client/index.html", {
        root: '.'
    });
});

io.on("connection", socket => {
    const client = new Client(socket);
    socket.join(client.world);

    socket.broadcast.to(client.world).emit("playerJoin", client.id);

    /*
    setInterval(() => {
        client.flushUpdates();
    }, 1000 / 30);
    */

    socket.on("setPixel", (x, y, color) => {
        x = Math.floor(x);
        y = Math.floor(y);
        
        client.color = color;

        const chunkX = Math.floor(x / 16);
        const chunkY = Math.floor(y / 16);

        if(!getRankByID(client.rank).permissions.includes("protect") && chunkManager.get_protection(client.world, chunkX, chunkY) === true) return;
        if(config.saving.savePixels) chunkManager.set_pixel(client.world, x, y, color);
        
        io.to(client.world).emit("newPixel", x, y, color);
    });

    socket.on("setLine", (from, to) => {
        if(config.saving.saveLines) lineManager.draw_line(client.world, from, to);

        io.to(client.world).emit("newLine", from, to);
    });

    socket.on("setText", (text, x, y) => {
        if(config.saving.saveTexts) textManager.set_text(client.world, text, x, y);

        io.to(client.world).emit("newText", text, x, y);
    });

    socket.on("setChunk", (color, chunkX, chunkY) => {
        if(!getRankByID(client.rank).permissions.includes("erase")) return;

        const chunkData = chunkManager.set_rgb(client.world, chunkX, chunkY, color);
        const isProtected = chunkManager.get_protection(client.world, chunkX, chunkY);

        const updates = {};
        updates[`${chunkX},${chunkY}`] = { data: chunkData, protected: isProtected };

        io.to(client.world).emit("chunkLoaded", updates);
    });

    socket.on("setChunkData", (chunkX, chunkY, chunkData) => {
        if(!getRankByID(client.rank).permissions.includes("erase")) return;

        chunkManager.set_chunkdata(client.world, chunkX, chunkY, chunkData);
        const isProtected = chunkManager.get_protection(client.world, chunkX, chunkY);

        const updates = {};
        updates[`${chunkX},${chunkY}`] = { data: chunkData, protected: isProtected };

        io.to(client.world).emit("chunkLoaded", updates);
    });

    socket.on("protect", (value, chunkX, chunkY) => {
        if(!getRankByID(client.rank).permissions.includes("protect")) return;
        chunkManager.set_protection(client.world, chunkX, chunkY, value);
        io.to(client.world).emit("protectionUpdated", chunkX, chunkY, value);
    });

    socket.on("move", (x, y) => {
        client.x = x;
        client.y = y;

        socket.broadcast.to(client.world).emit("playerMoved", client.id, x, y);
    });

    socket.on("setTool", toolID => {
        client.tool = toolID;

        socket.broadcast.to(client.world).emit("playerUpdate", client.id, client.tool, client.color);
    });

    socket.on("loadChunk", (loadQueueOrX, maybeY) => {
        const chunkDatas = {};
        
        if (typeof loadQueueOrX === 'object') {
            for(let i in loadQueueOrX) {
                const [x, y] = loadQueueOrX[i];

                chunkDatas[`${x},${y}`] = {
                    data: chunkManager.get_chunkdata(client.world, x, y),
                    protected: chunkManager.get_protection(client.world, x, y)
                }
            }
        } else if (typeof loadQueueOrX === 'number' && typeof maybeY === 'number') {
            const x = loadQueueOrX, y = maybeY;
            chunkDatas[`${x},${y}`] = {
                data: chunkManager.get_chunkdata(client.world, x, y),
                protected: chunkManager.get_protection(client.world, x, y)
            }
        }

        socket.emit("chunkLoaded", chunkDatas);
    });

    socket.on("send", message => {
        const rank = getRankByID(client.rank);
        if(!rank.permissions.includes("chat")) return;
        if(message.length > config.maxMessageLength && !rank.permissions.includes("bypassChatLength")) return;
        
        message = message.trim();
        if(message.startsWith('/')) {
            new Command(client, message);
            return;
        }

        function formatMessage(client, rank, message) {
            const chatPrefix = rank.chatPrefix ? `${rank.chatPrefix} ` : '';
            const senderInfo = client.nickname ? `<span class="rank-${rank.id}">${rank.revealID ? `[${client.id}]` : ''}${chatPrefix}${client.nickname}</span>` : `<span class="id">${rank.revealID ? `[${client.id}]` : ''}${chatPrefix}</span>`;
            
            return `${senderInfo}: ${sanitizeXSS(message)}`;
        }

        const formattedMessage = formatMessage(client, rank, message);
        io.to(client.world).emit("message", formattedMessage);
    });

    socket.on("disconnect", () => {
        io.to(client.world).emit("playerLeft", client.id);
    });
});

httpServer.listen(config.port, () => {
    log("INFO", `Server is running at *:${config.port}`);
});