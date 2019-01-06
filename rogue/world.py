import math
import random
import dataclasses
from typing import List


@dataclasses.dataclass
class Object(object):
    key: str
    x: int = None
    y: int = None
    blocks: bool = True
    blocks_sight: bool = False
    anchored: bool = False

    def tick(self, area):
        pass


@dataclasses.dataclass
class Actor(Object):
    view_distance: int = 5
    name: str = None
    inventory: List[Object] = dataclasses.field(default_factory=list)
    max_inventory: int = 20

    def pickup(self, obj):
        if obj in self.inventory:
            raise ValueError("actor already holding obj")

        if len(self.inventory) < self.max_inventory:
            self.inventory.append(obj)

    def drop(self, obj):
        if obj not in self.inventory:
            raise ValueError("actor not holding obj")
        self.inventory.remove(obj)


@dataclasses.dataclass
class NPC(Actor):
    def tick(self, area):
        for _ in range(100):
            if area.move(self, random.randint(-1, 1), random.randint(-1, 1)):
                break


@dataclasses.dataclass
class Tile(object):
    def __init__(self, key, blocked=False, blocked_sight=False):
        self.key = key
        self.blocked = blocked
        self.blocked_sight = blocked_sight
        self.explored = False


@dataclasses.dataclass
class Door(Tile):
    def __init__(self, key, area=None, position=None, **kwargs):
        super(Door, self).__init__(key, **kwargs)
        self.area = area
        self.position = position

    def get_area(self, exit_area, exit_position):
        if not self.area:
            return ValueError("door needs area")
        return self.area, self.position


class Area(object):
    def __init__(self, tiles):
        self.tiles = tiles
        self.objects = []
        self.time = 0

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
        return not (self.get_tile(x, y).blocked and any(o.blocks for o in self.get_objects(x, y)))

    def add_object(self, obj, x, y):
        if obj in self.objects:
            raise ValueError("obj already in area")

        if self.is_tile_free(x, y):
            obj.x = x
            obj.y = y
            self.objects.append(obj)
            return True
        return False

    def remove_object(self, obj):
        if obj not in self.objects:
            raise ValueError("obj not in area")
        self.objects.remove(obj)

    def tick(self):
        self.time += 1
        for obj in self.objects:
            obj.tick(self)

    def place(self, obj):
        for _ in range(100):
            x = random.randrange(0, self.map_width)
            y = random.randrange(0, self.map_height)
            if self.add_object(obj, x, y):
                return
        raise ValueError("could not place object")

    def move(self, actor, dx, dy):
        x = actor.x + dx
        y = actor.y + dy

        if x < 0 or x >= self.map_width or y < 0 or y >= self.map_height:
            return False

        tile = self.get_tile(x, y)
        if tile.blocked or any(obj.blocks for obj in self.get_objects(x, y)):
            return False

        actor.x = x
        actor.y = y

        return True

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
            for i in range(1, actor.view_distance):
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
    def __init__(self, area):
        self.areas = [area]
        self.actor_area = {}

    def add_actor(self, actor, area=None):
        if not area:
            area = self.areas[0]
        if area not in self.areas:
            self.areas.append(area)
        self.actor_area[id(actor)] = area
        return area

    def place_actor(self, actor):
        self.add_actor(actor).place(actor)

    def get_area(self, actor):
        return self.actor_area.get(id(actor))

    def tick(self):
        for area in self.areas:
            area.tick()

    def move(self, actor, dx, dy):
        area = self.get_area(actor)
        return area.move(actor, dx, dy)

    def fov(self, actor):
        area = self.get_area(actor)
        return area.fov(actor)

    def explore(self, actor):
        area = self.get_area(actor)
        return area.explore(actor)

    def enter(self, actor):
        area = self.get_area(actor)
        pt = area.get_tile(actor.x, actor.y)
        if isinstance(pt, Door):
            new_area, position = pt.get_area(area, (actor.x, actor.y))
            self.add_actor(actor, area=new_area)
            x, y = position
            new_area.add_object(actor, x, y)
            area.remove_object(actor)

    def inspect(self, actor):
        rv = []
        area = self.get_area(actor)
        for x, y in area.immediate_area(actor):
            tile = area.get_tile(x, y)
            objs = [obj for obj in area.get_objects(x, y) if obj is not actor]
            rv.append(((x, y), tile, objs))
        return rv

    def pickup(self, actor):
        area = self.get_area(actor)
        objs = area.get_objects(actor.x, actor.y)
        for obj in objs:
            area.remove_object(obj)
            actor.pickup(obj)

