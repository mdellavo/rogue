import math
import random
import dataclasses


@dataclasses.dataclass
class Object(object):
    key: str
    x: int
    y: int
    blocks: bool = False
    blocks_sight: bool = False

    def tick(self, world):
        pass


@dataclasses.dataclass
class Actor(Object):
    view_distance: int = 10
    blocks: bool = True


@dataclasses.dataclass
class Player(Actor):
    pass


@dataclasses.dataclass
class NPC(Actor):
    def tick(self, world):
        for _ in range(100):
            if world.move(self, random.randint(-1, 1), random.randint(-1, 1)):
                break


@dataclasses.dataclass
class Tile(object):
    def __init__(self, key, blocked=False, blocked_sight=False):
        self.key = key
        self.blocked = blocked
        self.blocked_sight = blocked_sight
        self.explored = False

    def __repr__(self):
        return "<Tile({})>".format(self.key)


class World(object):
    def __init__(self, tiles, player, objects):
        self.map = tiles
        self.player = player
        if player not in objects:
            objects.append(player)
        self.objects = objects
        self.age = 0

    def get_tile(self, x, y):
        return self.map[y][x]

    def get_objects(self, x, y):
        return [obj for obj in self.objects if obj.x == x and obj.y == y]

    @property
    def map_width(self):
        return len(self.map[0])

    @property
    def map_height(self):
        return len(self.map)

    def tick(self):
        self.age += 1
        for obj in self.objects:
            obj.tick(self)

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

    def player_fov(self):
        visible = self.fov(self.player)
        for x, y in visible:
            tile = self.get_tile(x, y)
            tile.explored = True
        return visible
