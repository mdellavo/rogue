import random
import noise
import logging

from .world import Tile, World, Door, Area
from .objects import NPC, Coin

NUM_NPCS = 100
NUM_DOORS = 100
NUM_COINS = 100

COIN_KEYS = ["coin1", "coin2", "coin3", "coin4", "coin5"]

log = logging.getLogger(__name__)


def add_doors(tiles, total_doors=NUM_DOORS, key="crypt1", depth=0):
    width = len(tiles[0])
    height = len(tiles)
    num_doors = 0
    while num_doors < total_doors:
        dx = random.randrange(0, width)
        dy = random.randrange(0, height)
        tile = tiles[dy][dx]
        if not tile.blocked:
            tiles[dy][dx] = CaveDoor(key, depth=depth)
            num_doors += 1


def add_npcs(world, area, num_npcs=NUM_NPCS):
    for _ in range(num_npcs):
        npc = NPC("orc1")
        world.place_actor(npc, area=area)


def add_coins(area, num_coins=NUM_COINS):
    for _ in range(num_coins):
        c = Coin(random.choice(COIN_KEYS))
        area.place(c)


def generate_cave(size, iterations=5, depth=0):
    current_step = [[True for _ in range(size)] for __ in range(size)]

    num_floor = int(round(size * size * .45))
    while num_floor > 0:
        x = random.randrange(1, size - 1)
        y = random.randrange(1, size - 1)
        if current_step[y][x]:
            current_step[y][x] = False
            num_floor -= 1

    def _cell(x, y):

        num_neighbors = 0
        for i in range(-1, 2):
            for j in range(-1, 2):

                if (i, j) == (0, 0):
                    continue

                cx = x + j
                cy = y + i
                if cx < 0 or cx >= size or cy < 0 or cy >= size:
                    continue

                if current_step[cy][cx]:
                    num_neighbors += 1

        if num_neighbors > 5:
            return True
        elif num_neighbors < 4:
            return False
        else:
            return current_step[y][x]

    for _ in range(iterations):
        current_step = [[_cell(x, y) for y in range(size)] for x in range(size)]

    def _tile(pos, cell):
        x, y = pos
        if x == 0 or y == 0 or x == size - 1 or y == size - 1:
            return Tile("wall3", blocked=True, blocked_sight=True)
        return Tile("wall3", blocked=True, blocked_sight=True) if cell else Tile("grey3")

    tiles = [[_tile((x, y), cell) for x, cell in enumerate(row)] for y, row in enumerate(current_step)]
    add_doors(tiles, NUM_DOORS, key="stairsdown1", depth=depth)
    return tiles


class CaveDoor(Door):

    SIZE = 50

    def __init__(self, *args, **kwargs):
        self.depth = kwargs.pop("depth", 0)
        kwargs["message"] = "cave level {}".format(self.depth)
        super(CaveDoor, self).__init__(*args, **kwargs)

    def generate_cave(self, exit_area, exit_position):
        tiles = generate_cave(random.randrange(self.SIZE/2, self.SIZE*2), depth=self.depth + 1)

        while True:
            dx = random.randrange(0, len(tiles[0]))
            dy = random.randrange(0, len(tiles))
            tile = tiles[dy][dx]
            if not tile.blocked:
                if self.depth > 1:
                    message = "a door to cave level {}".format(self.depth - 1)
                else:
                    message = "an exit to the world"
                tiles[dy][dx] = Door("stairsup1", area=exit_area, position=exit_position, message=message)
                break

        return Area(tiles), (dx, dy)

    def get_area(self, exit_area, exit_position):
        if not self.area:
            log.info("generating cave...")
            self.area, self.position = self.generate_cave(exit_area, exit_position)
            log.info("cave done!")
        return super(CaveDoor, self).get_area(exit_area, exit_position)


def generate_map(size, iterations=500, max_radius=5):
    heightmap = [[0. for _ in range(size)] for __ in range(size)]

    for _ in range(iterations):

        cx = random.randrange(0, size)
        cy = random.randrange(0, size)
        radius = random.randint(1, max_radius)
        radius_squared = radius ** 2

        for y in range(size):
            for x in range(size):
                height = radius_squared - (((x - cx)**2) + ((y - cy)**2))
                if height > 0:
                    heightmap[y][x] += height

    min_height = min(height for row in heightmap for height in row)
    max_height = max(height for row in heightmap for height in row)
    delta = max_height - min_height

    for y in range(size):
        for x in range(size):
            heightmap[y][x] = (heightmap[y][x] - min_height) / delta

    def _tile(x, y, height):
        if x == 0 or y == 0 or x == size - 1 or y == size - 1:
            return Tile("water1", blocked=True, blocked_sight=False)

        n = noise.snoise2(x, y)

        if height < .05:
            return Tile("water1", blocked=True)
        elif height < .1:
            return Tile("sand1")
        elif height < .5:
            return Tile("grass1")
        else:
            return Tile("mountains1", blocked=True, blocked_sight=True)

    tiles = [[_tile(x, y, height) for x, height in enumerate(row)] for y, row in enumerate(heightmap)]
    add_doors(tiles, depth=1)
    return tiles


def generate_world(size):
    log.info("generating world...")

    area = Area(generate_map(size, iterations=500))
    world = World(area)
    add_npcs(world, area)

    log.info("world done!")

    return world


