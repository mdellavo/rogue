import React, { Component, useEffect, useState, useRef } from 'react';
import './App.css';

import msgpack from 'msgpack-lite';
import {sprintf} from 'sprintf-js';

const API_URL = process.env.REACT_APP_API;
const PING_DELAY = 10;
const LOG_LIMIT = 10;


enum Action {
    INVENTORY = "inventory",
    EQUIP = "equip",
    USE = "use",
    MOVE = "move",
    ENTER = "enter",
    MELEE = "melee",
    PICKUP = "pickup",
    WAYPOINT = "waypoint",
    PLAYER_INFO = "player_info",
};

enum ObjectType {
    UNSPECIFIED = "unspecified",
    EQUIPMENT = "equipment",
    ITEM = "item",
    COIN = "coin",
};

enum LogType {
    NOTICE = "notice",
    DEBUG = "debug",
    INFO = "info"
};

function choice(items: any[]) {
    return items[Math.floor(Math.random() * items.length)];
}

function decode(data: any) {
    return msgpack.decode(new Uint8Array(data));
}

function encode(obj: any) {
    return msgpack.encode(obj);
}

type Tile = [[number, number], string]

interface TileSet {
    tilesize: number;
    tilemap: Tile[];
}

interface Manifest {
    server_age: number;
    num_players_online: number;
    tiles_url: string;
    socket_url: string;
    music: string[];
    tileset: TileSet;
}

type ResponseCallbacks = {
    [key: number]: (msg?: any) => void;
}

type EventCallbacks = {
    [key: string]: (msg?: any) => void;
}

type Settings = {
    playMusic: boolean;
    playSounds: boolean;
}

type LogMessage = {
    type: LogType;
    message: string;
}

type MapManager = {
    [key: string]: number[][];
}

interface DataStoreCallback {
    onError(e: any): void;
    onLoaded(): void;
}

interface ConnectionListener {
    onConnected(event: any): void;
    onDisconnected(event: any): void;
    onError(event: any): void;
}

interface PlayerProfile {
    name: string;
}

type ResponseCallback = (msg: any) => void;
type EventCallback = (msg: any) => void;

interface ServerMessage {
    _event: string;
}

interface FrameUpdateMessage extends ServerMessage {
    id: string;
    frame: any[][][];
    width: number;
    height: number;
    x: number;
    y: number;
}


class DataStore {

    static instance: DataStore;

    manifest?: Manifest;
    socket?: WebSocket;
    responseCallbacks: ResponseCallbacks;
    eventCallbacks: EventCallbacks;
    settings: Settings;
    tiles: HTMLImageElement;
    requestId: number = 0;
    frames: number = 0;
    bytes: number = 0;
    scale: number = .5;
    pingIntervalId?: number;
    log: LogMessage[];
    maps: MapManager;

    constructor() {
        this.responseCallbacks = {};
        this.eventCallbacks = {};

        this.tiles = new Image();

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

    loadManifest(manifest_url: string, cb: DataStoreCallback) {
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

    loadTiles(cb: DataStoreCallback) {
        const loaded = () => {
            cb.onLoaded();
        };
        this.tiles.onload = loaded;
        if (this.manifest)
            this.tiles.src = this.manifest.tiles_url;
    }

    get music() {
        return this.manifest ? this.manifest.music : null;
    }

    onPing() {
        const fps = this.frames / PING_DELAY;
        const kb = this.bytes / PING_DELAY / 1024;
        var _this = this;
        this.send({ping: new Date().getTime()}, (pong: {pong: number}) => {
            const time = (new Date().getTime()) - pong.pong;
            const msg = sprintf("fps=%s / kb/s=%.02f / time=%s", fps, kb, time);
            _this.debugLog(msg);
            console.log(msg);
        });
        this.frames = this.bytes = 0;
    }

    connect(view: ConnectionListener, profile: PlayerProfile) {
        if (!this.manifest) {
            return;
        }
        this.socket = new WebSocket(this.manifest.socket_url);
        this.socket.binaryType = "arraybuffer";

        this.socket.addEventListener('open', (event) => {
            if (!this.socket) {
                return;
            }

            this.pingIntervalId = window.setInterval(this.onPing.bind(this), PING_DELAY * 1000);
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
                    this.addLog(LogType.NOTICE, msg.notice);
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

    send(obj: any, callback?: ResponseCallback) {
        // console.log(obj);
        if (!this.socket || this.socket.readyState !== 1) {
            return;
        }
        if (callback) {
            this.requestId++;
            obj._id = this.requestId;
            this.responseCallbacks[obj._id] = callback;
        }
        this.socket.send(encode(obj));
    }

    addEventListener(event: string, callback: EventCallback) {
        this.eventCallbacks[event] = callback;
    }

    cancelEventListener(event: string) {
        delete this.eventCallbacks[event];
    }

    save(storage: Storage) {
        storage.setItem("settings", JSON.stringify(this.settings));
    }

    load(storage: Storage) {
        const settings = storage.getItem("settings");
        if (settings)
            this.settings = JSON.parse(settings);
    }

    updateMap(frame: FrameUpdateMessage) {
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

    dumpMap(map: number[][]) {
        const parts = [];
        for (let y=0; y<map.length; y++) {
            const row = map[y];
            parts.push(row.join(","));
        }
        console.log(parts.join("\n") + "\n");
    }

    addLog(log_type: LogType, message: string){
        this.log.unshift({type: log_type, message: message});
        while(this.log.length > LOG_LIMIT) {
            this.log.pop();
        }
        if (this.eventCallbacks["_log"]) {
            this.eventCallbacks["_log"]();
        }
    }

    debugLog(msg: string) {
        this.addLog(LogType.DEBUG, msg);
    }

    incrementScale(step: number) {
        this.scale += step;
        if (this.scale < .25)
            this.scale = .25;
        else if (this.scale > 1.5)
            this.scale = 1.5;
    }
}

DataStore.instance = new DataStore();


class SfxUtil {
    static musicPlayer?: HTMLAudioElement;

    static playMusic(url: string) {
        SfxUtil.stopMusic();
        SfxUtil.musicPlayer = new Audio(url);
        SfxUtil.musicPlayer.play();
    }

    static stopMusic() {
        if (SfxUtil.musicPlayer) {
            SfxUtil.musicPlayer.pause();
            SfxUtil.musicPlayer = undefined;
        }
    }
    static shuffleMusic() {
        if (!DataStore.instance.settings.playMusic)
            return;
        if (!DataStore.instance.music)
            return;
        const music = choice(DataStore.instance.music);
        SfxUtil.playMusic(music);
    }
}

class GfxUtil {
    static drawTile(ctx: CanvasRenderingContext2D, x: number, y: number, tile_index: number, width?: number, height?: number) {
        const ds = DataStore.instance;
        if (!ds.tileset)
            return;

        const pos = ds.tileset.tilemap[tile_index][0];
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

    static fillTile(ctx: CanvasRenderingContext2D, x: number, y: number, color: string, width?: number, height?: number) {
        const ds = DataStore.instance;
        if (!ds.tileset)
            return;

        const tilesize = ds.tileset.tilesize * ds.scale;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, width || tilesize, height || tilesize);
    }
}

class MapRenderer {

    static renderObjects(ctx: CanvasRenderingContext2D, msg: FrameUpdateMessage) {

        if (!DataStore.instance.tileset)
            return;

        const orig_tilesize = DataStore.instance.tileset.tilesize;
        const tilesize = orig_tilesize * DataStore.instance.scale; // scaled
        const canvas_width = ctx.canvas.clientWidth;
        const canvas_height = ctx.canvas.clientHeight;

        const canvas_tile_width = Math.floor(canvas_width / tilesize);
        const canvas_tile_height = Math.floor(canvas_height / tilesize);

        const map = DataStore.instance.maps[msg.id];
        const tile_min_x = msg.x - Math.floor(canvas_tile_width/2);
        const tile_min_y = msg.y - Math.floor(canvas_tile_height/2);
        for (let y=0; y<canvas_tile_height; y++) {
            const row_idx = tile_min_y + y;
            if (row_idx < 0)
                continue;
            const row = map[row_idx];
            if (!row)
                continue;

            for (let x=0; x<canvas_tile_width; x++) {
                const cell_idx = tile_min_x + x;
                if (cell_idx in row) {
                    const tile_index = row[cell_idx];
                    if (tile_index > 0) {
                        const [target_x, target_y] = [x * tilesize, y * tilesize];
                        GfxUtil.drawTile(ctx, target_x, target_y, tile_index, tilesize);
                    }
                }
            }
        }

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

                const tile_index = cell[1];
                if (tile_index > 0) {
                    GfxUtil.drawTile(ctx, target_x, target_y, tile_index, tilesize);
                }

                for (let i=2; i<row[x].length; i++) {
                    const obj_index = cell[i];
                    if (obj_index >= 0)
                        GfxUtil.drawTile(ctx, target_x, target_y, obj_index, tilesize, tilesize);
                }
            }
        }
    }

    static renderFOV(ctx: CanvasRenderingContext2D, msg: FrameUpdateMessage) {

        if (!DataStore.instance.tileset)
            return;

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

    static renderUI(ctx: CanvasRenderingContext2D, clicked: [number, number] | null) {

        if (!DataStore.instance.tileset)
            return;

        const orig_tilesize = DataStore.instance.tileset.tilesize;
        const tilesize = orig_tilesize * DataStore.instance.scale; // scaled

        if (clicked) {
            const [clickedX, clickedY] = clicked;
            const [target_x, target_y] = [
                clickedX - Math.floor(tilesize/2),
                clickedY - Math.floor(tilesize/2),
            ];

            var grd = ctx.createRadialGradient(target_x, target_y, 0, target_x, target_y, tilesize);
            grd.addColorStop(0, "rgba(200, 0, 0, .5)");
            grd.addColorStop(1, "rgba(200, 0, 0, 0)");

            // Fill with gradient
            ctx.fillStyle = grd;
            ctx.fillRect(target_x - tilesize, target_y - tilesize, 2 * tilesize, 2 * tilesize);
        }
    }

    static renderMap(ctx: CanvasRenderingContext2D, msg: FrameUpdateMessage, clicked: [number, number]|null) {
        MapRenderer.renderObjects(ctx, msg);
        MapRenderer.renderFOV(ctx, msg);
        MapRenderer.renderUI(ctx, clicked);
    }

    static clearMap(ctx: CanvasRenderingContext2D) {
        ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }

    static redrawMiniMap(ctx: CanvasRenderingContext2D, map: number[][], scale: number) {
        if (!DataStore.instance.tileset)
            return;

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

    static renderMiniMap(ctx: CanvasRenderingContext2D, scale: number, frame: FrameUpdateMessage) {
        if (!DataStore.instance.tileset)
            return;

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

    static redrawMap(ctx: CanvasRenderingContext2D, map: number[][][]) {
        if (!DataStore.instance.tileset)
            return;

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

interface DialogProps {
    children: JSX.Element[] | JSX.Element;
    title: string;
    callback: () => void;
}


const Dialog = (props: DialogProps) => {
    return (
        <div className="dialog">
            <div className="dialog-titlebar">
                <a className="dialog-close" onClick={() => props.callback()} href="?close"><strong>&#10005;</strong></a>
                <strong>{props.title}</strong>
            </div>
            <div className="dialog-body">
                {props.children}
            </div>
        </div>
    );
}

const HelpDialog = (props: DialogProps) => {
    return (
        <Dialog title="Help" callback={props.callback}>
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


interface Item {
    name: string;
    equipped: boolean;
}


interface InventoryItemProps {
    onItemClick(item: Item): void;
    item: Item;
}

const InventoryItem = (props: InventoryItemProps) => {

    const canvas = useRef(null);
    const className = props.item.equipped ? "inventory-item equipped" : "inventory-item";

    useEffect(() => {
        if (canvas.current !== null) {
            const ctx = canvas.current.getContext("2d");
            GfxUtil.drawTile(ctx, 0, 0, props.item.idx);
        }
    });

    return (
        <div className={className} onClick={() => props.onItemClick(props.item) }>
            <canvas tabIndex="0" ref={canvas} width={DataStore.instance.tileset.tilesize} height={DataStore.instance.tileset.tilesize} />
            <p className="inventory-item-name">
                {props.item.name}
            </p>
        </div>
    );
}


const InventoryDialog = (props: DialogProps) => {

    const [inventory, setInventory] = useState([]);

    useEffect(() => {
        DataStore.instance.send({action: Actions.INVENTORY}, (msg) => {
            setInventory(msg.inventory);
        });
    });

    const onItemClick = (item: Item) => {
        if (item.type === ObjectTypes.EQUIPMENT) {
            DataStore.instance.send({action: Actions.EQUIP, item: item.id}, (msg) => {
                for (let i = 0; i < inventory.length; i++) {
                    if (inventory[i].id === msg.id) {
                        inventory[i].equipped = msg.equipped;
                        this.setState({"inventory": inventory});
                        break;
                    }
                }
            });
        } else if (item.type === ObjectTypes.ITEM) {
            DataStore.instance.send({action: Actions.USE, item: item.id}, (msg) => {
                this.setState({"inventory": inventory.filter((i) => {
                    return i.id !== msg.id;
                })});
            });
        }
    }

    const items = inventory.map((item) => {
        return <InventoryItem key={item.id} item={item} handler={onItemClick}/>;
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

    onUnload(event: any) {
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
        MapRenderer.renderMap(this.canvas.getContext("2d"),  msg, this.clicked);

        const minimap_ctx = this.minimap.getContext("2d");
        this.minimap_scale = minimap_ctx.width / msg.width;
        MapRenderer.renderMiniMap(minimap_ctx, this.minimap_scale, msg);
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
            MapRenderer.clearMap(this.minimap.getContext("2d"));
            if (event.entered in DataStore.instance.maps) {
                MapRenderer.redrawMiniMap(this.minimap.getContext("2d"), DataStore.instance.maps[event.entered],  this.minimap_scale);
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
