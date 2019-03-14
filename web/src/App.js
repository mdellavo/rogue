import React, {Component} from 'react';
import './App.css';

import msgpack from 'msgpack-lite'

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
        this.tile_cache = {};
    }

    get tileset() {
        return this.manifest ? this.manifest.tileset : null;
    }

    getTile(tile_index, cb) {
        if (!this.tile_cache[tile_index]) {
            this.tile_cache[tile_index] = new Image();
            this.tile_cache[tile_index].onload = cb;
            this.tile_cache[tile_index].src = this.manifest.tile_url + tile_index.toString();
        }
        return this.tile_cache[tile_index];
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
        let num_complete = 0;
        const loaded = () => {
            num_complete++;
            if (num_complete === this.tileset.num_tiles) {
                cb.onLoaded();
            }
        };

        for (let i=0; i<this.tileset.num_tiles; i++) {
            this.getTile(i, loaded);
        }
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
                if (msg._event === "frame")
                    this.frames++;
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
}

class GfxUtil {

    static drawTile(ctx, x, y, tile_index) {
        const img = DataStore.instance.getTile(tile_index);
        ctx.drawImage(img, x, y);
    }

    static fillTile(ctx, x, y, color) {
        const tilesize = DataStore.instance.tileset.tilesize;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, tilesize, tilesize);
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
                    <button className="dialog-close" onClick={this.handleClose}>&#10005;</button>
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
        return this.props.item.equipped ? "inventory-item equipped" : "inventory-item"
    }

    render() {
        return (
            <div className={this.getClassName()} onClick={this.onClick}>
                <img alt={this.props.item.type} src={DataStore.instance.getTile(this.props.item.idx).src}/>
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
                    return i.id !== msg.id
                })});
            });
        }

    }

    render() {
        const items = this.state.inventory.map((item) => {
            return <InventoryItem key={item.id} item={item} handler={this}/>
        });

        return (
            <Dialog title="Inventory" callback={this.props.callback}>
                <h4>Equipment</h4>
                <p>
                    Equip weapons and armor by clicking on them.<br/>
                    Use items by clicking on them.<br/>
                </p>
                <div class="inventory">
                    {items}
                </div>
                <div className="clear">
                </div>
            </Dialog>
        );
    }
}

class PlayerDialog extends Dialog {
    render() {
        return (
            <Dialog title="Player" callback={this.props.callback}>
            </Dialog>
        );
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

        this.closePlayerDialog = this.closePlayerDialog.bind(this);
        this.closeInventoryDialog = this.closeInventoryDialog.bind(this);
        this.closeHelpDialog = this.closeHelpDialog.bind(this);

        this.clicked = null;

        this.state = {
            showHelp: true,
            showInventory: false,
            showPlayer: false,
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

    componentDidMount() {
        DataStore.instance.addEventListener("frame", (msg) => { this.onFrame(msg.frame); });
        DataStore.instance.addEventListener("notice", (msg) => { this.onNotice(msg); });
        DataStore.instance.addEventListener("stats", (msg) => { this.onStats(msg.stats); });
        DataStore.instance.connect(this, this.props.profile);
        this.canvas.focus();
        this.shuffleMusic();
    }

    onConnected() {
        this.setState({connected: true, connecting: false});
    }

    onDisconnected() {
        this.setState({connected: false});
        SfxUtil.stopMusic();
    }

    onError() {
        this.setState({connected: false, error: true});
    }

     onFrame(frame) {
        const ctx = this.canvas.getContext("2d");
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

    onNotice(event) {
        const notices = this.state.notices;
        notices.unshift(event);
        while(notices.length > 10) {
            notices.pop();
        }
        this.setState({notices: notices});
        if (event.mood) {
            this.shuffleMusic();
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
        this.clicked =  [
            Math.floor((event.clientX - event.target.offsetLeft) / tilesize),
            Math.floor((event.clientY - event.target.offsetTop) / tilesize),
        ];
        console.log("clicked", this.clicked);
    }

    onMouseUp(event) {
        this.clicked = null;
    }

    showPlayerDialog() {
        this.setState({showPlayer: true});
    }

    showInventoryDialog() {
        this.setState({showInventory: true});
    }

    showHelpDialog() {
        this.setState({showHelp: true});
    }

    closePlayerDialog() {
        this.setState({showPlayer: false});
    }

    closeInventoryDialog() {
        this.setState({showInventory: false});
    }

    closeHelpDialog() {
        this.setState({showHelp: false});
    }

    shuffleMusic() {
        const music = choice(DataStore.instance.music);
        SfxUtil.playMusic(music);
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

        let helpDialog;
        if (this.state.showHelp) {
            helpDialog = <HelpDialog callback={this.closeHelpDialog}/>;
        }

        let playerDialog;
        if (this.state.showPlayer) {
            playerDialog = <PlayerDialog callback={this.closePlayerDialog}/>;
        }

        let inventoryDialog;
        if (this.state.showInventory) {
            inventoryDialog = <InventoryDialog callback={this.closeInventoryDialog} />;
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
            stats = (
                <div className="stats">
                    Health: {this.state.stats.hp >=0 ? this.state.stats.hp : 0} of {this.state.stats.tot}
                </div>
            );
        }

        return (
            <div>
                <div className="toolbar">
                    <button className="help" onClick={this.showHelpDialog}>Help</button>
                    <button className="player" onClick={this.showPlayerDialog}>Player</button>
                    <button className="inventory" onClick={this.showInventoryDialog}>Inventory</button>
                </div>

                {status}
                {stats}
                <canvas tabIndex="0" ref="canvas" width={704} height={704} onKeyDown={this.onKeyPress} onBlur={this.onBlur} onMouseDown={this.onMouseDown} onMouseUp={this.onMouseUp}XS/>

                <div className="notices">
                    {notices}
                </div>

                <div className="footer">
                    <a href="https://github.com/mdellavo/rogue/" target="_blank" rel="noopener noreferrer">Source code available on github @ mdellavo/rogue</a>
                </div>

                {helpDialog}
                {inventoryDialog}
                {playerDialog}
            </div>
        )
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
            <div className="connect">
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
    }

    onError() {
        this.setState({error: true})
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
