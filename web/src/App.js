import React, {Component} from 'react';
import './App.css';

import msgpack from 'msgpack-lite';

const API_URL = process.env.REACT_APP_API;
const PING_DELAY = 10;

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
        this.map = null;
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
        this.send({ping: new Date().getTime()}, (pong) => {
            const time = (new Date().getTime()) - pong.pong;
            if (console)
                console.log("fps=", fps, "kb/s=", kb, "time=", time);
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
        if (!this.map) {
            this.map = new Array(frame.height);
            for(var i=0; i<frame.height; i++) {
                this.map[i] = new Array(frame.width);
            }
        }

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

        const height = frame.frame.length;
        for (let y=0; y<height; y++) {
            const row = frame.frame[y];
            const width = row.length;
            for (let x=0; x<width; x++) {
                const tx = frame.y + y - Number.parseInt(height/2);
                const ty = frame.x + x - Number.parseInt(width/2);
                if (tx >= 0 && ty >= 0 && tx < frame.width && ty < frame.height)
                    this.map[ty][tx] = row[x][2];
            }
        }
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
    static renderMap(ctx, frame) {
        const tilesize = DataStore.instance.tileset.tilesize;
        for (let y=0; y<frame.length; y++) {
            const row = frame[y];
            for (let x=0; x<row.length; x++) {
                const [explored, in_fov, tile_index, obj_index] = row[x];
                const [target_x, target_y] = [x * tilesize, y * tilesize];

                if (explored) {
                    if (tile_index >= 0) {
                        GfxUtil.drawTile(ctx, target_x, target_y, tile_index);
                    }

                    if (!in_fov) {
                        GfxUtil.fillTile(ctx, target_x, target_y, "rgba(0, 0, 0, .5)");
                    } else if (obj_index >= 0) {
                        GfxUtil.drawTile(ctx, target_x, target_y, obj_index);
                    }
                } else {
                    GfxUtil.fillTile(ctx, target_x, target_y, "black");
                }

                if (this.clicked) {
                    const [clickedX, clickedY] = this.clicked;
                    if (explored && x === clickedX && y === clickedY) {
                        GfxUtil.fillTile(ctx, target_x, target_y, "red");
                    }
                }
            }
        }
    }

    static renderMiniMap(ctx, scale, frame) {
        for (let y=0; y<frame.frame.length; y++) {
            const row = frame.frame[y];
            for (let x=0; x<row.length; x++) {
                const cx = (frame.x * scale) + (x * scale);
                const cy = (frame.y * scale) + (y * scale);

                var color;
                if (x in row) {
                    const idx = frame.frame[y][x][2];
                    color = idx >= 0 ? DataStore.instance.tileset.tilemap[idx][1] : "red";
                } else {
                    color = "red";
                }
                ctx.fillStyle = color;
                ctx.fillRect(cx, cy, scale + 1, scale + 1);
            }
        }
    }
}

class ProgressBar extends React.Component {
    constructor(props) {
        super(props);
        this.state = {"value": props.value, "max": props.max, "text": props.text};
    }

    setValue(value, max) {
        this.setState({"value": value, "max": max});
    }

    render() {
        return (
                <div className="progress-bar">
                    <span style={{width: this.state.max/this.state.value * 100 + "%"}}>{this.state.text}</span>
                </div>
        );
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
                    <a className="dialog-close" onClick={this.handleClose}><strong>&#10005;</strong></a>
                    <strong>{this.props.title}</strong>
                </div>
                <div className="dialog-body">
                    {this.props.children}
                </div>
            </div>
        );
    }
    handleClose() {
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
        this.onKeyPress = this.onKeyPress.bind(this);
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.showPlayerDialog = this.showPlayerDialog.bind(this);
        this.showInventoryDialog = this.showInventoryDialog.bind(this);
        this.showHelpDialog = this.showHelpDialog.bind(this);
        this.showSettingsDialog = this.showSettingsDialog.bind(this);
        this.closeDialogs = this.closeDialogs.bind(this);
        this.onUnload = this.onUnload.bind(this);

        this.clicked = null;

        this.state = {
            showHelp: true,
            showInventory: false,
            showPlayer: false,
            showSettings: false,
            notices: [],
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
        DataStore.instance.addEventListener("stats", (msg) => { this.onStats(msg.stats); });
        DataStore.instance.connect(this, this.props.profile);
        this.canvas.focus();
        SfxUtil.shuffleMusic();
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
        MapRenderer.renderMap(this.canvas.getContext("2d"), msg.frame);
        MapRenderer.renderMiniMap(this.minimap.getContext("2d"), 2, msg);
    }

    onNotice(event) {
        const notices = this.state.notices;
        notices.unshift(event);
        while(notices.length > 10) {
            notices.pop();
        }
        this.setState({notices: notices});
        if (event.mood) {
            SfxUtil.shuffleMusic();
        }
    }

    onStats(event) {
        this.setState({stats: event});
    }

    onKeyPress(event) {
        const key = event.key.toLowerCase();
        if (key === "w")
            DataStore.instance.send({action: Actions.MOVE, direction: [0, -1]});
        else if (key === "a")
            DataStore.instance.send({action: Actions.MOVE, direction: [-1, 0]});
        else if (key === "s")
            DataStore.instance.send({action: Actions.MOVE, direction: [0, 1]});
        else if (key === "d")
            DataStore.instance.send({action: Actions.MOVE, direction: [1, 0]});
        else if (key === "p")
            DataStore.instance.send({action: Actions.PICKUP});
        else if (key === ".")
            DataStore.instance.send({action: Actions.ENTER});
        else if (key === "f")
            DataStore.instance.send({action: Actions.MELEE});
        else if (key === "i")
            if (this.state.showInventory)
                this.closeInventoryDialog();
            else
                this.showInventoryDialog();
        else if (key === "h")
            if (this.state.showHelp)
                this.closeHelpDialog();
            else
                this.showHelpDialog();
    }

    onBlur() {
        this.canvas.focus();
    }

    onMouseDown(event) {
        const tilesize = DataStore.instance.tileset.tilesize;
        const pos = [
            Math.floor((event.clientX - event.target.offsetLeft) / tilesize),
            Math.floor((event.clientY - event.target.offsetTop) / tilesize),
        ];
        this.clicked = pos;
        DataStore.instance.send({action: Actions.WAYPOINT, pos: pos});
    }

    onMouseUp(event) {
        this.clicked = null;
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

    showHelpDialog() {
        this.showDialog({showHelp: true});
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

        const notices = this.state.notices.map((notice, i) => {
            return (
                <div key={i}>
                    {notice.notice}
                </div>
            );
        });

        let stats;
        if (this.state.stats.tot) {
            const text = (this.state.stats.hp >=0 ? this.state.stats.hp : 0) + " of " + this.state.stats.tot;
            stats = (
                <div className="stats">
                    Health:
                    <ProgressBar value={this.state.stats.hp} max={this.state.stats.tot} text={text}/>
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
                <canvas className="playarea" tabIndex="0" ref="canvas" width={704} height={704} onKeyDown={this.onKeyPress} onBlur={this.onBlur} onMouseDown={this.onMouseDown} onMouseUp={this.onMouseUp}/>

                <div className="notices">
                    {notices}
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
        if (this.state.profile)
            contents = <CanvasView profile={this.state.profile}/>;
        else if (this.state.loaded)
            contents = <JoinView handler={this}/>;
        else if (this.state.error)
            contents = <ErrorView/>;
        else
            contents = <LoadingView />;

        return (
            <div className="App">
                {contents}
            </div>
        );
    }
}

export default App;
