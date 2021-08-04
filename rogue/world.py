import math
import time
import random
import itertools
import collections
import logging
import heapq

from typing import Set, Dict, List, DefaultDict

from .actor import Player, Actor
from .tiles import Tile
from .actions import ActionError
from .annotations import NodeType
from . import util

TIMEOUT = .1
DAY = 86400 / 6. * TIMEOUT

AreaRegistry = {}

log = logging.getLogger(__name__)


class Area(object):
    def __init__(self, name, tiles, depth):
        self.id = util.generate_uid()
        self.name = name
        self.tiles = tiles
        self.depth = depth
        self.object_index = collections.defaultdict(list)
        self.time = 0
        self.areas = []
        AreaRegistry[self.id] = self

    def __str__(self):
        return "{} level {}".format(self.name, self.depth)

    def add_area(self, area):
        self.areas.append(area)

    @property
    def objects(self):
        return itertools.chain.from_iterable(self.object_index.values())

    @property
    def players(self):
        return (o for o in self.objects if isinstance(o, Player))

    @property
    def has_players(self):
        return any(self.players)

    @property
    def map_width(self):
        return len(self.tiles[0])

    @property
    def map_height(self):
        return len(self.tiles)

    def get_tile(self, x, y):
        if x < 0 or x >= self.map_width or y < 0 or y >= self.map_height:
            return None
        return self.tiles[y][x]

    def get_objects(self, x, y):
        return self.object_index.get((x, y), [])

    def has_objects(self, x, y):
        return len(self.get_objects(x, y)) > 0

    def is_tile_free(self, x, y, ignore=None):
        tile = self.get_tile(x, y)
        if not tile or tile.blocked:
            return False

        objs = self.get_objects(x, y)
        if objs and any(obj.blocks for obj in objs if (not ignore or obj not in ignore)):
            return False

        return True

    def add_object(self, obj, x, y):
        self.move_object(obj, x, y)
        return True

    def remove_object(self, obj):
        objs = self.get_objects(obj.x, obj.y)
        objs.remove(obj)

    def tick(self, world):
        self.time += 1
        for obj in list(self.objects):
            obj.age += 1
            if not isinstance(obj, Actor):
                continue
            if not obj.is_alive:
                continue
            obj.charge_energy()
            if not obj.can_act:
                continue
            action = obj.get_action(world)
            if not action:
                continue
            try:
                action.perform(obj, world)
                obj.drain_energy()
            except ActionError as e:
                obj.notice(str(e))
            except Exception:
                log.exception("error performing action %s", action)

    def place(self, obj):
        for _ in range(100):
            x = random.randrange(0, self.map_width)
            y = random.randrange(0, self.map_height)

            if self.is_tile_free(x, y):
                self.add_object(obj, x, y)
                return
        raise ValueError("could not place object")

    def immediate_area(self, actor, radius=1):
        immediate = [(actor.x, actor.y)]
        for dy in range(-radius, radius):
            for dx in range(-radius, radius):
                x = actor.x + dx
                y = actor.y + dy
                if x < 0 or x >= self.map_width or y < 0 or y >= self.map_height:
                    continue
                immediate.append((x, y))
        return immediate

    def immediate_area_objects(self, actor, radius=1):
        objects = itertools.chain.from_iterable([
            self.get_objects(x, y) for x, y in self.immediate_area(actor, radius=radius)
        ])
        return objects

    def broadcast(self, actor):
        for obj in self.immediate_area_objects(actor, radius=10):
            if isinstance(obj, Actor):
                obj.notify()

    def fov(self, actor):
        visible = [(actor.x, actor.y)]
        for theta in range(361):
            ax = math.cos(math.radians(theta))
            ay = math.sin(math.radians(theta))
            for i in range(1, actor.attributes.view_distance):
                px = actor.x + int(round(i * ax))
                py = actor.y + int(round(i * ay))
                if px < 0 or px >= self.map_width or py < 0 or py >= self.map_height:
                    continue
                tile = self.get_tile(px, py)
                pos = (px, py)
                if pos not in visible:
                    visible.append(pos)
                if tile.blocked_sight or any(obj.blocks_sight for obj in self.get_objects(px, py)):
                    break

        return visible

    def find_path(self, actor, waypoint):
        rv = find_path(self, actor.pos, waypoint, actor)
        return rv

    def generate_map(self, actor):
        rows = []
        for y in range(self.map_height):
            row = []
            for x in range(self.map_width):
                tile = self.get_tile(x, y)
                is_free = self.is_tile_free(x, y)
                if actor.x == x and actor.y == y:
                    val = 2
                elif not tile:
                    val = -1
                elif not is_free:
                    val = 1
                else:
                    val = 0
                row.append(val)
            rows.append(row)
        return rows

    def move_object(self, obj, x, y):
        objs = self.get_objects(obj.x, obj.y)
        if obj in objs:
            objs.remove(obj)

        obj.x = x
        obj.y = y
        objs = self.object_index[(obj.x, obj.y)]
        if obj not in objs:
            objs.append(obj)
        tile = self.tiles[y][x]
        if isinstance(obj, Player):
            tile.activate(obj, self)


class World(object):
    def __init__(self, area: Area):
        self.areas = [area]
        self.actor_area = {}
        self.age = 0
        self.schedules = []
        self.counter = itertools.count()

    @property
    def players(self):
        return itertools.chain.from_iterable(area.players for area in self.areas)

    @property
    def num_players(self):
        return sum(1 for _ in self.players)

    def add_actor(self, actor, area=None):
        if not area:
            area = self.areas[0]
        if area not in self.areas:
            self.areas.append(area)
        self.actor_area[id(actor)] = area
        return area

    def place_actor(self, actor: Actor, area: Area = None):
        actor.stats.born = self.age
        self.add_actor(actor, area=area).place(actor)

    def remove_actor(self, actor: Actor):
        area = self.get_area(actor)
        area.remove_object(actor)
        self.actor_area.pop(id(actor))

    def get_area(self, actor: Actor):
        return self.actor_area.get(id(actor))

    def tick(self):
        active_areas = [area for area in self.areas if area.has_players]
        for area in active_areas:
            area.tick(self)

        if self.schedules:
            while self.schedules and self.schedules[0][0] <= self.age:
                _, _, callback = heapq.heappop(self.schedules)
                callback()

        self.age += 1

    def schedule(self, timeout, callback):
        at = self.age + timeout
        heapq.heappush(self.schedules, (at, next(self.counter), callback))

    def fov(self, actor: Actor):
        area = self.get_area(actor)
        return area.fov(actor)

    def inspect(self, actor: Actor):
        rv = []
        area = self.get_area(actor)
        for x, y in area.immediate_area(actor):
            tile = area.get_tile(x, y)
            objs = [obj for obj in area.get_objects(x, y) if obj is not actor]
            rv.append(((x, y), tile, objs))
        return rv

    def surrounding_actors(self, actor: Actor):
        area = self.get_area(actor)
        rv = []
        for x, y in area.immediate_area(actor):
            rv.extend([obj for obj in area.get_objects(x, y) if obj is not actor and isinstance(obj, Actor)])
        return rv


# https://en.wikipedia.org/wiki/A*_search_algorithm#Pseudocode

def _path_score(a: NodeType, b: NodeType) -> int:
    ax, ay = a
    bx, by = b
    return abs(bx - ax) + abs(by - ay)


def _total_path(came_from: Dict[NodeType, NodeType], node: NodeType) -> List[NodeType]:
    total = [node]
    while node in came_from:
        node = came_from[node]
        total.append(node)
    return list(reversed(total))[1:]


def find_path(area: Area, start: NodeType, goal: NodeType, ignore) -> List[NodeType]:
    open_nodes: Set[NodeType] = set()
    open_nodes.add(start)

    closed_nodes: Set[NodeType] = set()

    came_from = {}
    score = {start: 0}

    total: DefaultDict[NodeType, float] = collections.defaultdict(lambda: math.inf)
    total[start] = _path_score(start, goal)

    def _next() -> NodeType:
        return sorted(open_nodes, key=lambda n: _path_score(n, goal)).pop(0)

    evaluated = 0
    while open_nodes:
        node: NodeType = _next()

        if node == goal:
            return _total_path(came_from, node)

        open_nodes.remove(node)
        closed_nodes.add(node)
        x, y = node

        if not area.is_tile_free(x, y, [ignore]):
            continue

        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                neighbor: NodeType = (x + dx, y + dy)
                neighbor_tile: Tile = area.get_tile(*neighbor)

                if not neighbor_tile:
                    continue
                if neighbor in closed_nodes:
                    continue

                new_score = score[node] + _path_score(node, neighbor)
                if neighbor not in open_nodes:
                    open_nodes.add(neighbor)
                elif new_score >= total[neighbor]:
                    continue

                came_from[neighbor] = node
                score[neighbor] = new_score
                total[neighbor] = new_score + _path_score(neighbor, goal)
        evaluated += 1
        if evaluated > 1000:
            return
