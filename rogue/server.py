import os
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

from .actions import MoveAction, UseItemAction, PickupItemAction, EquipAction, MeleeAttackAction, EnterAction
from .world import DAY, find_path
from .actor import Player, Actor
from .actions import ActionError
from .util import project_enum
from .tiles import ASSET_PATH, ASSET_TYPES, MUSIC

log = logging.getLogger(__name__)

routes = web.RouteTableDef()


QUEUE_SIZE = 100
FRAME_SIZE = 11
HEARTBEAT = 5
RECV_TIMEOUT = 10
UPDATE_TIMEOUT = .06666


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
        except ActionError as e:
            player.notice(str(e))
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
        part = action.get("part")
        action = EquipAction(obj, part=part)
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


@dispatcher.register("move2")
def handle_move_to(world, player, action):
    area = world.get_area(player)
    player_relative = (action["pos"][0] - int(FRAME_SIZE/2), action["pos"][1] - int(FRAME_SIZE/2))
    goal = (player.pos[0] + player_relative[0], player.pos[1] + player_relative[1])
    path = find_path(area, player.pos, goal)
    print("move from", player.pos, "to", goal, "by", path)


@dataclasses.dataclass
class WebSocketPlayer(Player):

    def __init__(self, key, socket, tileset, *args, **kwargs):
        super(Player, self).__init__(key, *args, **kwargs)
        self.socket = socket
        self.tilemap = tileset
        self.response_queue = asyncio.Queue(QUEUE_SIZE)

    def send_message(self,  **msg):
        self.response_queue.put_nowait(msg)

    def send_event(self, event_name, **msg):
        msg["_event"] = event_name
        self.send_message(**msg)

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
        age = int(round(self.age/DAY))
        self.notice("you are dead. You lasted {} days and you killed {} things".format(age, self.stats.kills))
        self.response_queue.put_nowait(None)

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
        return rv


@routes.get("/")
async def get_root(request):
    return web.json_response({
        "status": "ok",
        "tileset": {
            "tilesize": request.app["tileset"].tilesize,
            "num_tiles": request.app["tileset"].num_tiles,
        },
        "tile_url": "http://{}/tile/".format(request.host),
        "socket_url": "ws://{}/session".format(request.host),
        "music": ["http://{}/asset/music/{}".format(request.host, key) for key in MUSIC]
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


def _generate_player(ws, player_name, tileset):
    player = WebSocketPlayer("player", ws, tileset, name=player_name)
    player.attributes.energy_recharge = 5
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

    player = _generate_player(ws, player_name, request.app["tileset"])
    request.app["world"].place_actor(player)

    player.send_stats()
    player.notice("welcome {}, good luck".format(player_name))

    updater_queue = Queue()

    async def _updater():
        while not ws.closed:
            if not updater_queue.empty():
                break

            t1 = time.time()
            frame = player.get_frame(request.app["world"])
            try:
                await ws.send_bytes(msgpack.packb({"_event": "frame", "frame": frame}))
            except Exception:
                log.error("updater close")
                break
            t2 = time.time()
            delta = t2 - t1
            timeout = max(UPDATE_TIMEOUT - delta, 0)
            await asyncio.sleep(timeout)
        if not ws.closed:
            await ws.close()

        log.info("updater stopped")

    async def _writer():
        while not ws.closed:
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
    updater = asyncio.create_task(_updater())

    async for msg in ws:
        if msg.type == aiohttp.WSMsgType.BINARY:
            obj = msgpack.unpackb(msg.data, raw=False)
            _handle_message(request.app["world"], player, obj)
        elif msg.type == aiohttp.WSMsgType.ERROR:
            log.error('ws connection closed with exception %s', ws.exception())

    player.response_queue.put_nowait(None)
    updater_queue.put_nowait(None)

    log.info("reader stopped")

    if not ws.closed:
        await ws.close()

    for fut in (writer, updater):
        for i in range(2):
            try:
                await asyncio.wait_for(fut, timeout=.1)
            except asyncio.TimeoutError:
                fut.cancel()
            except asyncio.CancelledError:
                pass

    request.app["world"].remove_actor(player)

    log.debug('websocket connection closed')

    return ws


@routes.get("/tile/{idx}")
async def get_tile(request):
    idx = int(request.match_info["idx"])
    digest, img = request.app["tileset"].get_tile_bitmap(idx)  # need memory cache
    matching = request.headers.get("If-None-Match", "").strip('"')
    if matching == digest:
        return web.Response(status=304)
    return web.Response(body=img, content_type="image/png", headers={
        "Cache-Control": "public,max-age=86400",
        "ETag": '"' + digest + '"'
    })


@routes.get(r"/asset/{asset_type:\w+}/{asset_key}")
async def get_asset(request):

    asset_type = request.match_info["asset_type"]
    if asset_type not in ASSET_TYPES:
        return web.Response(status=404)

    asset_key = request.match_info["asset_key"]
    if asset_type == "music" and asset_key not in MUSIC:
        return web.Response(status=404)

    asset_path = os.path.join(ASSET_PATH, asset_type, asset_key)
    return web.FileResponse(asset_path)


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
