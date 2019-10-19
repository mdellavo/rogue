import random
import noise
import collections
import logging
from enum import Enum

from .world import World, Area
from .tiles import Door, Tile, Trap
from .objects import Coin, Shield, Sword, HealthPotion
from .npcs import NPC

NUM_NPCS = 100
NUM_DOORS = 100
NUM_COINS = 100
NUM_ITEMS = 100
NUM_TRAPS = 100

COIN_KEYS = ["coin1", "coin2", "coin3", "coin4", "coin5"]

log = logging.getLogger(__name__)


def dump_tiles(tiles):
    pass


def add_doors(door_class, tiles, total_doors=NUM_DOORS, depth=0, key="crypt1"):
    width = len(tiles[0])
    height = len(tiles)
    num_doors = 0
    while num_doors < total_doors:
        dx = random.randrange(0, width)
        dy = random.randrange(0, height)
        tile = tiles[dy][dx]
        if not tile.blocked:
            tiles[dy][dx] = door_class(key, depth=depth)
            num_doors += 1


def add_npcs(world, area, num_npcs=NUM_NPCS):
    for i in range(num_npcs):
        npc = NPC("orc1", name="orc.{}".format(i))
        world.place_actor(npc, area=area)


def add_coins(area, num_coins=NUM_COINS):
    for _ in range(num_coins):
        c = Coin(random.choice(COIN_KEYS))
        area.place(c)


def add_items(area, num_items=NUM_ITEMS):
    for _ in range(num_items):
        area.place(Sword("sword1"))
        area.place(Shield("shield1"))
        area.place(HealthPotion("potion1"))


def add_traps(area, num_traps=NUM_TRAPS):
    width = len(area.tiles[0])
    height = len(area.tiles)
    count = 0
    while count < num_traps:
        dx = random.randrange(0, width)
        dy = random.randrange(0, height)
        tile = area.tiles[dy][dx]
        if not tile.blocked:
            area.tiles[dy][dx] = Trap(tile.key)
            count += 1


def populate_area(world, area):
    add_npcs(world, area)
    add_coins(area)
    add_items(area)
    add_traps(area)


def generate_cave(width, height, iterations=5, depth=0):
    current_step = [[True for _ in range(width)] for __ in range(height)]

    num_floor = int(round(width * height * .45))
    while num_floor > 0:
        x = random.randrange(1, width - 1)
        y = random.randrange(1, height - 1)
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
                if cx < 0 or cx >= width or cy < 0 or cy >= height:
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
        current_step = [[_cell(x, y) for y in range(width)] for x in range(height)]

    def _tile(pos, cell):
        x, y = pos
        if x == 0 or y == 0 or x == width - 1 or y == height - 1:
            return Tile("wall3", blocked=True, blocked_sight=True)
        return Tile("wall3", blocked=True, blocked_sight=True) if cell else Tile("grey3")

    tiles = [[_tile((x, y), cell) for x, cell in enumerate(row)] for y, row in enumerate(current_step)]
    add_doors(CaveDoor, tiles, NUM_DOORS, depth=depth, key="crypt1")
    return tiles


class CaveDoor(Door):

    SIZE = 100

    def __init__(self, *args, **kwargs):
        self.depth = kwargs.pop("depth", 0)
        kwargs["message"] = "cave level {}".format(self.depth)
        super(CaveDoor, self).__init__(*args, **kwargs)

    def generate_cave(self, exit_area, exit_position):
        tiles = generate_cave(self.SIZE, self.SIZE, depth=self.depth + 1)

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

        return Area("Cave", tiles, self.depth), (dx, dy)

    def get_area(self, world, exit_area, exit_position):
        if not self.area:
            log.info("generating cave...")
            self.area, self.position = self.generate_cave(exit_area, exit_position)
            populate_area(world, self.area)
            log.info("cave done!")
        return super(CaveDoor, self).get_area(world, exit_area, exit_position)


class DungeonDoor(Door):
    SIZE = 100
    MIN_SIZE = 10

    def __init__(self, *args, **kwargs):
        self.depth = kwargs.pop("depth", 0)
        kwargs["message"] = "dungeon level {}".format(self.depth)
        super(DungeonDoor, self).__init__(*args, **kwargs)

    def generate_dungeon(self, exit_area, exit_position):
        tiles = generate_dungeon(self.SIZE, self.SIZE, self.MIN_SIZE)
        while True:
            dx = random.randrange(0, len(tiles[0]))
            dy = random.randrange(0, len(tiles))
            tile = tiles[dy][dx]
            if not tile.blocked:
                if self.depth > 1:
                    message = "a door to dungeon level {}".format(self.depth - 1)
                else:
                    message = "an exit to the world"
                tiles[dy][dx] = Door("stairsup1", area=exit_area, position=exit_position, message=message)
                break
        return Area("Dungeon", tiles, self.depth), (dx, dy)

    def get_area(self, world, exit_area, exit_position):
        if not self.area:
            log.info("generating dungeon...")
            self.area, self.position = self.generate_dungeon(exit_area, exit_position)
            populate_area(world, self.area)
            log.info("dungeon done!")

        return super(DungeonDoor, self).get_area(world, exit_area, exit_position)


class Room(collections.namedtuple("Room", ["x", "y", "w", "h"])):

    @property
    def center(self):
        return self.x + (self.w // 2), self.y + (self.h // 2)

    @property
    def l(self):
        return self.x + self.w

    @property
    def b(self):
        return self.y + self.h

    def contains(self, x, y):
        return (self.x <= x <= (self.x + self.w)) and (self.y <= y <= (self.y + self.h))

    def overlaps(self, other):
        return (
                self.l >= other.x or
                self.b >= other.y or
                other.l >= self.x or
                other.b >= self.y
        )


def partition(room, min_size):
    rooms = []
    tunnels = []

    def _too_small(p):
        return p.w <= min_size or p.h <= min_size

    remaining = [room]
    while remaining:
        part = remaining.pop(0)
        orientation = bool(random.randint(0, 1))
        a, b = split_room(part, orientation)
        tunnels.append((a, b))
        if _too_small(a) or _too_small(b):
            rooms.append(part)
        else:
            remaining.extend((a, b))

    return rooms, tunnels


def split_room(room, vertical):
    if vertical:
        s = random.randint(room.h // 4, 2 * room.h // 4)
        a, b = Room(room.x, room.y, room.w, s), Room(room.x, room.y + s, room.w, room.h - s)
    else:
        s = random.randint(room.w // 4, 2 * room.w // 4)
        a, b = Room(room.x, room.y, s, room.h), Room(room.x + s, room.y, room.w - s, room.h)
    return a, b


def generate_dungeon(width, height, min_size, depth=0):
    outer = Room(0, 0, width, height)
    parts, tunnels = partition(outer, min_size)

    def _generate_room(r):
        offset_x = random.randint(0, r.w//2)
        offset_y = random.randint(0, r.h//2)

        w = random.randint(2, r.w)
        if offset_x + w >= r.w:
            w = r.w - 4

        h = random.randint(2, r.h)
        if offset_y + h >= r.h:
            h = r.h - 4

        return Room(r.x + offset_x, r.y + offset_y, w, h)

    rooms =[_generate_room(room) for room in parts]
    tiles = render_dungeon(width, height, rooms, tunnels)
    add_doors(DungeonDoor, tiles, NUM_DOORS, depth=depth, key="crypt2")
    return tiles


# http://www.roguebasin.com/index.php?title=Basic_BSP_Dungeon_generation
def render_dungeon(width, height, rooms, tunnels):

    def _inside(x, y):
        return any(room.contains(x, y) for room in rooms) and x < width - 1 and y < height - 1

    rows = [[_inside(x, y) for x in range(width)] for y in range(height)]

    for tunnel in tunnels:
        a, b = sorted(tunnel)

        a_cx, a_cy = a.center
        b_cx, b_cy = b.center
        for x in range(a_cx, b_cx):
            if x >= width - 1:
                continue
            rows[a_cy][x] = True

        for y in range(a_cy, b_cy):
            if y >= height - 1:
                continue
            rows[y][a_cx] = True

    def _tile(cell):
        return Tile("wall3", blocked=True, blocked_sight=True) if cell else Tile("grey3")

    return [[_tile(cell) for cell in row] for row in rows]


class Cardinal(Enum):
    NORTH = 0, 1
    EAST = 1, 0
    SOUTH = 0, -1
    WEST = -1, 0


def generate_maze(width, height):

    grid = [[False for _ in range(width)] for __ in range(height)]
    x, y = random.randint(0, width - 1), random.randint(0, height - 1)
    grid[y][x] = True

    wall_list = [(x, y, w) for w in Cardinal]
    while wall_list:
        item = random.choice(wall_list)
        wall_list.remove(item)
        x, y, w = item

        dx, dy = w.value
        nx, ny = x + (2 * dx), y + (2 * dy)
        if nx < 0 or nx >= width or ny < 0 or ny >= height:
            continue

        if grid[ny][nx]:
            continue

        count = 0
        for passage in Cardinal:
            cx, cy = passage.value
            px, py = nx + (2 * cx), ny + (2 * cy)
            if px < 0 or px >= width or py < 0 or py >= height:
                continue

            if grid[py][px]:
                count += 1

        if count > 1:
            continue

        grid[ny][nx] = True
        px, py = x + dx, y + dy
        grid[py][px] = True

        wall_list.extend([(nx, ny, w) for w in Cardinal])

    def _tile(cell):
        return Tile("wall3", blocked=True, blocked_sight=True) if not cell else Tile("grey3")
    return [[_tile(cell) for cell in row] for row in grid]


class MazeDoor(Door):
    WIDTH = HEIGHT = 100

    def __init__(self, *args, **kwargs):
        self.depth = kwargs.pop("depth", 0)
        kwargs["message"] = "maze level {}".format(self.depth)
        super(MazeDoor, self).__init__(*args, **kwargs)

    def generate_maze(self, exit_area, exit_position):
        tiles = generate_maze(self.WIDTH, self.HEIGHT)
        while True:
            dx = random.randrange(0, len(tiles[0]))
            dy = random.randrange(0, len(tiles))
            tile = tiles[dy][dx]
            if not tile.blocked:
                if self.depth > 1:
                    message = "a door to maze level {}".format(self.depth - 1)
                else:
                    message = "an exit to the world"
                tiles[dy][dx] = Door("stairsup1", area=exit_area, position=exit_position, message=message)
                break
        return Area("Maze", tiles, self.depth), (dx, dy)

    def get_area(self, world, exit_area, exit_position):
        if not self.area:
            log.info("generating maze...")
            self.area, self.position = self.generate_maze(exit_area, exit_position)
            add_npcs(world, self.area, 10)
            add_coins(self.area, 10)
            add_items(self.area, 10)
            log.info("maze done!")
        return super(MazeDoor, self).get_area(world, exit_area, exit_position)


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
    add_doors(CaveDoor, tiles, depth=1, key="crypt1")
    add_doors(DungeonDoor, tiles, depth=1, key="crypt2")
    add_doors(MazeDoor, tiles, depth=1, key="crypt3")
    return tiles


def generate_world(size):
    log.info("generating world...")

    area = Area("The world", generate_map(size, iterations=500), 0)
    world = World(area)
    populate_area(world, area)

    log.info("world done!")

    return world


