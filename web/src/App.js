import React, {Component} from 'react';
import './App.css';

import msgpack from 'msgpack-lite';
import {sprintf} from 'sprintf-js';

const API_URL = process.env.REACT_APP_API;
const PING_DELAY = 10;
const SCALE = 2;
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
    static drawTile(ctx, x, y, tile_index) {
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
            ds.tileset.tilesize,
            ds.tileset.tilesize,
        );
    }

    static fillTile(ctx, x, y, color) {
        const tilesize = DataStore.instance.tileset.tilesize;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, tilesize, tilesize);
    }
}

class MapRenderer {
    static renderMap(ctx, map, msg, clicked) {

        const tilesize = DataStore.instance.tileset.tilesize;
        const canvas_width = ctx.canvas.clientWidth;
        const canvas_height = ctx.canvas.clientHeight;
        const canvas_tile_width = Math.floor(canvas_width / tilesize) * SCALE;
        const canvas_tile_height = Math.floor(canvas_height / tilesize) * SCALE;

        const map_min_x = msg.x - Math.floor(canvas_tile_width/2);
        const map_min_y = msg.y - Math.floor(canvas_tile_height/2);

        const frame_min_x = msg.x - Math.floor(msg.frame[0].length/2);
        const frame_min_y = msg.y - Math.floor(msg.frame.length/2);
        const frame_max_x = msg.x + Math.floor(msg.frame[0].length/2);
        const frame_max_y = msg.y + Math.floor(msg.frame.length/2);

        //this.clearMap(ctx, canvas_width, canvas_height);

        for (let y=0; y<canvas_tile_height; y++) {
            const y_idx = map_min_y + y;
            const row = map[y_idx];
            for (let x=0; x<canvas_tile_width; x++) {

                const x_idx = map_min_x + x;
                const in_range = x_idx >= frame_min_x && x_idx < frame_max_x && y_idx >= frame_min_y && y_idx < frame_max_y;
                const tile_index = row ? row[x_idx] : -1;
                const [target_x, target_y] = [x * tilesize, y * tilesize];

                if (tile_index > 0) {
                    GfxUtil.drawTile(ctx, target_x, target_y, tile_index);
                    if (!in_range) {
                        GfxUtil.fillTile(ctx, target_x, target_y, "rgba(0, 0, 0, .5)");
                    }
                } else {
                    GfxUtil.fillTile(ctx, target_x, target_y, "black");
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
                const [target_x, target_y] = [(x + obj_min_x) * tilesize, (y + obj_min_y) * tilesize];
                if (!in_fov) {
                    GfxUtil.fillTile(ctx, target_x, target_y , "rgba(0, 0, 0, .5)");
                    continue;
                }

                for (let i=1; i<row[x].length; i++) {
                    const obj_index = cell[i];
                    if (obj_index >= 0)
                        GfxUtil.drawTile(ctx, target_x, target_y, obj_index);
                }
            }
        }


        if (clicked) {
            const [clickedX, clickedY] = clicked;
            const [target_x, target_y] = [
                (clickedX * SCALE) - (tilesize),
                (clickedY * SCALE) - (tilesize)
            ];
            GfxUtil.fillTile(ctx, target_x, target_y, "rgba(255, 0, 0, .5)");
        }
    }

    static clearMap(ctx, width, height) {
        ctx.fillStyle = "black";
        ctx.fillRect(0, 0, width, height);
    }

    static redrawMiniMap(ctx, map, scale) {
        for (let y=0; y<map.length; y++) {
            const row = map[y];
            for (let x=0; x<row.length; x++) {
                const idx = map[y][x];
                if (idx >= 0) {
                    const color = DataStore.instance.tileset.tilemap[idx][1];
                    const cx = x * scale;
                    const cy = y * scale;
                    ctx.fillStyle = color;
                    ctx.fillRect(cx, cy, scale + 1, scale + 1);
                }
            }
        }
    }

    static renderMiniMap(ctx, scale, frame) {
        for (let y=0; y<frame.frame.length; y++) {
            const row = frame.frame[y];
            for (let x=0; x<row.length; x++) {
                const idx = frame.frame[y][x][1];
                const cx = (frame.x * scale) + (x * scale);
                const cy = (frame.y * scale) + (y * scale);
                if (idx >= 0) {
                    const color = DataStore.instance.tileset.tilemap[idx][1];
                    ctx.fillStyle = color;
                    ctx.fillRect(cx, cy, scale + 1, scale + 1);
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
                <pre>
                    <strong>w/a/s/d</strong> - to move N/W/S/E<br/>
                    <strong>.</strong>       - to enter doors<br/>
                    <strong>p</strong>       - to pickup items<br/>
                    <strong>f</strong>       - to attack surrounding<br/>
                    <strong>i</strong>       - to show/hide inventory<br/>
                    <strong>h</strong>       - to show/hide help<br/>
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
        this.onBlur = this.onBlur.bind(this);
        this.onKeyDown = this.onKeyDown.bind(this);
        this.onKeyUp = this.onKeyUp.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onTouchStart = this.onTouchStart.bind(this);
        this.onTouchEnd = this.onTouchEnd.bind(this);
        this.showPlayerDialog = this.showPlayerDialog.bind(this);
        this.showInventoryDialog = this.showInventoryDialog.bind(this);
        this.showHelpDialog = this.showHelpDialog.bind(this);
        this.showSettingsDialog = this.showSettingsDialog.bind(this);
        this.closeDialogs = this.closeDialogs.bind(this);
        this.onUnload = this.onUnload.bind(this);
        this.onLog = this.onLog.bind(this);

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
        function resize() {
            const tilesize = DataStore.instance.tileset.tilesize;
            canvas.width = Math.floor(window.innerWidth / tilesize) * tilesize * SCALE;
            canvas.height = Math.floor(window.innerHeight / tilesize) * tilesize * SCALE;
        }
        window.addEventListener("resize", resize);
        resize();

        canvas.addEventListener("touchstart", this.onTouchStart,  {passive: false});

        canvas.focus();
        SfxUtil.shuffleMusic();

        MapRenderer.clearMap(this.minimap.getContext("2d"), this.minimap.clientWidth, this.minimap.clientHeight);
        MapRenderer.clearMap(this.canvas.getContext("2d"), this.canvas.clientWidth, this.canvas.clientHeight);
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
        MapRenderer.renderMap(this.canvas.getContext("2d"), map, msg, this.clicked);
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
            MapRenderer.clearMap(this.minimap.getContext("2d"), this.minimap.clientWidth, this.minimap.clientHeight);
            MapRenderer.clearMap(this.canvas.getContext("2d"), this.canvas.clientWidth, this.canvas.clientHeight);
            if (event.entered in DataStore.instance.maps) {
                MapRenderer.redrawMiniMap(this.minimap.getContext("2d"), DataStore.instance.maps[event.entered], 2);
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
        const tilesize = DataStore.instance.tileset.tilesize / SCALE;
        const width = Math.floor(this.canvas.clientWidth / tilesize);
        const height = Math.floor(this.canvas.clientHeight / tilesize);
        const pos = [x, y];
        this.clicked = pos;
        console.log("waypoint",
                    "dim",
                    width, height,
                    "ev", x, y,
                    Math.floor(x / tilesize),
                    Math.floor(y / tilesize),
                    Math.floor(x / tilesize) - Math.floor(width / 2),
                    Math.floor(y / tilesize) - Math.floor(height / 2)
                   );
        const relpos = [
            Math.floor(x / tilesize) - Math.floor(width / 2),
            Math.floor(y / tilesize) - Math.floor(height / 2)
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
        console.log("clicked", x, y);
        this.setWaypoint(x, y);
        return false;
    }

    onMouseUp(event) {
        this.clearWaypoint();
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
