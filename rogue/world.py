import math
import dataclasses


@dataclasses.dataclass
class Object(object):
    key: str
    x: int
    y: int


class Actor(Object):
    view_distance: int = 10


class Player(Actor):
    pass


class Tile(object):
    def __init__(self, key, blocked=False, blocked_sight=False):
        self.key = key
        self.blocked = blocked
        self.blocked_sight = blocked or blocked_sight


class Map(object):
    def __init__(self, tiles, player):
        self.tiles = tiles
        self.objects = [player]

    def move(self, actor, dx, dy):
        x = actor.x + dx
        y = actor.y + dy

        if x < 0 or x >= len(self.tiles[0]) or y < 0 or y >= len(self.tiles):
            return False

        tile = self.tiles[x][y]
        if tile.blocked:
            return False

        actor.x = x
        actor.y = y

        return True

    def fov(self, actor):
        visible = []
        for theta in range(361):
            ax = math.cos(math.radians(theta))
            ay = math.sin(math.radians(theta))
            for i in range(1, actor.view_distance):
                px = actor.x + int(round(i * ax))
                py = actor.y + int(round(i * ay))
                if px < 0 or px >= len(self.tiles[0]) or py < 0 or py >= len(self.tiles):
                    continue
                tile = self.tiles[py][px]
                if tile.blocked_sight:
                    break
                pos = (px, py)
                if pos not in visible:
                    visible.append(pos)
        return visible

