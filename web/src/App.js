import React, {Component} from 'react';
import './App.css';

import msgpack from 'msgpack-lite'

const API_URL = "http://localhost:8080/";

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
        console.log("loading tiles", this.manifest.tiles_url);
        this.tiles.src = this.manifest.tiles_url;
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
            // console.log("message", msg);
            if (msg.frame)
                view.onFrame(msg.frame);
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

    send(obj) {
        this.socket.send(encode(obj));
    }
}

class CanvasView extends React.Component {
    constructor(props) {
        super(props);
        this.onBlur = this.onBlur.bind(this);
        this.onKeyPress = this.onKeyPress.bind(this);
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
        const tiles = this.props.datastore.tiles;
        const ctx = this.canvas.getContext("2d");
        const tilesize = this.props.datastore.tileset.tilesize;

        for (let y=0; y<frame.length; y++) {
            const row = frame[y];
            for (let x=0; x<row.length; x++) {
                const [explored, in_fov, tile_index, obj_index] = row[x];
                const [target_x, target_y] = [x * tilesize, y * tilesize];

                if (explored) {
                    if (tile_index >= 0) {
                        const [tile_x, tile_y, tile_w, tile_h] = this.props.datastore.getTile(tile_index);
                        ctx.drawImage(
                            tiles,
                            tile_x, tile_y, tile_w, tile_h,
                            target_x, target_y, tilesize, tilesize
                        )
                    }

                    if (!in_fov) {
                        ctx.fillStyle = "rgba(0, 0, 0, .5)";
                        ctx.fillRect(target_x, target_y, tilesize, tilesize);
                    } else if (obj_index >= 0) {
                        const [tile_x, tile_y, tile_w, tile_h] = this.props.datastore.getTile(obj_index);
                        ctx.drawImage(
                            tiles,
                            tile_x, tile_y, tile_w, tile_h,
                            target_x, target_y, tilesize, tilesize
                        )
                    }

                } else {
                    ctx.fillStyle = 'black';
                    ctx.fillRect(target_x, target_y, tilesize, tilesize);
                }

            }
        }
    }

    onKeyPress(event) {
        console.log("event", event.key);

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

    render() {
        return <canvas tabIndex="0" ref="canvas" width={640} height={640} onKeyDown={this.onKeyPress} onBlur={this.onBlur}/>
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
