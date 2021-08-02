import os
import io
import time
import logging
import collections
import asyncio
import dataclasses
from asyncio import Queue

import aiohttp
from aiohttp import web
import aiohttp_cors
import msgpack
from jinja2 import Environment, PackageLoader, select_autoescape
from PIL import Image, ImageDraw

from .world import DAY, AreaRegistry
from .actions import MoveAction, UseItemAction, PickupItemAction, EquipAction, MeleeAttackAction, EnterAction
from .actor import Player, Actor
from .util import project_enum
from .tiles import ASSET_PATH, MUSIC, AssetTypes

log = logging.getLogger(__name__)

routes = web.RouteTableDef()


QUEUE_SIZE = 100
HEARTBEAT = 5
RECV_TIMEOUT = 10
UPDATE_TIMEOUT = .1


class ActionDispatcher(object):
    def __init__(self):
        self.registry = {}

    def register(self, action):
        def _register(handler):
            self.registry[action] = handler
            return handler
        return _register

    def dispatch(self, world, player, msg):
        action = msg["action"]
        if action not in self.registry:
            log.error("could not dispatch %s: %s", action, msg)
            return
        try:
            return self.registry[action](world, player, msg)
        except Exception as e:
            log.exception("exception during player action: " + str(e))
            player.notice("you cant do that, you broke it")


dispatcher = ActionDispatcher()


@dispatcher.register("move")
def handle_move(world, player, action):
    dx, dy = action["direction"]
    player.next_action = MoveAction(dx, dy)


@dispatcher.register("pickup")
def handle_pickup(world, player, _):
    player.next_action = PickupItemAction()


@dispatcher.register("enter")
def handle_enter(world, player, _):
    player.next_action = EnterAction()


@dispatcher.register("player_info")
def handle_player_info(world, player, _):
    rv = {"player_info": {
        "name": player.name,
        "age": player.age,
        "stats": dataclasses.asdict(player.stats),
        "attributes": dataclasses.asdict(player.attributes),
    }}
    return rv


@dispatcher.register("inventory")
def handle_inventory(_, player, __):
    equipment_map = {obj.id: part for part, obj in player.equipment.items()}

    def _inv(obj):
        i = {
            "id": obj.id,
            "idx": player.tilemap.get_index(obj.key),
            "type": project_enum(obj.object_type),
            "name": str(obj),
        }
        if obj.id in equipment_map:
            i["equipped"] = project_enum(equipment_map[obj.id])
        return i

    rv = {"inventory": [_inv(obj) for obj in player.inventory]}
    return rv


@dispatcher.register("equip")
def handle_equip(world, player, action):
    obj = player.find_object_by_id(action["item"])
    if obj:
        action = EquipAction(obj)
        player.next_action = action
        return {"id": obj.id, "equipped": project_enum(action.part)}


@dispatcher.register("use")
def handle_use(world, player, action):
    obj = player.find_object_by_id(action["item"])
    if obj:
        player.next_action = UseItemAction(obj)
        return {"id": obj.id, "used": True}


@dispatcher.register("melee")
def handle_melee(world, player, _):
    player.next_action = MeleeAttackAction()


@dispatcher.register("waypoint")
def handle_waypoint(world, player, action):
    waypoint = (
        player.pos[0] + action["pos"][0],
        player.pos[1] + action["pos"][1]
    )
    player.set_waypoint(waypoint)


@dataclasses.dataclass
class WebSocketPlayer(Player):

    def __init__(self, key, socket, tileset, world, *args, **kwargs):
        super(Player, self).__init__(key, *args, **kwargs)
        self.socket = socket
        self.tilemap = tileset
        self.response_queue = asyncio.Queue(QUEUE_SIZE)
        self.world = world

    def send_message(self, **msg):
        try:
            self.response_queue.put_nowait(msg or None)
        except asyncio.queues.QueueFull:
            log.warning("queue full %s", self)
            while not self.response_queue.empty():
                self.response_queue.get_nowait()
            self.response_queue.put_nowait(None)
            self.world.remove_actor(self)

    def send_event(self, event_name, **msg):
        msg["_event"] = event_name
        self.send_message(**msg)

    def notify(self):
        self.queue_frame(self.world)

    def healed(self, actor, damage):
        self.notice("you feal better, +{} health".format(damage))
        self.send_stats()

    def hurt(self, actor, damage):
        self.notice("you were hurt by {} for {} damage".format(actor.name, damage))
        self.send_stats()

    def notice(self, msg, **kwargs):
        self.send_event("notice", notice=msg, **kwargs)

    def send_stats(self):
        self.send_event("stats", stats={
            "hp": self.attributes.hit_points,
            "tot": self.attributes.health,
        })

    def die(self):
        self.send_stats()
        age = int(round(self.age / DAY))
        self.notice("you are dead. You lasted {} days and you killed {} things with an experience of {}".format(age, self.stats.kills, self.attributes.experience))
        self.send_message()

    def visible_tiles(self, area, width, height):
        rv = []
        for y in range(height):
            row = []
            for x in range(width):
                tile_x = x + self.x - int(width / 2)
                tile_y = y + self.y - int(height / 2)
                if tile_x < 0 or tile_x >= area.map_width or tile_y < 0 or tile_y >= area.map_height:
                    row.append(((tile_x, tile_y), None))
                    continue
                tile = area.get_tile(tile_x, tile_y)
                row.append(((tile_x, tile_y), tile))
            rv.append(row)
        return rv

    def queue_frame(self, world):
        area = world.get_area(self)
        if not area:
            return
        frame = self.get_frame(area)
        self.send_event("frame",
                        id=area.id,
                        frame=frame,
                        x=self.x,
                        y=self.y,
                        width=area.map_width,
                        height=area.map_height)

    def get_frame(self, area):
        width = height = 2 * self.attributes.view_distance
        tiles = self.visible_tiles(area, width, height)

        object_map = collections.defaultdict(list)
        for obj in area.objects:
            object_map[(obj.x, obj.y)].append(obj)

        def keyfn(o):
            return isinstance(o, Actor)

        fov = area.fov(self)
        rv = []
        for row in tiles:
            rv_row = []
            for cell in row:
                pos, tile = cell
                in_fov = pos in fov
                tile_index = self.tilemap.get_index(tile.key) if in_fov else -1

                objs = object_map.get(pos)
                objs = sorted(objs, key=keyfn, reverse=True) if objs else None
                obj_indexes = [self.tilemap.get_index(obj.key) for obj in objs] if objs else [-1]
                rv_row.append([in_fov, tile_index] + obj_indexes)
            rv.append(rv_row)
        rv[int(height / 2)][int(width / 2)][-1] = self.tilemap.get_index(self.key)
        return rv


@routes.get("/")
async def get_root(request):
    return web.json_response({
        "status": "ok",
        "tileset": {
            "tilesize": request.app["tileset"].tilesize,
            "tilemap": request.app["tileset"].indexed_map
        },
        "tiles_url": "//{}/asset/gfx/tiles.png".format(request.host),
        "socket_url": "ws://{}/session".format(request.host),
        "music": ["//{}/asset/music/{}".format(request.host, key) for key in MUSIC],
        "num_players_online": request.app["world"].num_players,
        "server_age": request.app["world"].age,
    })


def _handle_message(world, player, message):
    if "ping" in message:
        response = {"pong": message["ping"]}
    elif "action" in message:
        response = dispatcher.dispatch(world, player, message)
    else:
        response = None

    if response:
        if "_id" in message:
            response["_id"] = message["_id"]
        player.send_message(**response)


def _generate_player(ws, player_name, tileset, world):
    player = WebSocketPlayer("player", ws, tileset, world, name=player_name)
    player.attributes.energy_recharge = 7
    return player


@routes.get("/session")
async def session(request):
    ws = web.WebSocketResponse(receive_timeout=RECV_TIMEOUT, heartbeat=HEARTBEAT, compress=False)
    await ws.prepare(request)
    log.debug('websocket connection started')

    async for msg in ws:
        if msg.type == aiohttp.WSMsgType.BINARY:
            obj = msgpack.unpackb(msg.data, raw=False)
            break
        elif msg.type == aiohttp.WSMsgType.ERROR:
            log.error('ws connection closed with exception %s', ws.exception())
            await ws.close()
            return ws

    profile = obj.get("profile")
    if not profile:
        log.error("did not get profile: %s", obj)
        await ws.close()
        return ws

    player_name = obj["profile"]["name"]

    player = _generate_player(ws, player_name, request.app["tileset"], request.app["world"])
    request.app["world"].place_actor(player)

    player.send_stats()
    player.notice("welcome {}, good luck".format(player_name))
    player.queue_frame(request.app["world"])

    async def _writer():
        while not ws.closed and player.is_alive:
            response = await player.response_queue.get()
            if response is None:
                break
            try:
                await ws.send_bytes(msgpack.packb(response))
            except Exception:
                log.error("writer closed")
                break
        if not ws.closed:
            await ws.close()
        log.info("writer stopped")

    writer = asyncio.create_task(_writer())

    async for msg in ws:
        if msg.type == aiohttp.WSMsgType.BINARY:
            obj = msgpack.unpackb(msg.data, raw=False)
            _handle_message(request.app["world"], player, obj)
        elif msg.type == aiohttp.WSMsgType.ERROR:
            log.error('ws connection closed with exception %s', ws.exception())
            break
        if not player.is_alive:
            break

    player.send_message()

    log.info("reader stopped")

    if not ws.closed:
        await ws.close()

    for fut in (writer,):
        for i in range(2):
            try:
                await asyncio.wait_for(fut, timeout=.1)
            except asyncio.TimeoutError:
                fut.cancel()
            except asyncio.CancelledError:
                pass

    log.debug('websocket connection closed')

    return ws


@routes.get(r"/asset/{asset_type:\w+}/{asset_key}")
async def get_asset(request):

    asset_type = request.match_info["asset_type"]
    if AssetTypes(asset_type) not in AssetTypes:
        return web.Response(status=404)

    asset_key = request.match_info["asset_key"]
    if asset_type == "music" and asset_key not in MUSIC:
        return web.Response(status=404)

    asset_path = os.path.join(ASSET_PATH, asset_type, asset_key)
    return web.FileResponse(asset_path)


def _render(request, name, **kwargs):
    template = request.app["jinja"].get_template(name)
    return web.Response(
        text=template.render(**kwargs),
        content_type="text/html"
    )


@routes.get(r"/admin")
async def admin(request):
    return _render(request, "admin.html", world=request.app["world"])


def _render_map(area, tileset, scale=.25):

    tilesize = tileset.tilesize

    tiles = Image.open(tileset.tiles_path)
    image = Image.new("RGB", (area.map_width * tilesize, area.map_height * tilesize))

    cache = {}

    def _get_bitmap(key):
        bitmap = cache.get(key)
        if not bitmap:
            r = tileset.get_tile_rect(key)
            bitmap = tiles.crop(r)
            cache[key] = bitmap
        return bitmap

    for y in range(area.map_height):
        for x in range(area.map_width):
            tile = area.get_tile(x, y)
            bitmap = _get_bitmap(tile.key)
            image.paste(bitmap, (x * tilesize, y * tilesize))

    width, height = image.size
    resized = (width * scale, height * scale)
    image.thumbnail(resized, Image.ANTIALIAS)
    return image


@routes.get(r"/admin/map/{area_id}")
def render_map(request):
    area = AreaRegistry.get(request.match_info["area_id"])
    tileset = request.app["tileset"]
    image = _render_map(area, tileset)
    out = io.BytesIO()
    image.save(out, format="png")
    return web.Response(body=out.getvalue(), content_type="image/png")


async def run_server(world, tileset, port):
    app = web.Application()
    app["world"] = world
    app["tileset"] = tileset
    app["jinja"] = Environment(
        loader=PackageLoader("rogue", 'templates'),
        autoescape=select_autoescape(['html', 'xml'])
    )
    cors = aiohttp_cors.setup(app, defaults={
        "*": aiohttp_cors.ResourceOptions(
            allow_credentials=True,
            expose_headers="*",
            allow_headers="*",
        ),
    })

    app.add_routes(routes)
    for route in list(app.router.routes()):
        cors.add(route)
    runner = web.AppRunner(app)
    await runner.setup()
    site = web.TCPSite(runner, '0.0.0.0', port)
    log.info("starting server on port %s...", port)
    await site.start()
