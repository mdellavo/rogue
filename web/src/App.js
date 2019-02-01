import React, {Component} from 'react';
import './App.css';

import msgpack from 'msgpack-lite'

const API_URL = process.env.REACT_APP_API;
const TILES_URL = "/tiles.png";

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
            console.log("manifest", this.manifest);
            this.loadTiles(cb);
        }).catch(error => {
            console.log("error", error);
            cb.onError(error);
        });
    }

    loadTiles(cb) {
        this.tiles.addEventListener("load",  () => {
            console.log("tiles loaded");
            cb.onLoaded()
        }, false);
        console.log("loading tiles", TILES_URL);
        this.tiles.src = TILES_URL;
    }

    getTile(tile_index) {
        const tilesize =  this.manifest.tileset.tilesize;
        const [tx, ty] = this.manifest.tileset.tilemap[tile_index].coords;
        return [tx * tilesize, ty * tilesize, tilesize, tilesize];
    }

    connect(view) {
        console.log("connecting to websocket");

        this.socket  = new WebSocket(this.manifest.socket_url);
        this.socket.binaryType = "arraybuffer";

        this.socket.addEventListener('open', (event) => {
            console.log("socket connected");
            view.onConnected(event);
        });

        this.socket.addEventListener('message', (event) => {
            const msg = decode(event.data);

            if (msg._id && this.responseCallbacks[msg._id]) {
                this.responseCallbacks[msg._id](msg);
                delete this.responseCallbacks[msg._id];
            } else if (msg.frame) {
                view.onFrame(msg.frame);
            }
      });

        this.socket.addEventListener('close', (event) => {
            console.log("socket closed");
            view.onDisconnected(event);
        });

        this.socket.addEventListener('error', (event) => {
            console.log("socket error", event);
            view.onError(event);
        });
    }

    send(obj, callback) {
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
                <code>
                    WASD to move<br/>
                    . to enter doors<br/>
                    p to pickup items<br/>
                </code>
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
        const items = this.state.inventory.map((item) => {
            return <InventoryItem key={item.idx} type={item.type} dataURL={GfxUtil.getTile(this.props.datastore, item.idx)}/>
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

        this.state = {showHelp: false, showInventory: false, showPlayer: false};
    }

    get canvas() {
        return this.refs.canvas;
    }

    componentDidMount() {
        this.props.datastore.connect(this);
        this.canvas.focus();
    }

    onConnected() {

    }

    onDisconnected() {

    }

    onError() {

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
    }

    onBlur() {
        this.canvas.focus();
    }

    showPlayerDialog(e) {
        this.setState({showPlayer: true});
    }

    showInventoryDialog(e) {
        this.setState({showInventory: true});
    }

    showHelpDialog(e) {
        this.setState({showHelp: true});
    }

    closePlayerDialog(e) {
        this.setState({showPlayer: false});
    }

    closeInventoryDialog(e) {
        this.setState({showInventory: false});
    }

    closeHelpDialog(e) {
        this.setState({showHelp: false});
    }

    render() {

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

        return (
            <div>
                <div className="toolbar">
                    <button className="help" onClick={this.showHelpDialog}>Help</button>
                    <button className="player" onClick={this.showPlayerDialog}>Player</button>
                    <button className="inventory" onClick={this.showInventoryDialog}>Inventory</button>
                </div>
                <canvas tabIndex="0" ref="canvas" width={704} height={704} onKeyDown={this.onKeyPress} onBlur={this.onBlur}/>
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
        <div className="error">
            An error - shit
        </div>
    );
}

function LoadingView() {
    return (
        <div className="loading">
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
