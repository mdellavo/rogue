import React, {Component} from 'react';
import './App.css';

import msgpack from 'msgpack-lite'

const API_URL = process.env.REACT_APP_API;
const TILES_URL = "/tiles.png";
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
        this.requestId = 0;
        this.pingIntervalId = null;
        this.frames = 0;
        this.frameBytes = 0;
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
        this.tiles.src = TILES_URL;
    }

    getTile(tile_index) {
        const tilesize =  this.manifest.tileset.tilesize;
        const [tx, ty] = this.manifest.tileset.tilemap[tile_index].coords;
        return [tx * tilesize, ty * tilesize, tilesize, tilesize];
    }

    onPing() {
        const fps = this.frames / PING_DELAY;
        const kb = this.frameBytes / PING_DELAY / 1024
        this.send({ping: new Date().getTime()}, (pong) => {
            const time = (new Date().getTime()) - pong.pong;
            if (console)
                console.log("fps=", fps, "kb/s=", kb, "time=", time);
        });
        this.frames = this.frameBytes = 0;
    }

    onFrame(frameBytes) {
        this.frames++;
        this.frameBytes += frameBytes;
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

            if (msg._id && this.responseCallbacks[msg._id]) {
                this.responseCallbacks[msg._id](msg);
                delete this.responseCallbacks[msg._id];
            } else if (msg.frame) {
                this.onFrame(event.data.byteLength);
                view.onFrame(msg.frame);
            } else if (msg.notice) {
                view.onNotice(msg);
            } else if (msg.stats) {
                view.onStats(msg.stats);
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
}


class GfxUtil {

    static drawTile(datastore, ctx, x, y, tile_index) {
        const [tile_x, tile_y, tile_w, tile_h] = datastore.getTile(tile_index);
        ctx.drawImage(
            datastore.tiles,
            tile_x, tile_y, tile_w, tile_h,
            x, y, tile_w, tile_h
        )
    }

    static getTile(datastore, tile_index) {
        const [tile_x, tile_y, tile_w, tile_h] = datastore.getTile(tile_index);

        const canvas = document.createElement('canvas');
        canvas.width = tile_w;
        canvas.height = tile_h;

        const ctx = canvas.getContext("2d");
        ctx.drawImage(
            datastore.tiles,
            tile_x, tile_y, tile_w, tile_h,
            0, 0, tile_w, tile_h
        );
        return canvas.toDataURL("image/png");
    }

    static fillTile(datastore, ctx, x, y, color) {
        const tilesize = datastore.tileset.tilesize;
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
                <code><pre>
                    <strong>W/A/S/D</strong> - to move<br/>
                    <strong>.</strong>       - to enter doors<br/>
                    <strong>p</strong>       - to pickup items<br/>
                    <strong>f</strong>       - to attack surrounding<br/>
                    <strong>i</strong>       - to show/hide inventory<br/>
                    <strong>h</strong>       - to show/hide help<br/>
                </pre></code>
            </Dialog>
        );
    }
}

class InventoryItem extends React.Component {
    render() {
        return (
            <div className="inventory-item">
                <img alt={this.props.type} src={this.props.dataURL}/>
                <p className="inventory-item-name">
                    {this.props.type}
                </p>
            </div>
        );
    }
}


class InventoryDialog extends Dialog {

    constructor(props) {
        super(props);
        this.state = {"inventory": []}
    }

    componentDidMount() {
        this.props.datastore.send({action: "inventory"}, (msg) => {
            this.setState({"inventory": msg.inventory});
        });
    }

    render() {
        const items = this.state.inventory.map((item, i) => {
            return <InventoryItem key={i} type={item.type} dataURL={GfxUtil.getTile(this.props.datastore, item.idx)}/>
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
        this.props.datastore.connect(this);
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
        const tilesize = this.props.datastore.tileset.tilesize;

        for (let y=0; y<frame.length; y++) {
            const row = frame[y];
            for (let x=0; x<row.length; x++) {
                const [explored, in_fov, tile_index, obj_index] = row[x];
                const [target_x, target_y] = [x * tilesize, y * tilesize];

                if (explored) {
                    if (tile_index >= 0) {
                        GfxUtil.drawTile(this.props.datastore, ctx, target_x, target_y, tile_index);
                    }

                    if (!in_fov) {
                        GfxUtil.fillTile(this.props.datastore, ctx, target_x, target_y, "rgba(0, 0, 0, .5)");
                    } else if (obj_index >= 0) {
                        GfxUtil.drawTile(this.props.datastore, ctx, target_x, target_y, obj_index);
                    }
                } else {
                    GfxUtil.fillTile(this.props.datastore, ctx, target_x, target_y, "black");
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
            this.props.datastore.send({action: "move", direction: [0, -1]});
        else if (event.key === "a")
            this.props.datastore.send({action: "move", direction: [-1, 0]});
        else if (event.key === "s")
            this.props.datastore.send({action: "move", direction: [0, 1]});
        else if (event.key === "d")
            this.props.datastore.send({action: "move", direction: [1, 0]});
        else if (event.key === "p")
            this.props.datastore.send({action: "pickup"});
        else if (event.key === ".")
            this.props.datastore.send({action: "enter"});
        else if (event.key === "f")
            this.props.datastore.send({action: "melee"});
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
            helpDialog = <HelpDialog callback={this.closeHelpDialog} datastore={this.props.datastore}/>;
        }

        let playerDialog;
        if (this.state.showPlayer) {
            playerDialog = <PlayerDialog callback={this.closePlayerDialog} datastore={this.props.datastore}/>;
        }

        let inventoryDialog;
        if (this.state.showInventory) {
            inventoryDialog = <InventoryDialog callback={this.closeInventoryDialog} datastore={this.props.datastore}/>;
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
        this.datastore = new DataStore();
        this.datastore.loadManifest(API_URL,  this);
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
            contents = <CanvasView datastore={this.datastore}/>;
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
