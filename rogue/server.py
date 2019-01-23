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


class Player(Actor):

    def __init__(self, key, socket, tileset, *args, **kwargs):
        super(Player, self).__init__(key, *args, **kwargs)
        self.socket = socket
        self.tilemap = tileset
        self.input_queue = asyncio.Queue(QUEUE_SIZE)
        self.response_queue = asyncio.Queue(QUEUE_SIZE)

    def tick(self, world):
        try:
            msg = self.input_queue.get_nowait()
            if not msg:
                return

            if "action" in msg:
                self.handleAction(world, msg)
        except asyncio.QueueEmpty:
            pass

        if self.response_queue.full():
            while not self.response_queue.empty():
                self.response_queue.get_nowait()

        frame = self.get_frame(world)
        self.response_queue.put_nowait(frame)

    def handleAction(self, world, msg):
        if msg["action"] == "move":
            dx, dy = msg["direction"]
            world.move(self, dx, dy)
        elif msg["action"] == "pickup":
            world.pickup(self)
        elif msg["action"] == "enter":
            world.enter(self)

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

    def get_frame(self, world):
        width = height = 10

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
                rv_row.append((explored, in_fov, tile_index, obj_index))
            rv.append(rv_row)
        return {"frame": rv}


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
        "tiles_url": "{}://{}/tiles".format(request.scheme, request.host),
        "socket_url": "ws://{}/session".format(request.host),
    })


@routes.get("/tiles")
async def get_tiles(request):
    return web.FileResponse("data/tiles.png")


@routes.get("/session")
async def session(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    log.debug('websocket connection started')

    player = Player("player", ws, request.app["tileset"])
    request.app["world"].place_actor(player)

    async def _writer():
        while True:
            response = await player.response_queue.get()
            await ws.send_bytes(msgpack.packb(response))

    async def _reader():
        async for msg in ws:
            if msg.type == aiohttp.WSMsgType.BINARY:
                obj = msgpack.unpackb(msg.data, raw=False)
                player.input_queue.put_nowait(obj)
            elif msg.type == aiohttp.WSMsgType.ERROR:
                log.error('ws connection closed with exception %s', ws.exception())

    await asyncio.gather(_reader(), _writer())

    log.debug('websocket connection closed')

    request.app["world"].remove_actor(player)

    return ws


async def run_server(world, tileset):
    app = web.Application()
    app["world"] = world
    app["tileset"] = tileset
    cors = aiohttp_cors.setup(app, defaults={
        "http://localhost:3000": aiohttp_cors.ResourceOptions(
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
    site = web.TCPSite(runner, 'localhost', 8080)
    log.info("starting server...")
    await site.start()
