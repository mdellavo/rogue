import logging
import asyncio

import aiohttp
from aiohttp import web
import aiohttp_cors

import msgpack

from .objects import Actor

log = logging.getLogger(__name__)

routes = web.RouteTableDef()


QUEUE_SIZE = 100
FRAME_SIZE = 11
HEARTBEAT = 5
RECV_TIMEOUT = 10
UPDATE_TIMEOUT = .025


class Player(Actor):

    def __init__(self, key, socket, tileset, *args, **kwargs):
        super(Player, self).__init__(key, *args, **kwargs)
        self.socket = socket
        self.tilemap = tileset
        self.input_queue = asyncio.Queue(QUEUE_SIZE)
        self.response_queue = asyncio.Queue(QUEUE_SIZE)

    def send_message(self,  **msg):
        self.response_queue.put_nowait(msg)

    def hurt(self, actor, damage):
        self.notice("you were hurt by {} for {} damage".format(actor, damage))
        self.send_stats()

    def send_stats(self):
        self.send_message(stats={
            "hp": self.hit_points,
            "tot": self.health,
        })

    def die(self):
        self.send_stats()
        self.notice("you are dead.")
        self.response_queue.put_nowait(None)

    def notice(self, msg, **kwargs):
        self.send_message(notice=msg, **kwargs)

    def tick(self, world):

        if self.response_queue.full():
            while not self.response_queue.empty():
                self.response_queue.get_nowait()

        try:
            msg = self.input_queue.get_nowait()
        except asyncio.QueueEmpty:
            msg = None

        if not msg:
            return

        if "ping" in msg:
            response = {"pong": msg["ping"]}
        elif "action" in msg:
            response = self.handle_action(world, msg)
        else:
            response = None

        if response:
            if "_id" in msg:
                response["_id"] = msg["_id"]
            self.send_message(**response)

    def handle_action(self, world, msg):
        rv = None
        if msg["action"] == "move":
            dx, dy = msg["direction"]
            world.move(self, dx, dy)
        elif msg["action"] == "pickup":
            world.pickup(self)
        elif msg["action"] == "enter":
            world.enter(self)
        elif msg["action"] == "inventory":

            def _inv(obj):
                return {
                    "idx": self.tilemap.get_index(obj.key),
                    "type": type(obj).__name__
                }
            rv = {"inventory": [_inv(obj) for obj in self.inventory]}
        elif msg["action"] == "melee":
            world.melee(self)
        return rv

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

        object_map = {(obj.x, obj.y): obj for obj in area.objects}

        rv = []
        for row in tiles:
            rv_row = []
            for cell in row:
                pos, tile = cell
                explored = tile and tile.explored
                in_fov = explored and pos in fov
                obj = object_map.get(pos)
                tile_index = self.tilemap.get_index(tile.key) if tile else -1
                obj_index = self.tilemap.get_index(obj.key) if obj else -1
                rv_row.append([explored, in_fov, tile_index, obj_index])
            rv.append(rv_row)
        rv[int(height/2)][int(width/2)][-1] = self.tilemap.get_index(self.key)
        return self.send_message(frame=rv)


class Decoder(object):
    pass


@routes.get("/")
async def get_root(request):
    return web.json_response({
        "status": "ok",
        "tileset": {
            "tilesize": request.app["tileset"].tilesize,
            "tilemap": request.app["tileset"].get_indexed_map(),
        },
        "socket_url": "ws://{}/session".format(request.host),
    })


@routes.get("/tiles")
async def get_tiles(request):
    return web.FileResponse("data/tiles.png")


@routes.get("/session")
async def session(request):
    ws = web.WebSocketResponse(receive_timeout=RECV_TIMEOUT, heartbeat=HEARTBEAT)
    await ws.prepare(request)
    log.debug('websocket connection started')

    player = Player("player", ws, request.app["tileset"])
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
