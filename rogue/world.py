import math
import random
import itertools
import collections

from .actor import Player, Actor

TIMEOUT = .1
DAY = 86400 / 6. * TIMEOUT


def _path_score(a, b):
    ax, ay = a
    bx, by = b
    return abs(bx - ax) + abs(by - ay)


def _total_path(came_from, node):
    total = {node}
    while node in came_from:
        node = came_from[node]
        total.add(node)
    return total


# https://en.wikipedia.org/wiki/A*_search_algorithm#Pseudocode
def find_path(area, start, goal):
    open = set()
    closed = set()
    came_from = {}
    score = {start: 0}
    total = collections.defaultdict(lambda: math.inf)
    total[start] = _path_score(start, goal)

    def _next():
        return min([node for node in total], key=lambda a, b: _path_score(a, b))

    while open:
        node = _next()
        if node == goal:
            return _total_path(came_from, node)
        open.remove(node)
        closed.add(node)
        x, y = node
        tile = area.get_tile(x, y)
        if tile.blocked or not tile.explored:
            continue
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                neighbor = x + dx, y + dy
                neighbor_tile = area.get_tile(neighbor)
                if not neighbor_tile:
                    continue
                if neighbor in closed:
                    continue
                new_score = score[node] + abs(dx) + abs(dy)
                if neighbor not in open:
                    open.add(neighbor)
                elif new_score >= total[neighbor]:
                    continue
                came_from[neighbor] = node
                score[neighbor] = score
                total[neighbor] = score + _path_score(neighbor, goal)


class Area(object):
    def __init__(self, tiles):
        self.tiles = tiles
        self.objects = []
        self.time = 0

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
        return [obj for obj in self.objects if obj.x == x and obj.y == y]

    def is_tile_free(self, x, y):
        if self.get_tile(x, y).blocked:
            return False

        objs = self.get_objects(x, y)
        if objs and any(obj.blocks for obj in objs):
            return False

        return True

    def add_object(self, obj, x, y):
        if obj in self.objects:
            return

        if self.is_tile_free(x, y):
            obj.x = x
            obj.y = y
            self.objects.append(obj)
            return True
        return False

    def remove_object(self, obj):
        if obj not in self.objects:
            return
        self.objects.remove(obj)

    def tick(self, world):
        self.time += 1
        for obj in self.objects:
            obj.age += 1
            if isinstance(obj, Actor):
                action = obj.get_action(world)
                if action:
                    action.perform(obj, world)

    def place(self, obj):
        for _ in range(100):
            x = random.randrange(0, self.map_width)
            y = random.randrange(0, self.map_height)
            if self.add_object(obj, x, y):
                return
        raise ValueError("could not place object")

    def immediate_area(self, actor):
        immediate = [(actor.x, actor.y)]
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                x = actor.x + dx
                y = actor.y + dy
                if x < 0 or x >= self.map_width or y < 0 or y >= self.map_height:
                    continue
                immediate.append((x, y))
        return immediate

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

    def explore(self, actor):
        visible = self.fov(actor)
        for x, y in visible:
            tile = self.get_tile(x, y)
            tile.explored = True
        return visible


class World(object):
    def __init__(self, area: Area):
        self.areas = [area]
        self.actor_area = {}
        self.age = 0

    @property
    def players(self):
        return itertools.chain.from_iterable(area.players for area in self.areas)

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
        return self.get_area(actor).remove_object(actor)

    def get_area(self, actor: Actor):
        return self.actor_area.get(id(actor))

    def tick(self):
        active_areas = [area for area in self.areas if area.has_players]
        for area in active_areas:
            area.tick(self)
        self.age += 1

    def fov(self, actor: Actor):
        area = self.get_area(actor)
        return area.fov(actor)

    def explore(self, actor: Actor):
        area = self.get_area(actor)
        return area.explore(actor)

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
