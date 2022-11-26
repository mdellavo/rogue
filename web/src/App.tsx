import React, { FormEvent, KeyboardEvent, WheelEvent, MouseEvent, TouchEvent, Component, useEffect, useState, useRef, ChangeEvent } from 'react';
import './App.css';

import msgpack from 'msgpack-lite';
import {sprintf} from 'sprintf-js';

const API_URL = process.env.REACT_APP_API;
const PING_DELAY = 10;
const LOG_LIMIT = 10;

enum PlayerState {
  DISCONNECTED = 0,
  CONNECTING = 1,
  CONNECTED = 2,
  ERROR = -1,
};

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

interface PlayerProfile {
  name: string;
}

interface PlayerStats {
  [stat: string]: any;
}

interface PlayerAttributes {
  [attribute: string]: any;
}

interface PlayerInfo {
  name: string;
  stats: PlayerStats;
  attributes: PlayerAttributes;
}

interface Item {
  id: string;
  name: string;
  equipped: boolean;
  idx: number;
  type: string;
}

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


type Map = number[][][];

type Position = [number, number];

type MapManager = {
  [key: string]: Map;
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

interface NoticeMessage extends ServerMessage {
  notice: string;
  mood: boolean;
  entered: string;
}

interface PlayerStatsMessage extends ServerMessage {
  stats: PlayerStats;
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

    this.socket.addEventListener('open', (event: Event) => {
      if (!this.socket) {
        return;
      }

      this.pingIntervalId = window.setInterval(this.onPing.bind(this), PING_DELAY * 1000);
      this.socket.send(encode({"profile": profile}));
      view.onConnected(event);
    });

    this.socket.addEventListener('message', (event: MessageEvent) => {
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

    this.socket.addEventListener('close', (event: Event) => {
      console.log("ws close", event);
      clearInterval(this.pingIntervalId);
      view.onDisconnected(event);
    });

    this.socket.addEventListener('error', (event: Event) => {
      console.log("ws error", event);
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
          const tile_index = row[cell_idx][1];
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
        const in_range = (
          x_idx >= frame_min_x &&
          x_idx < frame_max_x &&
          y_idx >= frame_min_y &&
          y_idx < frame_max_y
        );
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

  static renderUI(ctx: CanvasRenderingContext2D, clicked: Position | null) {

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

  static renderMap(ctx: CanvasRenderingContext2D, msg: FrameUpdateMessage, clicked: Position|null) {
    MapRenderer.renderObjects(ctx, msg);
    MapRenderer.renderFOV(ctx, msg);
    MapRenderer.renderUI(ctx, clicked);
  }

  static clearMap(ctx: CanvasRenderingContext2D) {
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  }

  static redrawMiniMap(ctx: CanvasRenderingContext2D, map: Map, scale: number) {
    if (!DataStore.instance.tileset)
      return;

    for (let y=0; y<map.length; y++) {
      const row = map[y];
      for (let x=0; x<row.length; x++) {
        const cell = map[y][x];
        const idx = cell ? cell[1] : -1;
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
  children?: JSX.Element[] | JSX.Element;
  title: string;
  callback: () => void;
}


const Dialog = (props: DialogProps) => {
  return (
    <div className="dialog">
      <div className="dialog-titlebar">
        <a className="dialog-close" onClick={(e) => { e.preventDefault(); props.callback()}} href="?close"><strong>&#10005;</strong></a>
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

interface InventoryItemProps {
  onItemClick(item: Item): void;
  item: Item;
}

const InventoryItem = (props: InventoryItemProps) => {

  const canvas = useRef<HTMLCanvasElement|null>(null);
  const className = props.item.equipped ? "inventory-item equipped" : "inventory-item";

  useEffect(() => {
    if (canvas != null && canvas.current != null) {
      const canvasObj = canvas.current as HTMLCanvasElement;
      const ctx = canvasObj.getContext("2d");
      if (ctx != null) {
        GfxUtil.drawTile(ctx, 0, 0, props.item.idx);
      }
    }
  });

  return (
    <div className={className} onClick={() => props.onItemClick(props.item) }>
      <canvas tabIndex={0} ref={canvas} width={DataStore?.instance?.tileset?.tilesize} height={DataStore?.instance?.tileset?.tilesize} />
      <p className="inventory-item-name">
        {props.item.name}
      </p>
    </div>
  );
}


const InventoryDialog = (props: DialogProps) => {

  const [inventory, setInventory] = useState<Item[]>([]);

  useEffect(() => {
    DataStore.instance.send({action: Action.INVENTORY}, (msg) => {
      setInventory(msg.inventory);
    });
  });

  const onItemClick = (item: Item) => {
    if (item.type === ObjectType.EQUIPMENT) {
      DataStore.instance.send({action: Action.EQUIP, item: item.id}, (msg) => {
        for (let i = 0; i < inventory.length; i++) {
          if (inventory[i].id === msg.id) {
            inventory[i].equipped = msg.equipped;
            setInventory(inventory);
            break;
          }
        }
      });
    } else if (item.type === ObjectType.ITEM) {
      DataStore.instance.send({action: Action.USE, item: item.id}, (msg) => {
        setInventory(inventory.filter((i) => {
          return i.id !== msg.id;
        }));
      });
    }
  }

  const items = inventory.map((item) => {
    return <InventoryItem key={item.id} item={item} onItemClick={onItemClick}/>;
  });

  return (
    <Dialog title="Inventory" callback={props.callback}>
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

interface PlayerValuesProps {
  [values: string]: any,
}

const PlayerValues = (props: PlayerValuesProps) => {

  const parts = [];
  for (var k in props.values) {
    parts.push(<div key={k}>{k}: <strong>{props.values[k]}</strong></div>);
  }

  return (
    <div className="player-values">
      {parts}
    </div>
  );
};


interface PlayerDialogProps {
  callback: () => void;
}

const PlayerDialog = (props: PlayerDialogProps) => {

  const [playerInfo, setPlayerInfo] = useState<null|PlayerInfo>(null);

  useEffect(() => {
    DataStore.instance.send({action: Action.PLAYER_INFO}, (msg) => {
      setPlayerInfo(msg.player_info);
    });
  }, []);

  var body = [];
  if (playerInfo) {
    body.push(<h4 key="h-attrs">Attributes</h4>);
    body.push(<PlayerValues className="player-attrs" key="attrs" values={playerInfo.attributes}/>);
    body.push(<h4 key="h-stats">Stats</h4>);
    body.push(<PlayerValues className="player-stats" key="stats" values={playerInfo.stats}/>);
  } else {
    body.push(<div key="loading">Loading...</div>);
  }

  return (
    <Dialog title={playerInfo ? playerInfo.name : "Player"} callback={props.callback}>
      {body}
    </Dialog>
  );
};


interface BasicDialogProps {
  callback: () => void;
}

const SettingsDialog = (props: BasicDialogProps) => {

  const onMusicChanged = (event: React.ChangeEvent<HTMLInputElement>) => {
    DataStore.instance.settings.playMusic = event.target.checked;
    if (event.target.checked)
      SfxUtil.shuffleMusic();
    else
      SfxUtil.stopMusic();

    DataStore.instance.save(window.localStorage);
  };

  return (
    <Dialog title="Settings" callback={props.callback}>
      <div>
        <input type="checkbox" name="play_music" defaultChecked={DataStore.instance.settings.playMusic} onChange={onMusicChanged} />
        <span>Music</span>
      </div>
    </Dialog>
  );
};

interface CanvasProps {
  profile: PlayerProfile,
}

interface PressedMap {
  [key: string]: boolean;
}

interface KeyHandler {
  [key: string]: () => void;
}

const CanvasView = (props: CanvasProps) => {

  console.log("new CanvasView");

  const canvas = useRef<HTMLCanvasElement>(null);
  const minimap = useRef<HTMLCanvasElement>(null);

  const pressed = useRef<PressedMap>({});
  const clicked = useRef<Position>();

  const [showHelp, setShowHelp] = useState(true);
  const [showInventory, setShowInventory] = useState(false);
  const [showPlayer, setShowPlayer] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [playerState, setPlayerState] = useState(PlayerState.CONNECTING);
  const [playerStats, setPlayerStats] = useState<null | PlayerStats>(null);

  const onUnload = (event: any) => {
    event.preventDefault();
    return "";
  };

  const connectionListener = {
    onConnected: (event: Event) => {
      setPlayerState(PlayerState.CONNECTED);
      window.addEventListener("beforeunload", onUnload);
    },
    onDisconnected: (event: Event) => {
      setPlayerState(PlayerState.DISCONNECTED);
      SfxUtil.stopMusic();
      window.removeEventListener("beforeunload", onUnload);
    },
    onError: (event: Event) => {
      setPlayerState(PlayerState.ERROR);
    },
  };

  useEffect(() => {

    DataStore.instance.addEventListener("frame", (msg) => {
      requestAnimationFrame(() => {
        onFrame(msg);
      });
    });
    DataStore.instance.addEventListener("notice", (msg) => { onNotice(msg); });
    DataStore.instance.addEventListener("stats", (msg) => { onStats(msg); });
    DataStore.instance.addEventListener("_log", (msg) => { onLog(); });

    DataStore.instance.connect(connectionListener, props.profile);

    function resize() {

      if (!(canvas.current && minimap.current))
        return;

      if (!(DataStore.instance && DataStore.instance.tileset))
        return;

      const tilesize = DataStore.instance.tileset.tilesize * DataStore.instance.scale;
      canvas.current.width = Math.floor(Math.floor(window.innerWidth / tilesize) * tilesize);
      canvas.current.height = Math.floor(Math.floor(window.innerHeight / tilesize) * tilesize);

      minimap.current.width = 200;
      minimap.current.height = 200;
    }
    window.addEventListener("resize", resize);
    resize();

    canvas.current?.addEventListener("touchstart", onTouchStart, {passive: false});

    canvas.current?.focus();
    SfxUtil.shuffleMusic();

    if (minimap.current) {
      const ctx = minimap.current.getContext("2d");
      if (ctx)
        MapRenderer.clearMap(ctx);
    }

    if (canvas.current) {
      const ctx = canvas.current.getContext("2d");
      if (ctx)
        MapRenderer.clearMap(ctx);
    }
  }, []);

  const onFrame = (msg: FrameUpdateMessage) => {
    if (!(canvas.current && minimap.current))
      return;

    const map = DataStore.instance.maps[msg.id];
    const ctx = canvas.current.getContext("2d");
    if (ctx)
      MapRenderer.renderMap(ctx, msg, clicked.current || null);

    const minimapCtx = minimap.current.getContext("2d");
    if (minimapCtx) {
      const minimapScale = minimap.current.width / msg.width;
      MapRenderer.renderMiniMap(minimapCtx, minimapScale, msg);
    }
  };

  const onLog = () => {

  };

  const onNotice = (event: NoticeMessage) => {
    if (event.mood) {
      SfxUtil.shuffleMusic();
    }

    if (!(canvas.current && minimap.current)) {
      return;
    }

    const ctx = canvas.current?.getContext("2d");
    const miniCtx = minimap.current?.getContext("2d");

    if (!(ctx && miniCtx)) {
      return;
    }

    MapRenderer.clearMap(ctx);
    MapRenderer.clearMap(miniCtx);

    if (event.entered && event.entered in DataStore.instance.maps) {
      const minimapScale = minimap.current.width / canvas.current.width;
      MapRenderer.redrawMiniMap(miniCtx, DataStore.instance.maps[event.entered], minimapScale);
      MapRenderer.redrawMap(ctx, DataStore.instance.maps[event.entered]);
    }
  };

  const onStats = (event: PlayerStatsMessage) => {
    setPlayerStats(event.stats);
  };

  const handleKeyPress = (event: KeyboardEvent) => {
    const key = event.key.toLowerCase();
    pressed.current[key] = event.type === 'keydown';
    return key;
  };

  const onKeyDown = (event: KeyboardEvent) => {
    handleKeyPress(event);
  };

  const onKeyUp = (event: KeyboardEvent) => {
    handleKeyPress(event);
    var dx = 0;
    var dy = 0;

    const handlers: KeyHandler = {
      "w": () => { dy-- },
      "a": () => { dx-- },
      "s": () => { dy++ },
      "d": () => { dx++ },
      "p": () => {
        DataStore.instance.send({action: Action.PICKUP});
      },
      ".": () => {
        DataStore.instance.send({action: Action.ENTER});
      },
      "f": () => {
        DataStore.instance.send({action: Action.MELEE});
      },
      "i": () => {
        if (showInventory)
          closeInventoryDialog();
        else
          showInventoryDialog();
      },
      "h": () => {
        if (showHelp)
          closeHelpDialog();
        else
          showHelpDialog();
      },
      "+": () => {
        DataStore.instance.incrementScale(.1);
      },
      "-": () => {
        DataStore.instance.incrementScale(-.1);
      },
    };

    for (let key in pressed.current) {
      const handler = handlers[key];
      if (handler) {
        handler();
      }
    }

    if (dx !== 0 || dy !== 0) {
      DataStore.instance.send({action: Action.MOVE, direction: [dx, dy]});
    }
    pressed.current = {};
  };

  const onBlur = () => {
    if (canvas.current)
      canvas.current.focus();
  }

  const setWaypoint = (x: number, y: number) => {

    if (!canvas.current) {
      return;
    }

    if (!(DataStore.instance && DataStore.instance.tileset))
      return;

    const tilesize = DataStore.instance.tileset.tilesize * DataStore.instance.scale;
    const width = Math.floor(canvas.current.clientWidth / tilesize);
    const height = Math.floor(canvas.current.clientHeight / tilesize);
    clicked.current = [x, y];
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
    DataStore.instance.send({action: Action.WAYPOINT, pos: relpos});
  };

  const clearWaypoint = () => {
    clicked.current = undefined;
  };

  const onMouseDown = (event: MouseEvent) => {
    if (!canvas.current)
      return;

    const rect = canvas.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    setWaypoint(x, y);
    return false;
  };

  const onMouseUp = (event: MouseEvent) => {
    clearWaypoint();
  };

  const onContextMenu = (event: MouseEvent) => {
    event.preventDefault();
  };

  const onTouchStart = (event: any) => {
    event.preventDefault();

    if (!canvas.current)
      return;

    const rect = canvas.current.getBoundingClientRect();
    const touch = event.touches[0];
    const x = touch.clientX - rect.left;
    const y = touch.clientY - rect.top;
    setWaypoint(x, y);
  };

  const onTouchEnd = (event: TouchEvent) => {
    event.preventDefault();

    if (!canvas.current)
      return;

    clearWaypoint();
  };

  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey) {
      DataStore.instance.incrementScale(-event.deltaY * 0.01);
    }
  };

  const closeAllDialogs = () => {
    setShowPlayer(false);
    setShowInventory(false);
    setShowHelp(false);
    setShowSettings(false);
  }

  const showPlayerDialog = () => {
    setShowPlayer(true);
  };

  const showInventoryDialog = () => {
    setShowInventory(true);
  };

  const closeInventoryDialog = () => {
    setShowInventory(false);
  };

  const showHelpDialog = () => {
    setShowHelp(true);
  };

  const closeHelpDialog = () => {
    setShowHelp(false);
  };

  const showSettingsDialog = () => {
    setShowSettings(true);
  };

  let status;
  if (playerState === PlayerState.CONNECTING) {
    status = (
      <div className="splash">
        Connecting...
      </div>
    );
  } else if (playerState === PlayerState.ERROR) {
    status = (
      <div className="splash">
        ERROR!!!
      </div>
    );
  } else if (playerState === PlayerState.DISCONNECTED) {
    status = (
      <div className="splash disconnected">
        DISCONNECTED!!!<br />
        Hit reload to try again...
      </div>
    );
  }

  let dialog;
  if (showHelp) {
    dialog = <HelpDialog title="Help" callback={closeAllDialogs} />;
  }

  if (showPlayer) {
    dialog = <PlayerDialog callback={closeAllDialogs} />;
  }

  if (showInventory) {
    dialog = <InventoryDialog title="Inventory" callback={closeAllDialogs} />;
  }

  if (showSettings) {
    dialog = <SettingsDialog callback={closeAllDialogs} />;
  }

  const log = DataStore.instance.log.map((l, i) => {
    return (
      <div key={i} className={l.type}>
        {l.message}
      </div>
    );
  });

  let stats;
  if (playerStats && playerStats.tot) {
    const text = (playerStats.hp >= 0 ? playerStats.hp : 0) + " of " + playerStats.tot;
    stats = (
      <div className="stats">
        Health:
        <div className="progress-bar">
          <span style={{ width: playerStats.hp / playerStats.tot * 100 + "%" }}>{text}</span>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="toolbar">
        <button className="help" onClick={showHelpDialog}>Help</button>
        <button className="settings" onClick={showSettingsDialog}>Settings</button>
        <button className="player" onClick={showPlayerDialog}>Player</button>
        <button className="inventory" onClick={showInventoryDialog}>Inventory</button>
      </div>

      {status}
      {stats}

      <canvas className="minimap" ref={minimap} width={200} height={200}/>
      <canvas className="playarea" tabIndex={0} ref={canvas}
        width={800} height={800}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={onBlur}
        onMouseDown={onMouseDown}
        onMouseUp={onMouseUp}
        onTouchEnd={onTouchEnd}
        onContextMenu={onContextMenu}
        onWheel={onWheel}
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

const ErrorView = () => {
  return (
    <div className="splash error">
      Could not connect!!!
    </div>
  );
};

const LoadingView = () => {
  return (
    <div className="splash loading">
      Loading....
    </div>
  );
}

interface JoinViewProps {
  onJoin: (playerName: string) => void;
}

const JoinView = (props: JoinViewProps) => {
  const defaultName = "Player-" + Math.round(1000 * Math.random()).toString();

  const [playerName, setPlayerName] = useState(defaultName);

  const update = (event: ChangeEvent<HTMLInputElement>) => {
    setPlayerName(event.target.value);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    props.onJoin(playerName);
  };

  return (
    <div className="join">
      <fieldset>
        <legend>Join the game</legend>

        <form onSubmit={submit}>
          <label>Name:</label>
          <input type="text" name="name" onChange={update} value={playerName}/>
          <input type="submit" onClick={submit} value="Join"/>
        </form>

      </fieldset>
    </div>
  );
}

class StatsView extends Component {
  render() {
    return (
      <div className="server-stats">
        <p><em>{DataStore.instance.manifest?.num_players_online}</em> players online now!</p>
        <p>Server age: {DataStore.instance?.manifest?.server_age}</p>
      </div>
    );
  }
}


const App = () => {

  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const [profile, setProfile] = useState<PlayerProfile>();

  useEffect(() => {

    const handler = {
      onLoaded: () => {
        setLoaded(true);
        DataStore.instance.load(window.localStorage);
      },
      onError: () => {
        setError(true);
      },
    };

    DataStore.instance.loadManifest(API_URL || "", handler);
  }, []);

  const onJoin = (playerName: string) => {
    setProfile({name: playerName});
  };

  let contents;
  if (profile) {
    contents = <CanvasView profile={profile} />;
  } else if (loaded) {
    contents = <div>
      <JoinView onJoin={onJoin} />
      <StatsView />
    </div>;
  } else if (error) {
    contents = <ErrorView />;
  } else {
    contents = <LoadingView />;
  }

  return (
    <div className="App">
      {contents}
    </div>
  );
}

export default App;
