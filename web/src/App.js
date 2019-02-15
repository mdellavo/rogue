import React, {Component} from 'react';
import './App.css';

import msgpack from 'msgpack-lite'

const API_URL = process.env.REACT_APP_API;
const PING_DELAY = 10;

function decode(data) {
    return msgpack.decode(new Uint8Array(data));
}

function encode(obj) {
    return msgpack.encode(obj);
}

class DataStore {
    constructor() {
        this.tiles = new Image();
        this.manifest = null;
        this.socket = null;
        this.responseCallbacks = {};
        this.eventCallbacks = {};
        this.requestId = 0;
        this.pingIntervalId = null;
        this.frames = 0;
        this.bytes = 0;
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
        this.tiles.addEventListener("load",  () => {
            cb.onLoaded()
        }, false);
        this.tiles.src = this.manifest.tiles_url;
    }

    getTile(tile_index) {
        const tilesize =  this.manifest.tileset.tilesize;
        const [tx, ty] = this.manifest.tileset.tilemap[tile_index].coords;
        return [tx * tilesize, ty * tilesize, tilesize, tilesize];
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

    connect(view) {
        this.socket  = new WebSocket(this.manifest.socket_url);
        this.socket.binaryType = "arraybuffer";

        this.socket.addEventListener('open', (event) => {
            this.pingIntervalId = setInterval(this.onPing.bind(this), PING_DELAY * 1000);
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

class GfxUtil {

    static drawTile(ctx, x, y, tile_index) {
        const [tile_x, tile_y, tile_w, tile_h] = DataStore.instance.getTile(tile_index);
        ctx.drawImage(
            DataStore.instance.tiles,
            tile_x, tile_y, tile_w, tile_h,
            x, y, tile_w, tile_h
        )
    }

    static getTile(tile_index) {
        const [tile_x, tile_y, tile_w, tile_h] = DataStore.instance.getTile(tile_index);

        const canvas = document.createElement('canvas');
        canvas.width = tile_w;
        canvas.height = tile_h;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(
            DataStore.instance.tiles,
            tile_x, tile_y, tile_w, tile_h,
            0, 0, tile_w, tile_h
        );
        return canvas.toDataURL("image/png");
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
                <p/>
                <h4>Equipment</h4>
                <p>
                    Items can be equipped in inventory by clicking on them.
                </p>
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
        this.props.handler.onItemClick(this.props.item.id);
    }

    getClassName() {
        return this.props.item.equipped ? "inventory-item equipped" : "inventory-item"
    }

    render() {
        return (
            <div className={this.getClassName()} onClick={this.onClick}>
                <img alt={this.props.item.type} src={this.props.dataURL}/>
                <p className="inventory-item-name">
                    {this.props.item.type}
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

    componentDidMount() {
        DataStore.instance.send({action: "inventory"}, (msg) => {
            this.setState({"inventory": msg.inventory});
        });
    }

    componentWillUnmount() {

    }

    onItemClick(id) {
        DataStore.instance.send({action: "equip", item: id}, (msg) => {
            for(let i=0; i<this.state.inventory.length; i++) {
                const item = this.state.inventory[i];
                if (item.id === id) {
                    item.equipped = msg.equipped;
                }
            }

            this.setState({"inventory": this.state.inventory});
        });
    }

    render() {
        const items = this.state.inventory.map((item) => {
            return <InventoryItem key={item.id} item={item} handler={this} dataURL={GfxUtil.getTile(item.idx)}/>
        });

        return (
            <Dialog title="Inventory" callback={this.props.callback}>
                {items}
                <div className="clear"></div>
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
        
        this.showPlayerDialog = this.showPlayerDialog.bind(this);
        this.showInventoryDialog = this.showInventoryDialog.bind(this);
        this.showHelpDialog = this.showHelpDialog.bind(this);

        this.closePlayerDialog = this.closePlayerDialog.bind(this);
        this.closeInventoryDialog = this.closeInventoryDialog.bind(this);
        this.closeHelpDialog = this.closeHelpDialog.bind(this);

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
        DataStore.instance.connect(this);
        this.canvas.focus();
    }

    onConnected() {
        this.setState({connected: true, connecting: false});
    }

    onDisconnected() {
        this.setState({connected: false});
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
    }

    onStats(event) {
        this.setState({stats: event});
    }

    onKeyPress(event) {
        if (event.key === "w")
            DataStore.instance.send({action: "move", direction: [0, -1]});
        else if (event.key === "a")
            DataStore.instance.send({action: "move", direction: [-1, 0]});
        else if (event.key === "s")
            DataStore.instance.send({action: "move", direction: [0, 1]});
        else if (event.key === "d")
            DataStore.instance.send({action: "move", direction: [1, 0]});
        else if (event.key === "p")
            DataStore.instance.send({action: "pickup"});
        else if (event.key === ".")
            DataStore.instance.send({action: "enter"});
        else if (event.key === "f")
            DataStore.instance.send({action: "melee"});
        else if (event.key === "i")
            if (this.state.showInventory)
                this.closeInventoryDialog();
            else
                this.showInventoryDialog();
        else if (event.key === "h")
            if (this.state.showHelp)
                this.closeHelpDialog();
            else
                this.showHelpDialog();
    }

    onBlur() {
        this.canvas.focus();
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
                <canvas tabIndex="0" ref="canvas" width={704} height={704} onKeyDown={this.onKeyPress} onBlur={this.onBlur}/>

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

class App extends Component {

    constructor(props) {
        super(props);
        this.state = {loaded: false, error: false};
    }

    componentDidMount() {
        DataStore.instance.loadManifest(API_URL,  this);
    }

    onLoaded() {
        this.setState({loaded: true});
    }

    onError() {
        this.setState({error: true})
    }

    render() {

        let contents;
        if (this.state.loaded)
            contents = <CanvasView/>;
        else if (this.state.error)
            contents = <ErrorView/>;
        else
            contents = <LoadingView/>;

        return (
            <div className="App">
                {contents}
            </div>
        );
    }
}

export default App;
