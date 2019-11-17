import React, {Component} from 'react';
import './App.css';

import msgpack from 'msgpack-lite';
import {sprintf} from 'sprintf-js';

const API_URL = process.env.REACT_APP_API;
const PING_DELAY = 10;
const LOG_LIMIT = 10;


const Actions = {
    INVENTORY: "inventory",
    EQUIP: "equip",
    USE: "use",
    MOVE: "move",
    ENTER: "enter",
    MELEE: "melee",
    PICKUP: "pickup",
    WAYPOINT: "waypoint",
    PLAYER_INFO: "player_info",
};

const ObjectTypes = {
    UNSPECIFIED: "unspecified",
    EQUIPMENT: "equipment",
    ITEM: "item",
    COIN: "coin",
};

const LogTypes = {
    NOTICE: "notice",
    DEBUG: "debug",
    INFO: "info"
};

function choice(items) {
    return items[Math.floor(Math.random() * items.length)];
}

function decode(data) {
    return msgpack.decode(new Uint8Array(data));
}

function encode(obj) {
    return msgpack.encode(obj);
}

class DataStore {
    constructor() {
        this.manifest = null;
        this.socket = null;
        this.responseCallbacks = {};
        this.eventCallbacks = {};
        this.requestId = 0;
        this.pingIntervalId = null;
        this.frames = 0;
        this.bytes = 0;
        this.tiles = null;
        this.settings = {
            playMusic: true,
            playSounds: true
        };
        this.maps = {};
        this.log = [];
        this.scale = .5;
    }

    get tileset() {
        return this.manifest ? this.manifest.tileset : null;
    }

    loadManifest(manifest_url, cb) {
        fetch(manifest_url, {
            method: "GET",
            mode: "cors",
            cache: "no-cache",
        }).then(response => {
            return response.json();
        }).then(manifest => {
            this.manifest = manifest;
            this.loadTiles(cb);
        }).catch(error => {
            cb.onError(error);
        });
    }

    loadTiles(cb) {
        const loaded = () => {
            cb.onLoaded();
        };
        this.tiles = new Image();
        this.tiles.onload = loaded;
        this.tiles.src = this.manifest.tiles_url;
    }

    get music() {
        return this.manifest ? this.manifest.music : null;
    }

    onPing() {
        const fps = this.frames / PING_DELAY;
        const kb = this.bytes / PING_DELAY / 1024;
        var _this = this;
        this.send({ping: new Date().getTime()}, (pong) => {
            const time = (new Date().getTime()) - pong.pong;
            const msg = sprintf("fps=%s / kb/s=%.02f / time=%s", fps, kb, time);
            _this.debugLog(msg);
            console.log(msg);
        });
        this.frames = this.bytes = 0;
    }

    connect(view, profile) {
        this.socket  = new WebSocket(this.manifest.socket_url);
        this.socket.binaryType = "arraybuffer";

        this.socket.addEventListener('open', (event) => {
            this.pingIntervalId = setInterval(this.onPing.bind(this), PING_DELAY * 1000);
            this.socket.send(encode({"profile": profile}));
            view.onConnected(event);
        });

        this.socket.addEventListener('message', (event) => {
            const msg = decode(event.data);
            this.bytes += event.data.byteLength;

            if (msg._id && this.responseCallbacks[msg._id]) {
                this.responseCallbacks[msg._id](msg);
                delete this.responseCallbacks[msg._id];
            } else if (msg._event && this.eventCallbacks[msg._event]) {

                if (msg._event === "frame") {
                    this.frames++;
                    this.updateMap(msg);
                } else if (msg._event === "notice") {
                    this.addLog(LogTypes.NOTICE, msg.notice);
                }

                this.eventCallbacks[msg._event](msg);
            }
        });

        this.socket.addEventListener('close', (event) => {
            clearInterval(this.pingIntervalId);
            view.onDisconnected(event);
        });

        this.socket.addEventListener('error', (event) => {
            clearInterval(this.pingIntervalId);
            view.onError(event);
        });
    }

    send(obj, callback) {
        // console.log(obj);
        if (this.socket.readyState !== 1) {
            return;
        }
        if (callback) {
            this.requestId++;
            obj._id = this.requestId;
            this.responseCallbacks[obj._id] = callback;
        }
        this.socket.send(encode(obj));
    }

    addEventListener(event, callback) {
        this.eventCallbacks[event] = callback;
    }

    cancelEventListener(event) {
        delete this.eventCallbacks[event];
    }

    save(storage) {
        storage.setItem("settings", JSON.stringify(this.settings));
    }

    load(storage) {
        const settings = storage.getItem("settings");
        if (settings)
            this.settings = JSON.parse(settings);
    }

    updateMap(frame) {
        if (!(frame.id in this.maps)) {
            this.maps[frame.id] = new Array(frame.height);
            for(var i=0; i<frame.height; i++) {
                this.maps[frame.id][i] = new Array(frame.width);
            }
        }
        const map = this.maps[frame.id];

        // frame 11x11
        // pos at 5,5
        //

        // xxxxxxxxxxx
        // xxxxxxxxxxx
        // xxxxxxxxxxx
        // xxxxxxxxxxx
        // xxxxxxxxxxx
        // xxxxx0xxxxx
        // xxxxxxxxxxx
        // xxxxxxxxxxx
        // xxxxxxxxxxx
        // xxxxxxxxxxx
        // xxxxxxxxxxx

        const map_height = frame.frame.length;
        const map_width = frame.frame[0].length;
        const map_min_x = Math.max(frame.x - Math.floor(map_width/2), 0);
        const map_max_x = Math.min(frame.x + Math.floor(map_width/2), map_width);
        const map_min_y = Math.max(frame.y - Math.floor(map_height/2), 0);
        const map_max_y = Math.min(frame.y + Math.floor(map_height/2), map_height);

        if (false)
            console.log(sprintf("patching from (%s, %s) x (%s, %s)", map_min_x, map_min_y, map_max_x, map_max_y));

        for (let y=0; y<map_height; y++) {
            const row = frame.frame[y];
            for (let x=0; x<map_width; x++) {
                const tx = map_min_x + x;
                const ty = map_min_y + y;
                if (row[x][1] > 0)
                    map[ty][tx] = row[x][1];
            }
        }
    }

    dumpMap(map) {
        const parts = [];
        for (let y=0; y<map.length; y++) {
            const row = map[y];
            parts.push(row.join(","));
        }
        console.log(parts.join("\n") + "\n");
    }

    addLog(log_type, message){
        this.log.unshift({type: log_type, message: message});
        while(this.log.length > LOG_LIMIT) {
            this.log.pop();
        }
        if (this.eventCallbacks["_log"]) {
            this.eventCallbacks["_log"]();
        }
    }

    debugLog(msg) {
        this.addLog(LogTypes.DEBUG, msg);
    }

    incrementScale(step) {
        this.scale += step;
        if (this.scale < .25)
            this.scale = .25;
        else if (this.scale > 1.5)
            this.scale = 1.5;
    }
}

DataStore.instance = new DataStore();


class SfxUtil {
    static musicPlayer = null;
    static playMusic(url) {
        SfxUtil.stopMusic();
        SfxUtil.musicPlayer = new Audio(url);
        SfxUtil.musicPlayer.play();
    }

    static stopMusic() {
        if (SfxUtil.musicPlayer) {
            SfxUtil.musicPlayer.pause();
            SfxUtil.musicPlayer = null;
        }
    }
    static shuffleMusic() {
        if (!DataStore.instance.settings.playMusic)
            return;

        const music = choice(DataStore.instance.music);
        SfxUtil.playMusic(music);
    }
}

class GfxUtil {
    static drawTile(ctx, x, y, tile_index, width, height) {
        const ds = DataStore.instance;
        const pos = DataStore.instance.tileset.tilemap[tile_index][0];
        ctx.drawImage(
            ds.tiles,
            pos[0] * ds.tileset.tilesize,
            pos[1] * ds.tileset.tilesize,
            ds.tileset.tilesize,
            ds.tileset.tilesize,
            x,
            y,
            width || ds.tileset.tilesize,
            height || ds.tileset.tilesize,
        );
    }

    static fillTile(ctx, x, y, color, width, height) {
        const tilesize = DataStore.instance.tileset.tilesize * DataStore.instance.scale;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, width || tilesize, height || tilesize);
    }
}

class MapRenderer {

    static renderOffscreen(ctx, msg) {
        const tilesize = DataStore.instance.tileset.tilesize;
        const min_x = msg.x - (msg.frame[0].length / 2);
        const min_y = msg.y - (msg.frame.length / 2);

        for (let y=0; y<msg.frame.length; y++) {
            const row = msg.frame[y];
            for (let x=0; x<row.length; x++) {
                const x_idx = min_x + x;
                const y_idx = min_y + y;
                const tile_index = row ? row[x][1] : -1;
                const [target_x, target_y] = [x_idx * tilesize, y_idx * tilesize];
                if (tile_index > 0) {
                    GfxUtil.drawTile(ctx, target_x, target_y, tile_index);
                }
            }
        }
    }

    static renderBase(ctx, offscreen, msg) {
        const orig_tilesize = DataStore.instance.tileset.tilesize;
        const tilesize = orig_tilesize * DataStore.instance.scale; // scaled
        const canvas_width = ctx.canvas.clientWidth;
        const canvas_height = ctx.canvas.clientHeight;

        const canvas_tile_width = Math.floor(canvas_width / tilesize);
        const canvas_tile_height = Math.floor(canvas_height / tilesize);

        const map_min_x = msg.x - Math.floor(canvas_tile_width / 2); // index space
        const map_min_y = msg.y - Math.floor(canvas_tile_height / 2);

        // Render Base
        ctx.drawImage(
            offscreen,
            map_min_x * orig_tilesize,
            map_min_y * orig_tilesize,
            canvas_tile_width * orig_tilesize,
            canvas_tile_height * orig_tilesize,
            0,
            0,
            canvas_tile_width * tilesize,
            canvas_tile_height * tilesize,
        );

        // const min_x = msg.x - (msg.frame[0].length / 2);
        // const min_y = msg.y - (msg.frame.length / 2);
        // const map = DataStore.instance.maps[msg.id];
        // const base_y =  Math.floor(canvas_tile_height / 2) - (msg.frame.length/2);
        // for (let y=0; y<msg.frame.length; y++) {
        //     const row = msg.frame[y];
        //     const base_x = Math.floor(canvas_tile_width / 2) - (row.length/2);

        //     for (let x=0; x<row.length; x++) {
        //         const x_idx = min_x + x;
        //         const y_idx = min_y + y;
        //         //drawPatch(ctx, map, x_idx, y_idx, tilesize);
        //     }
        // }

    }

    static renderObjects(ctx, msg) {
        const orig_tilesize = DataStore.instance.tileset.tilesize;
        const tilesize = orig_tilesize * DataStore.instance.scale; // scaled
        const canvas_width = ctx.canvas.clientWidth;
        const canvas_height = ctx.canvas.clientHeight;

        const canvas_tile_width = Math.floor(canvas_width / tilesize);
        const canvas_tile_height = Math.floor(canvas_height / tilesize);

        // Render Objects
        const obj_min_x = Math.floor(canvas_tile_width / 2) - Math.floor(msg.frame[0].length/2);
        const obj_min_y = Math.floor(canvas_tile_height / 2) - Math.floor(msg.frame.length/2);
        for (let y=0; y<msg.frame.length; y++) {
            const row = msg.frame[y];
            for (let x=0; x<row.length; x++) {
                const cell = row[x];
                const in_fov = cell[0];
                const [target_x, target_y] = [(x + obj_min_x) * tilesize, (y + obj_min_y) * tilesize];
                if (!in_fov) {
                    continue;
                }

                for (let i=2; i<row[x].length; i++) {
                    const obj_index = cell[i];
                    if (obj_index >= 0)
                        GfxUtil.drawTile(ctx, target_x, target_y, obj_index, tilesize, tilesize);
                }
            }
        }

    }

    static renderFOV(ctx, msg) {
        const orig_tilesize = DataStore.instance.tileset.tilesize;
        const tilesize = orig_tilesize * DataStore.instance.scale; // scaled

        const canvas_width = ctx.canvas.clientWidth;
        const canvas_height = ctx.canvas.clientHeight;

        const canvas_tile_width = Math.floor(canvas_width / tilesize);
        const canvas_tile_height = Math.floor(canvas_height / tilesize);

        const map_min_x = msg.x - Math.floor(canvas_tile_width / 2); // index space
        const map_min_y = msg.y - Math.floor(canvas_tile_height / 2);

        const frame_min_x = msg.x - Math.floor(msg.frame[0].length/2);
        const frame_min_y = msg.y - Math.floor(msg.frame.length/2);
        const frame_max_x = msg.x + Math.floor(msg.frame[0].length/2);
        const frame_max_y = msg.y + Math.floor(msg.frame.length/2);

        // Render FOV
        for (let y=0; y<canvas_tile_height; y++) {
            const y_idx = map_min_y + y;
            for (let x=0; x<canvas_tile_width; x++) {
                const x_idx = map_min_x + x;
                const in_range = x_idx >= frame_min_x && x_idx < frame_max_x && y_idx >= frame_min_y && y_idx < frame_max_y;
                const [target_x, target_y] = [x * tilesize, y * tilesize];

                if (!in_range) {
                    GfxUtil.fillTile(ctx, target_x, target_y, "rgba(0, 0, 0, .5)");
                }
            }
        }

        const obj_min_x = Math.floor(canvas_tile_width / 2) - Math.floor(msg.frame[0].length/2);
        const obj_min_y = Math.floor(canvas_tile_height / 2) - Math.floor(msg.frame.length/2);
        for (let y=0; y<msg.frame.length; y++) {
            const row = msg.frame[y];
            for (let x=0; x<row.length; x++) {
                const cell = row[x];
                const in_fov = cell[0];
                if (in_fov) {
                    continue;
                }
                const [target_x, target_y] = [(x + obj_min_x) * tilesize, (y + obj_min_y) * tilesize];
                GfxUtil.fillTile(ctx, target_x, target_y , "rgba(0, 0, 0, .5)");
            }
        }
    }

    static renderUI(ctx, clicked) {
        const orig_tilesize = DataStore.instance.tileset.tilesize;
        const tilesize = orig_tilesize * DataStore.instance.scale; // scaled

        if (clicked) {
            const [clickedX, clickedY] = clicked;
            const [target_x, target_y] = [
                clickedX,
                clickedY
            ];

            var grd = ctx.createRadialGradient(target_x, target_y, 0, target_x, target_y, tilesize);
            grd.addColorStop(0, "rgba(200, 0, 0, .5)");
            grd.addColorStop(1, "rgba(200, 0, 0, 0)");

            // Fill with gradient
            ctx.fillStyle = grd;
            ctx.fillRect(target_x - tilesize, target_y - tilesize, 2 * tilesize, 2 * tilesize);
        }
    }

    static renderMap(ctx, offscreen, msg, clicked) {
        MapRenderer.renderBase(ctx, offscreen, msg);
        MapRenderer.renderObjects(ctx, msg);
        MapRenderer.renderFOV(ctx, msg);
        MapRenderer.renderUI(ctx, clicked);
    }

    static clearMap(ctx) {
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, ctx.width, ctx.height);
        console.log("clear", ctx.width, ctx.height);
    }

    static redrawMiniMap(ctx, map, scale) {
        for (let y=0; y<map.length; y++) {
            const row = map[y];
            for (let x=0; x<row.length; x++) {
                const idx = map[y][x];
                const color = idx >=0 ? DataStore.instance.tileset.tilemap[idx][1] : "black";
                const cx = x * scale;
                const cy = y * scale;
                ctx.fillStyle = color;
                ctx.fillRect(cx, cy, scale, scale);
            }
        }
    }

    static renderMiniMap(ctx, scale, frame) {
        for (let y=0; y<frame.frame.length; y++) {
            const row = frame.frame[y];
            for (let x=0; x<row.length; x++) {
                const idx = frame.frame[y][x][1];
                const cx = ((frame.x + x) - Math.floor(row.length/2)) * scale;
                const cy = ((frame.y + y) - Math.floor(frame.frame.length/2)) * scale;
                if (idx >= 0) {
                    const color = DataStore.instance.tileset.tilemap[idx][1];
                    ctx.fillStyle = color;
                    ctx.fillRect(cx, cy, scale, scale);
                }
            }
        }
    }

    static redrawMap(ctx, map, offscreen) {
        const orig_tilesize = DataStore.instance.tileset.tilesize;
        const tilesize = orig_tilesize * DataStore.instance.scale; // scaled
        for (let y=0; y<map.length; y++) {
            const row = map[y];
            for (let x=0; x<row.length; x++) {
                const tile = row && row[x] ? row[x] : null;
                const tile_index = tile ? tile[1] : -1;
                const [target_x, target_y] = [x * tilesize, y * tilesize];
                if (tile_index > 0) {
                    GfxUtil.drawTile(ctx, target_x, target_y, tile_index);
                } else {
                    ctx.fillStyle = "black";
                    ctx.fillRect(target_x, target_y, tilesize, tilesize);
                }
            }
        }

    }
}


class Dialog extends React.Component {
    constructor(props) {
        super(props);
        this.handleClose = this.handleClose.bind(this);
    }
    render() {
        return (
            <div className="dialog">
                <div className="dialog-titlebar">
                    <a className="dialog-close" onClick={this.handleClose} href="?close"><strong>&#10005;</strong></a>
                    <strong>{this.props.title}</strong>
                </div>
                <div className="dialog-body">
                    {this.props.children}
                </div>
            </div>
        );
    }
    handleClose(e) {
        e.preventDefault();
        this.props.callback();
    }
}

class HelpDialog extends Dialog {
    render() {
        return (
            <Dialog title="Help" callback={this.props.callback}>
                <h4>Controls</h4>
                <h5>Mouse</h5>
                <p>Click on a position, item, enemy or door to interact.  Use scroll wheel to change zoom</p>
                <h5>Keyboard</h5>
                <pre>
                    <strong>w/a/s/d</strong> - to move N/W/S/E<br/>
                    <strong>.</strong>       - to enter doors<br/>
                    <strong>p</strong>       - to pickup items<br/>
                    <strong>f</strong>       - to attack surrounding<br/>
                    <strong>i</strong>       - to show/hide inventory<br/>
                    <strong>h</strong>       - to show/hide help<br/>
                    <strong>+</strong>       - increase zoom<br/>
                    <strong>-</strong>       - decrease zoom<br/>
                </pre>
            </Dialog>
        );
    }
}

class InventoryItem extends React.Component {

    constructor(props) {
        super(props);
        this.onClick = this.onClick.bind(this);
    }

    onClick() {
        this.props.handler.onItemClick(this.props.item);
    }

    getClassName() {
        return this.props.item.equipped ? "inventory-item equipped" : "inventory-item";
    }

    get canvas() {
        return this.refs.canvas;
    }

    componentDidMount() {
        const ctx = this.canvas.getContext("2d");
        GfxUtil.drawTile(ctx, 0, 0, this.props.item.idx);
    }

    render() {
        return (
            <div className={this.getClassName()} onClick={this.onClick}>
                <canvas tabIndex="0" ref="canvas" width={DataStore.instance.tileset.tilesize} height={DataStore.instance.tileset.tilesize} />
                <p className="inventory-item-name">
                    {this.props.item.name}
                </p>
            </div>
        );
    }
}


class InventoryDialog extends Dialog {

    constructor(props) {
        super(props);
        this.state = {"inventory": []};
        this.onItemClick = this.onItemClick.bind(this);
    }

    componentWillMount() {
        DataStore.instance.send({action: Actions.INVENTORY}, (msg) => {
            this.setState({"inventory": msg.inventory});
        });
    }

    componentWillUnmount() {

    }

    onItemClick(item) {
        if (item.type === ObjectTypes.EQUIPMENT) {
            DataStore.instance.send({action: Actions.EQUIP, item: item.id}, (msg) => {
                for (let i = 0; i < this.state.inventory.length; i++) {
                    if (this.state.inventory[i].id === msg.id) {
                        this.state.inventory[i].equipped = msg.equipped;
                        this.setState({"inventory": this.state.inventory});
                        break;
                    }
                }
            });
        } else if (item.type === ObjectTypes.ITEM) {
            DataStore.instance.send({action: Actions.USE, item: item.id}, (msg) => {
                this.setState({"inventory": this.state.inventory.filter((i) => {
                    return i.id !== msg.id;
                })});
            });
        }

    }

    render() {
        const items = this.state.inventory.map((item) => {
            return <InventoryItem key={item.id} item={item} handler={this}/>;
        });

        return (
            <Dialog title="Inventory" callback={this.props.callback}>
                <h4>Equipment</h4>
                <p>
                    Equip weapons and armor by clicking on them.<br/>
                    Use items by clicking on them.<br/>
                </p>
                <div className="inventory">
                    {items}
                </div>
                <div className="clear">
                </div>
            </Dialog>
        );
    }
}



class PlayerValues extends React.Component {
    render() {
        const parts = [];
        for (var k in this.props.values) {
            parts.push(<div key={k}>{k}: <strong>{this.props.values[k]}</strong></div>);
        }
        return (
                <div className="player-values">
                    {parts}
                </div>
        );
    }
}


class PlayerDialog extends Dialog {
    constructor(props) {
        super(props);
        this.state = {"player_info": null};
    }

    componentWillMount() {
        DataStore.instance.send({action: Actions.PLAYER_INFO}, (msg) => {
            this.setState({"player_info": msg.player_info});
        });
    }

    render() {
        var body = [];
        if (this.state.player_info) {
            body.push(<h4 key="h-attrs">Attributes</h4>);
            body.push(<PlayerValues className="player-attrs" key="attrs" values={this.state.player_info.attributes}/>);
            body.push(<h4 key="h-stats">Stats</h4>);
            body.push(<PlayerValues className="player-stats" key="stats" values={this.state.player_info.stats}/>);
        } else {
            body.push(<div key="loading">Loading...</div>);
        }

        return (
            <Dialog title={this.state.player_info ? this.state.player_info.name : "Player"} callback={this.props.callback}>
                {body}
            </Dialog>
        );
    }
}

class SettingsDialog extends Dialog {
    constructor(props) {
        super(props);
        this.onMusicChanged = this.onMusicChanged.bind(this);
    }

    render() {
        return (
                <Dialog title="Settings" callback={this.props.callback}>
                <div>
                <input type="checkbox" name="play_music" defaultChecked={DataStore.instance.settings.playMusic} onChange={this.onMusicChanged}/>
                <span>Music</span>
                </div>
                </Dialog>
        );
    }

    onMusicChanged(event) {
        DataStore.instance.settings.playMusic = event.target.checked;
        if (event.target.checked)
            SfxUtil.shuffleMusic();
        else
            SfxUtil.stopMusic();

        DataStore.instance.save(window.localStorage);
    }
}

class CanvasView extends React.Component {
    constructor(props) {
        super(props);
        this.offscreen = null;

        this.onBlur = this.onBlur.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);
        this.onKeyUp = this.onKeyUp.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onContextMenu = this.onContextMenu.bind(this);
        this.onTouchStart = this.onTouchStart.bind(this);
        this.onTouchEnd = this.onTouchEnd.bind(this);
        this.showPlayerDialog = this.showPlayerDialog.bind(this);
        this.showInventoryDialog = this.showInventoryDialog.bind(this);
        this.showHelpDialog = this.showHelpDialog.bind(this);
        this.showSettingsDialog = this.showSettingsDialog.bind(this);
        this.closeDialogs = this.closeDialogs.bind(this);
        this.onUnload = this.onUnload.bind(this);
        this.onLog = this.onLog.bind(this);
        this.onWheel = this.onWheel.bind(this);

        this.pressed = {};
        this.clicked = null;

        this.state = {
            showHelp: true,
            showInventory: false,
            showPlayer: false,
            showSettings: false,
            connecting: true,
            connected: false,
            error: false,
            stats: {}
        };
    }

    get canvas() {
        return this.refs.canvas;
    }

    get minimap() {
        return this.refs.minimap;
    }

    componentDidMount() {
        DataStore.instance.addEventListener("frame", (msg) => {
            requestAnimationFrame(() => {
                this.onFrame(msg);
            });
        });
        DataStore.instance.addEventListener("notice", (msg) => { this.onNotice(msg); });
        DataStore.instance.addEventListener("stats", (msg) => { this.onStats(msg); });
        DataStore.instance.addEventListener("_log", (msg) => { this.onLog(); });
        DataStore.instance.connect(this, this.props.profile);

        const canvas = this.canvas;
        const minimap = this.minimap;
        function resize() {
            const ctx = canvas.getContext("2d");
            const tilesize = DataStore.instance.tileset.tilesize * DataStore.instance.scale;
            ctx.width = canvas.width = Math.floor(Math.floor(window.innerWidth / tilesize) * tilesize);
            ctx.height = canvas.height = Math.floor(Math.floor(window.innerHeight / tilesize) * tilesize);

            const mctx = minimap.getContext("2d");
            mctx.width = "200";
            mctx.height = "200";
        }
        window.addEventListener("resize", resize);
        resize();

        canvas.addEventListener("touchstart", this.onTouchStart, {passive: false});

        canvas.focus();
        SfxUtil.shuffleMusic();

        MapRenderer.clearMap(this.minimap.getContext("2d"));
        MapRenderer.clearMap(this.canvas.getContext("2d"));
    }

    onUnload(event) {
        event.preventDefault();
        return "";
    }

    onConnected() {
        this.setState({connected: true, connecting: false});
        window.addEventListener("beforeunload", this.onUnload);
    }

    onDisconnected() {
        this.setState({connected: false});
        SfxUtil.stopMusic();
        window.removeEventListener("beforeunload", this.onUnload);
    }

    onError() {
        this.setState({connected: false, error: true});
    }

    onFrame(msg) {
        const map = DataStore.instance.maps[msg.id];
        if (!this.offscreen) {
            this.offscreen = document.createElement('canvas');
            const ctx = this.offscreen.getContext("2d");
            ctx.width = this.offscreen.width = msg.width * DataStore.instance.tileset.tilesize;
            ctx.height = this.offscreen.height = msg.height * DataStore.instance.tileset.tilesize;
            MapRenderer.clearMap(ctx);
        }
        MapRenderer.renderOffscreen(this.offscreen.getContext("2d"), msg);
        MapRenderer.renderMap(this.canvas.getContext("2d"), this.offscreen, msg, this.clicked);
        MapRenderer.renderMiniMap(this.minimap.getContext("2d"), 2, msg);
    }

    onLog() {
        this.forceUpdate();
    }

    onNotice(event) {
        if (event.mood) {
            SfxUtil.shuffleMusic();
        }
        if (event.entered) {
            MapRenderer.clearMap(this.canvas.getContext("2d"));
            MapRenderer.clearMap(this.offscreen.getContext("2d"));
            MapRenderer.clearMap(this.minimap.getContext("2d"));
            if (event.entered in DataStore.instance.maps) {
                MapRenderer.redrawMiniMap(this.minimap.getContext("2d"), DataStore.instance.maps[event.entered], 2);
                MapRenderer.redrawMap(this.canvas.getContext("2d"),  DataStore.instance.maps[event.entered]);
            }
        }
    }

    onStats(event) {
        this.setState({stats: event.stats});
    }

    handleKeyPress(event) {
        const key = event.key.toLowerCase();
        this.pressed[key] = event.type === 'keydown';
        return key;
    }

    onKeyDown(event) {
        this.handleKeyPress(event);
    }

    onKeyUp(event) {
        this.handleKeyPress(event);
        var dx = 0;
        var dy = 0;


        const handlers = {
            w: function() { dy-- },
            a: function() { dx-- },
            s: function() { dy++ },
            d: function() { dx++ },
            p: function() {
                DataStore.instance.send({action: Actions.PICKUP});
            },
            ".": function () {
                DataStore.instance.send({action: Actions.ENTER});
            },
            f: function() {
                DataStore.instance.send({action: Actions.MELEE});
            },
            i: function() {
                if (this.state.showInventory)
                    this.closeInventoryDialog();
                else
                    this.showInventoryDialog();
            },
            h: function() {
                if (this.state.showHelp)
                    this.closeHelpDialog();
                else
                    this.showHelpDialog();
            },
            "+": function() {
                DataStore.instance.incrementScale(.1);
            },
            "-": function() {
                DataStore.instance.incrementScale(-.1);
            }
        };
        for (let pressed in this.pressed) {
            if (handlers[pressed]) {
                handlers[pressed].bind(this)();
            }
        }

        if (dx !== 0 || dy !== 0) {
            DataStore.instance.send({action: Actions.MOVE, direction: [dx, dy]});
        }
        this.pressed = {};
    }

    onBlur() {
        this.canvas.focus();
    }

    setWaypoint(x, y) {
        const tilesize = DataStore.instance.tileset.tilesize * DataStore.instance.scale;
        const width = Math.floor(this.canvas.clientWidth / tilesize);
        const height = Math.floor(this.canvas.clientHeight / tilesize);
        const pos = [x, y];
        this.clicked = pos;
        console.log("waypoint",
                    "dim",
                    width, height,
                    "ev", x, y,
                    Math.round(x / tilesize),
                    Math.round(y / tilesize),
                    Math.floor(x / tilesize) - Math.floor(width / 2),
                    Math.floor(y / tilesize) - Math.floor(height / 2)
                   );
        const relpos = [
            Math.round(x / tilesize) - Math.floor(width / 2) -1,  // WTF
            Math.round(y / tilesize) - Math.floor(height / 2) -1
        ];
        DataStore.instance.send({action: Actions.WAYPOINT, pos: relpos});
    }

    clearWaypoint() {
        this.clicked = null;
    }

    onMouseDown(event) {
        const rect = this.canvas.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        this.setWaypoint(x, y);
        return false;
    }

    onMouseUp(event) {
        this.clearWaypoint();
    }

    onContextMenu(event) {
        event.preventDefault();
    }

    onTouchStart(event) {
        event.preventDefault();
        const rect = this.canvas.getBoundingClientRect();
        const touch = event.touches[0];
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        this.setWaypoint(x, y);
    }

    onTouchEnd(event) {
        event.preventDefault();
        this.clearWaypoint();
    }

    onWheel(event) {
        if (event.ctrlKey) {
            DataStore.instance.incrementScale(-event.deltaY * 0.01);
        }
    }

    showDialog(dialog) {
        const state = Object.assign(
            {showPlayer: false, showInventory: false, showHelp: false, showSettings: false},
            dialog
        );
        this.setState(state);
    }

    closeDialogs() {
        this.showDialog({});
    }

    showPlayerDialog() {
        this.showDialog({showPlayer: true});
    }

    showInventoryDialog() {
        this.showDialog({showInventory: true});
    }

    closeInventoryDialog() {
        this.showDialog({showInventory: false});
    }

    showHelpDialog() {
        this.showDialog({showHelp: true});
    }

    closeHelpDialog() {
        this.showDialog({showHelp: false});
    }

    showSettingsDialog() {
        this.showDialog({showSettings: true});
    }

    render() {

        let status;
        if (this.state.connecting) {
            status = (
                <div className="splash">
                    Connecting...
                </div>
            );
        } else if (this.state.error) {
            status = (
                <div className="splash">
                    ERROR!!!
                </div>
            );
        } else if (!this.state.connected) {
            status = (
                <div className="splash disconnected">
                    DISCONNECTED!!!<br/>
                    Hit reload to try again...
                </div>
            );
        }

        let dialog;
        if (this.state.showHelp) {
            dialog = <HelpDialog callback={this.closeDialogs}/>;
        }

        if (this.state.showPlayer) {
            dialog = <PlayerDialog callback={this.closeDialogs}/>;
        }

        if (this.state.showInventory) {
            dialog = <InventoryDialog callback={this.closeDialogs} />;
        }

        if (this.state.showSettings) {
            dialog = <SettingsDialog callback={this.closeDialogs}/>;
        }

        const log = DataStore.instance.log.map((l, i) => {
            return (
                <div key={i} className={l.type}>
                    {l.message}
                </div>
            );
        });

        let stats;
        if (this.state.stats.tot) {
            const text = (this.state.stats.hp >=0 ? this.state.stats.hp : 0) + " of " + this.state.stats.tot;
            stats = (
                <div className="stats">
                    Health:
                    <div className="progress-bar">
                    <span style={{width: this.state.stats.hp/this.state.stats.tot * 100 + "%"}}>{text}</span>
                    </div>
                </div>
            );
        }

        return (
            <div>
                <div className="toolbar">
                    <button className="help" onClick={this.showHelpDialog}>Help</button>
                    <button className="settings" onClick={this.showSettingsDialog}>Settings</button>
                    <button className="player" onClick={this.showPlayerDialog}>Player</button>
                    <button className="inventory" onClick={this.showInventoryDialog}>Inventory</button>
                </div>

                {status}
                {stats}

                <canvas className="minimap" ref="minimap" width={200} height={200} />
                <canvas className="playarea" tabIndex="0" ref="canvas"
                        width={800} height={800}
                        onKeyDown={this.onKeyDown}
                        onKeyUp={this.onKeyUp}
                        onBlur={this.onBlur}
                        onMouseDown={this.onMouseDown}
                        onMouseUp={this.onMouseUp}
                        onTouchEnd={this.onTouchEnd}
                        onContextMenu={this.onContextMenu}
                        onWheel={this.onWheel}
                        />

                <div className="log">
                    {log}
                </div>

                <div className="footer">
                </div>

                {dialog}
            </div>
        );
    }
}

function ErrorView() {
    return (
        <div className="splash error">
            Could not connect!!!
        </div>
    );
}

function LoadingView() {
    return (
        <div className="splash loading">
            Loading....
        </div>
    );
}


class JoinView extends Component {
    constructor(props) {
        super(props);
        this.state = {name: "Player-" + Math.round(1000 * Math.random()).toString()};
        this.submit = this.submit.bind(this);
        this.update = this.update.bind(this);    }

    update(event) {
        this.setState({name: event.target.value});
    }

    submit(event) {
        event.preventDefault();
        this.props.handler.onJoin(this.state);
    }

    render() {
        return (
            <div className="join">
                <fieldset>
                    <legend>Join the game</legend>

                    <form onSubmit={this.submit}>
                        <label>Name:</label>
                        <input type="text" name="name" onChange={this.update} value={this.state.name}/>
                        <input type="submit" onClick={this.submit} value="Join"/>
                    </form>

                </fieldset>
            </div>
        );
    }

}

class StatsView extends Component {
    render() {
        return (
                <div className="server-stats">
                <p><em>{DataStore.instance.manifest.num_players_online}</em> players online now!</p>
                <p>Server age: {DataStore.instance.manifest.server_age}</p>
                </div>
        );
    }
}

const Tiles = {
    NW: 1,
    N:  2,
    NE: 4,
    W:  8,
    E:  16,
    SW: 32,
    S:  64,
    SE: 128,
};
function getValue(map, x, y) {
    if (y < 0 || x < 0 || y >= map.length || x >= map[0].length)
        return undefined;
    return map[y][x];
}

function checkValue(map, x, y, val) {
    const rv = getValue(map, x, y);
    return rv !== undefined && rv !== val;
}

function computeMask(map, x, y) {
    const val = getValue(map, x, y);
    var rv = 0;

    if(checkValue(map, x-1, y-1, val))
        rv += Tiles.NW;

    if(checkValue(map, x, y-1, val))
        rv += Tiles.N;

    if(checkValue(map, x+1, y-1, val))
        rv += Tiles.NE;

    if(checkValue(map, x-1, y, val))
        rv += Tiles.W;

    if(checkValue(map, x+1, y, val))
        rv += Tiles.E;

    if(checkValue(map, x-1, y+1, val))
        rv += Tiles.SW;

    if(checkValue(map, x, y+1, val))
        rv += Tiles.S;

    if(checkValue(map, x+1, y+1, val))
        rv += Tiles.SE;

    return rv;
}

var offscreenGradientCanvas;
function generatePatch(ctx, base_index, blend_index, mask, tilesize) {

    //if (!offscreenGradientCanvas) {
        offscreenGradientCanvas = document.createElement("canvas");
        offscreenGradientCanvas.width = offscreenGradientCanvas.height =  tilesize;
        document.body.appendChild(offscreenGradientCanvas);
    //}

    const offctx = offscreenGradientCanvas.getContext("2d");

    //offctx.clearRect(0, 0, tilesize, tilesize);
    GfxUtil.drawTile(offctx, 0, 0, base_index, tilesize, tilesize);
    offctx.globalCompositeOperation = "destination-out";

    function _draw(gradient) {
        gradient.addColorStop(0, "rgba(255, 255, 255, .0)");
        gradient.addColorStop(1, "rgba(255, 255, 255, 1)");
        offctx.fillStyle = gradient;
        offctx.fillRect(0, 0, tilesize, tilesize);
    }

    var gradient;
    if (mask & Tiles.NE) {
        gradient = ctx.createLinearGradient(0, tilesize, tilesize, 0);
        _draw(gradient);
    }
    if (mask & Tiles.NW) {
        gradient = ctx.createLinearGradient(tilesize, tilesize, 0, 0);
        _draw(gradient);
    }
    if (mask & Tiles.SE) {
        gradient = ctx.createLinearGradient(0, 0, tilesize, tilesize);
        _draw(gradient);
    }
    if (mask & Tiles.SW) {
        gradient = ctx.createLinearGradient(tilesize, 0, 0, tilesize);
        _draw(gradient);
    }
    if (mask & Tiles.N) {
        gradient = ctx.createLinearGradient(tilesize/2, tilesize, tilesize/2, 0);
        _draw(gradient);
    }
    if (mask & Tiles.S) {
        gradient = ctx.createLinearGradient(tilesize/2, 0, tilesize/2, tilesize);
        _draw(gradient);
    }
    if (mask & Tiles.E) {
        gradient = ctx.createLinearGradient(0, tilesize/2, tilesize, tilesize/2);
        _draw(gradient);
    }
    if (mask & Tiles.W) {
        gradient = ctx.createLinearGradient(tilesize, tilesize/2, 0, tilesize/2);
        _draw(gradient);
    }

    return offscreenGradientCanvas;
}


var offscreenPatchCanvas;
function drawPatch(ctx, map, x, y, tilesize) {
    const mask = computeMask(map, x, y);
    if (!mask)
        return null;
    const base_index = getValue(map, x, y);
    if (base_index === undefined)
        return null;

    if (!offscreenPatchCanvas) {
        offscreenPatchCanvas = document.createElement("canvas");
        offscreenPatchCanvas.width = tilesize;
        offscreenPatchCanvas.height = tilesize
    }
    const offctx = offscreenPatchCanvas.getContext("2d");
    offctx.clearRect(0, 0, tilesize, tilesize);
    var dx = 0;
    var dy = 0;
    function _draw(blend_index, _dx, _dy) {
        dx = _dx;
        dy = _dy;
        if (blend_index === undefined )
            return;
        const patch = generatePatch(ctx, base_index, blend_index, mask, tilesize);
        offctx.drawImage(patch, 0, 0, tilesize, tilesize);
    }

    var blend_index;
    if ((mask & Tiles.NE) === Tiles.NE) {
        blend_index = getValue(map, x-1, y+1);
        _draw(blend_index, tilesize/2, -tilesize/2);

    }
    if ((mask & Tiles.NW) === Tiles.NW) {
        blend_index = getValue(map, x-1, y-1);
        _draw(blend_index, -tilesize/2, -tilesize/2);
    }
    if ((mask & Tiles.SE) === Tiles.SE) {
        blend_index = getValue(map, x+1, y+1);
        _draw(blend_index, tilesize/2, tilesize/2);
    }
    if ((mask & Tiles.SW) === Tiles.SW) {
        blend_index = getValue(map, x+1, y+1);
        _draw(blend_index, -tilesize/2, tilesize/2);
    }
    if ((mask & Tiles.N) === Tiles.N) {
        blend_index = getValue(map, x-1, y);
        _draw(blend_index, 0, -tilesize/2);
    }
    if ((mask & Tiles.S) === Tiles.S) {
        blend_index = getValue(map, x+1, y);
        _draw(blend_index, 0, tilesize/2);
    }
    if ((mask & Tiles.E) === Tiles.E) {
        blend_index = getValue(map, x, y+1);
        _draw(blend_index, tilesize/2, 0);
    }
    if ((mask & Tiles.W) === Tiles.W) {
        blend_index = getValue(map, x, y-1);
        _draw(blend_index, -tilesize/2, 0);
    }
    ctx.drawImage(offscreenPatchCanvas, (x * tilesize)+ dx, (y * tilesize) + dy, tilesize, tilesize);
}

class SandboxView extends Component {
    componentDidMount() {
        const ctx = this.refs.sandbox.getContext("2d");
        const orig_tilesize = DataStore.instance.tileset.tilesize;
        const tilesize = orig_tilesize;
        const canvas_width = ctx.canvas.clientWidth;
        const canvas_height = ctx.canvas.clientHeight;

        const center_x = canvas_width/2;
        const center_y = canvas_height/2;

        const map = [
            [6, 6, 6, 6, 6],
            [6, 9, 9, 9, 6],
            [6, 9, 3, 9, 6],
            [6, 9, 9, 9, 6],
            [6, 6, 6, 6, 6],
        ];

        for (let y=0; y<map.length; y++) {
            const row = map[y];
            for (let x=0; x<row.length; x++) {
                const idx = row[x];
                GfxUtil.drawTile(ctx, x * tilesize, y * tilesize, idx, tilesize, tilesize);
            }
        }
        for (let y=0; y<map.length; y++) {
            const row = map[y];
            for (let x=0; x<row.length; x++) {
                drawPatch(ctx, map, x, y, tilesize);
            }
        }
        for (let y=0; y<map.length; y++) {
            for (let x=0; x<map[0].length; x++) {
                ctx.strokeRect(x * tilesize, y * tilesize, tilesize, tilesize);
            }
        }
    }
    render() {
        return <canvas className="sanbox" ref="sandbox" width={800} height={800} />;
    }
}


class App extends Component {

    constructor(props) {
        super(props);
        this.state = {loaded: false, error: false, profile: null};
    }

    componentDidMount() {
        DataStore.instance.loadManifest(API_URL,  this);
    }

    onJoin(data) {
        this.setState({profile: data});
    }

    onLoaded() {
        this.setState({loaded: true});
        DataStore.instance.load(window.localStorage);
    }

    onError() {
        this.setState({error: true});
    }

    render() {

        let contents;
        if (this.state.profile) {
            contents = <CanvasView profile={this.state.profile}/>;
        } else if (this.state.loaded) {
            contents = <div>
                <JoinView handler={this}/>
                <StatsView/>
                </div>;
            //contents = <SandboxView/>;
        } else if (this.state.error) {
            contents = <ErrorView/>;
        } else {
            contents = <LoadingView />;
        }

        return (
            <div className="App">
                {contents}
            </div>
        );
    }
}

export default App;
