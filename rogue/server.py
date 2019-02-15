import logging
import collections
import asyncio

import aiohttp
from aiohttp import web
import aiohttp_cors

import msgpack

from .world import DAY
from .objects import Player, Actor, ActionError

log = logging.getLogger(__name__)

routes = web.RouteTableDef()


QUEUE_SIZE = 100
FRAME_SIZE = 11
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
        try:
            return self.registry[action](world, player, msg)
        except ActionError as e:
            player.notice(str(e))


dispatcher = ActionDispatcher()


@dispatcher.register("move")
def handle_move(world, player, action):
    dx, dy = action["direction"]
    world.move(player, dx, dy)


@dispatcher.register("pickup")
def handle_pickup(world, player, _):
    world.pickup(player)


@dispatcher.register("enter")
def handle_enter(world, player, _):
    world.enter(player)


@dispatcher.register("inventory")
def handle_inventory(_, player, __):
    equipment_map = {obj.id: part for part, obj in player.equipment.items()}

    def _inv(obj):
        i = {
            "id": obj.id,
            "idx": player.tilemap.get_index(obj.key),
            "type": type(obj).__name__,
        }
        if obj.id in equipment_map:
            i["equipped"] = equipment_map[obj.id].name
        return i
    rv = {"inventory": [_inv(obj) for obj in player.inventory]}
    return rv


@dispatcher.register("equip")
def handle_equip(world, player, action):
    obj = next(o for o in player.inventory if o.id == action["item"])
    if obj:
        part = action.get("part")
        part = player.equip(obj, part=part)
        return {"id": obj.id, "equipped": part.name}


@dispatcher.register("melee")
def handle_melee(world, player, _):
    world.melee(player)


class WebSocketPlayer(Player):

    def __init__(self, key, socket, tileset, *args, **kwargs):
        super(Player, self).__init__(key, *args, **kwargs)
        self.socket = socket
        self.tilemap = tileset
        self.input_queue = asyncio.Queue(QUEUE_SIZE)
        self.response_queue = asyncio.Queue(QUEUE_SIZE)

    def send_message(self,  **msg):
        self.response_queue.put_nowait(msg)

    def send_event(self, event_name, **msg):
        msg["_event"] = event_name
        self.send_message(**msg)

    def hurt(self, actor, damage):
        self.notice("you were hurt by {} for {} damage".format(actor, damage))
        self.send_stats()

    def notice(self, msg, **kwargs):
        self.send_event("notice", notice=msg, **kwargs)

    def send_stats(self):
        self.send_event("stats", stats={
            "hp": self.hit_points,
            "tot": self.health,
        })

    def die(self):
        self.send_stats()
        age = int(round(self.age/DAY))
        self.notice("you are dead. You were {} days old and you killed {} things".format(age, self.kills))
        self.response_queue.put_nowait(None)

    def tick(self, world):
        super(WebSocketPlayer, self).tick(world)

        try:
            msg = self.input_queue.get_nowait()
        except asyncio.QueueEmpty:
            msg = None

        if not msg:
            return

        if "ping" in msg:
            response = {"pong": msg["ping"]}
        elif "action" in msg:
            response = dispatcher.dispatch(world, self, msg)
        else:
            response = None

        if response:
            if "_id" in msg:
                response["_id"] = msg["_id"]
            self.send_message(**response)

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

    def send_frame(self, world):
        width = height = FRAME_SIZE

        fov = world.explore(self)
        area = world.get_area(self)
        tiles = self.visible_tiles(area, width, height)

        object_map = collections.defaultdict(list)
        for obj in area.objects:
            object_map[(obj.x, obj.y)].append(obj)

        def keyfn(o):
            return isinstance(o, Actor)

        rv = []
        for row in tiles:
            rv_row = []
            for cell in row:
                pos, tile = cell
                explored = tile and tile.explored
                in_fov = explored and pos in fov
                objs = object_map.get(pos)
                obj = sorted(objs, key=keyfn)[0] if objs else None
                tile_index = self.tilemap.get_index(tile.key) if tile else -1
                obj_index = self.tilemap.get_index(obj.key) if obj else -1
                rv_row.append([explored, in_fov, tile_index, obj_index])  # FIXME only supports one obj
            rv.append(rv_row)
        rv[int(height/2)][int(width/2)][-1] = self.tilemap.get_index(self.key)
        return self.send_event("frame", frame=rv)


@routes.get("/")
async def get_root(request):
    return web.json_response({
        "status": "ok",
        "tileset": {
            "tilesize": request.app["tileset"].tilesize,
            "tilemap": request.app["tileset"].get_indexed_map(),
        },
        "tiles_url": "/tiles.png",
        "socket_url": "ws://{}/session".format(request.host),
    })


@routes.get("/session")
async def session(request):
    ws = web.WebSocketResponse(receive_timeout=RECV_TIMEOUT, heartbeat=HEARTBEAT)
    await ws.prepare(request)
    log.debug('websocket connection started')

    player = WebSocketPlayer("player", ws, request.app["tileset"])
    request.app["world"].place_actor(player)

    player.send_frame(request.app["world"])
    player.send_stats()

    async def _updater():
        while not ws.closed:
            await asyncio.sleep(UPDATE_TIMEOUT)
            if ws.closed:
                break
            player.send_frame(request.app["world"])
        log.info("updater stopped")
    updater = asyncio.create_task(_updater())

    async def _writer():
        while not ws.closed:
            response = await player.response_queue.get()
            if response is None:
                break
            await ws.send_bytes(msgpack.packb(response))
        log.info("writer stopped")

        if not ws.closed:
            await ws.close()

    writer = asyncio.create_task(_writer())

    async for msg in ws:
        if msg.type == aiohttp.WSMsgType.BINARY:
            obj = msgpack.unpackb(msg.data, raw=False)
            player.input_queue.put_nowait(obj)
        elif msg.type == aiohttp.WSMsgType.ERROR:
            log.error('ws connection closed with exception %s', ws.exception())

    log.info("reader stopped")

    if not ws.closed:
        await ws.close()

    player.response_queue.put_nowait(None)

    for fut in (writer, updater):
        for i in range(2):
            try:
                await asyncio.wait_for(fut, timeout=RECV_TIMEOUT)
            except asyncio.TimeoutError:
                fut.cancel()
            except asyncio.CancelledError:
                pass

    request.app["world"].remove_actor(player)

    log.debug('websocket connection closed')

    return ws


async def run_server(world, tileset):
    app = web.Application()
    app["world"] = world
    app["tileset"] = tileset
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
    site = web.TCPSite(runner, '0.0.0.0', 8080)
    log.info("starting server...")
    await site.start()
