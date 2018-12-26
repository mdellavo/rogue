import random
import noise

from .world import Tile


def generate_cave(size, iterations=5):
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

    for i in range(iterations):
        current_step = [[_cell(x, y) for y in range(size)] for x in range(size)]
    return current_step


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

        n = noise.snoise2(x, y)

        if height < .1:
            return Tile("water1", blocked=True)
        elif height < .2:
            return Tile("sand1")
        elif height < .9:
            return Tile("grass1")
        else:
            return Tile("mountains1", blocked=True)

    return [[_tile(x, y, height) for x, height in enumerate(row)] for y, row in enumerate(heightmap)]


def generate_world(size):

    def _tile(x, y):
        val = noise.snoise2(x, y)

        if val > .3:
            return Tile("wall1", blocked=True, blocked_sight=True)
        else:
            return Tile("grass1")

    tiles = [[_tile(w, h) for w in range(size)] for h in range(size)]
    return tiles


